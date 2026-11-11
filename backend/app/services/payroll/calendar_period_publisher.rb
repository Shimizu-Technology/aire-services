# frozen_string_literal: true

module Payroll
  class CalendarPeriodPublisher
    ADVISORY_LOCK_KEY = 638_318_282
    SUPPORTED_SCHEMA_VERSIONS = PayrollCalendarPeriod::SCHEMA_VERSIONS
    CURRENT_SCHEMA_VERSION = SUPPORTED_SCHEMA_VERSIONS.last
    SCHEMA_VERSION = CURRENT_SCHEMA_VERSION

    class ConflictError < StandardError; end
    # A lock another payroll transaction held; the publication can be retried.
    class BusyError < StandardError; end

    # schedule_version is a PostgreSQL integer.
    MAX_SCHEDULE_VERSION = 2_147_483_647

    Result = Data.define(:period, :created, :idempotent)

    attr_reader :attributes, :now

    def initialize(attributes, now: nil)
      @now = now
      @attributes = normalize(attributes)
    end

    def call
      ConnectedPayrollMode.require_enabled!
      result = PayrollCalendarPeriod.transaction do
        ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(#{ADVISORY_LOCK_KEY})")
        @now ||= Time.current
        replay = PayrollCalendarPeriodRevision.find_by(publication_id: attributes.fetch(:publication_id))
        next replay_result(replay) if replay

        validate_explicit_manual_rollout!
        validate_cutoff_override!
        validate_publishable_time!

        period = PayrollCalendarPeriod.find_by(external_pay_period_id: attributes.fetch(:external_pay_period_id))
        created = period.nil?
        if period
          revise!(period)
        else
          period = create!
        end
        record_revision!(period)
        record_audit!(period, created: created)
        record_cutoff_change_audit!(period)
        SettlementCaseCoordinator.route_open_cases_to_period!(period)
        Result.new(period: period, created: created, idempotent: false)
      end
      finalize_promptly(result.period)
      result
    rescue ActiveRecord::RecordNotUnique
      replay = PayrollCalendarPeriodRevision.find_by(publication_id: attributes.fetch(:publication_id))
      return replay_result(replay) if replay

      raise ConflictError, "The payroll calendar changed concurrently; fetch the current version and try again"
    rescue ActiveRecord::StatementInvalid => e
      raise unless defined?(PG::ExclusionViolation) && e.cause.is_a?(PG::ExclusionViolation)

      raise ConflictError, "Payroll calendar periods cannot overlap"
    end

    private

    def normalize(input)
      values = input.to_h.symbolize_keys
      time_zone = values.fetch(:time_zone, PayrollCalendarPeriod::BUSINESS_TIME_ZONE).to_s
      schema_version = values.fetch(:schema_version, "1.0").to_s
      unless SUPPORTED_SCHEMA_VERSIONS.include?(schema_version)
        raise ArgumentError, "schema_version must be #{SUPPORTED_SCHEMA_VERSIONS.to_sentence(two_words_connector: ' or ')}"
      end
      cutoff_at = parse_time!(values.fetch(:cutoff_at), "cutoff_at")
      normalized = {
        schema_version: schema_version,
        external_pay_period_id: values.fetch(:external_pay_period_id).to_s.strip,
        start_date: parse_date!(values.fetch(:start_date), "start_date"),
        end_date: parse_date!(values.fetch(:end_date), "end_date"),
        pay_date: parse_date!(values.fetch(:pay_date), "pay_date"),
        cutoff_at: cutoff_at,
        time_zone: time_zone,
        schedule_version: Integer(values.fetch(:schedule_version).to_s, 10),
        publication_id: values.fetch(:publication_id).to_s.downcase
      }
      raise ArgumentError, "schedule_version is too large" if normalized[:schedule_version] > MAX_SCHEDULE_VERSION
      if schema_version == "1.0"
        normalized[:cutoff_days_before] = Integer(
          values.fetch(:cutoff_days_before, PayrollCalendarPeriod::CUTOFF_DAYS_BEFORE).to_s,
          10
        )
      else
        raise ArgumentError, "cutoff_days_before is not used by schema 2.0" if values.key?(:cutoff_days_before)
        normalized[:cutoff_rule] = values.fetch(:cutoff_rule).to_s
        normalized[:cutoff_days] = Integer(values.fetch(:cutoff_days).to_s, 10)
        normalized[:previous_regular_pay_date] = parse_date!(values.fetch(:previous_regular_pay_date), "previous_regular_pay_date") if values.key?(:previous_regular_pay_date)
      end
      normalize_cutoff_source!(values, normalized)
      if values.key?(:overtime_policy)
        raw_policy = values.fetch(:overtime_policy)
        raise ArgumentError, "overtime_policy must be an object" unless raw_policy.respond_to?(:to_h)

        policy = raw_policy.to_h.stringify_keys
        unless WeeklyOvertimeAllocator.supported_policy?(policy)
          raise ArgumentError, "overtime_policy must use the weekly-only 40-hour Sunday–Saturday Guam policy"
        end
        normalized[:overtime_policy] = policy
      end
      raise ArgumentError, "external_pay_period_id is required" if normalized[:external_pay_period_id].blank?
      raise ArgumentError, "external_pay_period_id is too long" if normalized[:external_pay_period_id].length > 128

      config = PayrollLockRollout.installation
      expected_mode = config.lock_mode_for(normalized.fetch(:start_date))
      if values.key?(:lock_mode) && values[:lock_mode].to_s != expected_mode
        raise ArgumentError, "lock_mode must be #{expected_mode} for this installation's activation date"
      end
      if values.key?(:cutoff_enforcement_starts_on) && parse_date!(values[:cutoff_enforcement_starts_on], "cutoff_enforcement_starts_on") != config.cutoff_enforcement_starts_on
        raise ArgumentError, "cutoff_enforcement_starts_on does not match this installation"
      end
      # Preserve historical request checksums and replay semantics for legacy
      # callers. Derived fields are frozen on the row and revision separately.
      normalized[:lock_mode] = values[:lock_mode].to_s if values.key?(:lock_mode)
      normalized[:cutoff_enforcement_starts_on] = config.cutoff_enforcement_starts_on if values.key?(:cutoff_enforcement_starts_on)
      @derived_lock_mode = expected_mode
      @activation_date = config.cutoff_enforcement_starts_on
      checksum_payload = normalized.transform_values { |value| serialize(value) }.except(:publication_id)
      normalized.merge(request_checksum: CanonicalPayload.checksum(checksum_payload))
    rescue KeyError => e
      raise ArgumentError, "#{e.key} is required"
    rescue TypeError, ArgumentError => e
      raise e unless e.message.match?(/invalid value for Integer|base specified for non string value/)

      raise ArgumentError, "schedule_version and cutoff days must be integers"
    end

    def validate_explicit_manual_rollout!
      return unless @derived_lock_mode == "manual"
      return if attributes.key?(:lock_mode) && attributes.key?(:cutoff_enforcement_starts_on)

      # Never accept a new legacy-wire manual publication that old Payroll
      # cannot verify at callback time. Existing immutable replays return above.
      raise ArgumentError, "Manual calendars require explicit lock_mode and cutoff_enforcement_starts_on"
    end

    def validate_publishable_time!
      return if @derived_lock_mode == "manual" || attributes.fetch(:cutoff_at) > now
      # Lock now carries the instant the admin chose; delivery may arrive a little later.
      return if lock_now? && attributes.fetch(:cutoff_at) >= now - PayrollCalendarPeriod::LOCK_NOW_GRACE

      raise ArgumentError, "cutoff_at must be in the future when published; this lock time had already passed when it reached AIRE"
    end

    def validate_cutoff_override!
      return unless override?
      raise ArgumentError, "Only scheduled locks can use an admin lock time" unless @derived_lock_mode == "scheduled"

      cutoff_at = attributes.fetch(:cutoff_at)
      unless cutoff_at >= PayrollCalendarPeriod.earliest_override_at(attributes.fetch(:end_date))
        raise ArgumentError, "An admin lock time must be after the period's last day"
      end
      unless cutoff_at <= PayrollCalendarPeriod.latest_override_at(attributes.fetch(:pay_date))
        raise ArgumentError, "An admin lock time must be at least two days before the pay date"
      end
    end

    def override?
      attributes[:cutoff_source] == "override"
    end

    def lock_now?
      override? && attributes.dig(:cutoff_override, "action") == "lock_now"
    end

    # Policy publications may omit cutoff_source (older Cornerstone builds).
    # An override must say so explicitly and carry its policy evidence; any
    # other mismatch with the policy is rejected by the model's strict check.
    def normalize_cutoff_source!(values, normalized)
      source = values.fetch(:cutoff_source, "policy").to_s
      unless PayrollCalendarPeriod::CUTOFF_SOURCES.include?(source)
        raise ArgumentError, "cutoff_source must be policy or override"
      end
      normalized[:cutoff_source] = source if values.key?(:cutoff_source)
      if source == "policy"
        if values.key?(:policy_cutoff_at) || values.key?(:cutoff_override)
          raise ArgumentError, "policy_cutoff_at and cutoff_override require cutoff_source override"
        end
        return
      end

      normalized[:policy_cutoff_at] = parse_time!(values.fetch(:policy_cutoff_at), "policy_cutoff_at")
      normalized[:cutoff_override] = normalize_override(values.fetch(:cutoff_override))
    end

    def normalize_override(raw)
      raise ArgumentError, "cutoff_override must be an object" unless raw.respond_to?(:to_h)

      details = raw.to_h.deep_stringify_keys
      unsupported = details.keys - %w[override_id action reason set_at set_by previous_cutoff_at]
      raise ArgumentError, "cutoff_override contains unsupported fields" if unsupported.any?
      unless PayrollCalendarPeriod::OVERRIDE_ACTIONS.include?(details["action"].to_s)
        raise ArgumentError, "cutoff_override action must be lock_now or change"
      end
      reason = details["reason"].to_s.strip
      raise ArgumentError, "cutoff_override reason is required" if reason.blank?
      raise ArgumentError, "cutoff_override reason is too long" if reason.length > 500
      override_id = details["override_id"].to_s.downcase
      unless override_id.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/)
        raise ArgumentError, "cutoff_override override_id must be a UUID"
      end
      set_by = details["set_by"]
      unless set_by.is_a?(Hash) && set_by["name"].to_s.strip.present? && %w[cornerstone_payroll aire_services].include?(set_by["system"].to_s)
        raise ArgumentError, "cutoff_override set_by must name the person and system"
      end

      {
        "override_id" => override_id,
        "action" => details["action"].to_s,
        "reason" => reason,
        "set_at" => parse_time!(details.fetch("set_at"), "cutoff_override set_at").iso8601,
        "previous_cutoff_at" => details["previous_cutoff_at"].presence && parse_time!(details["previous_cutoff_at"], "cutoff_override previous_cutoff_at").iso8601,
        "set_by" => set_by.slice("name", "system", "role").transform_values { |value| value.to_s.strip.first(120) }
      }.compact
    rescue KeyError => e
      raise ArgumentError, "cutoff_override #{e.key} is required"
    end

    # Lock now should not wait for the next minute's scheduler sweep.
    def finalize_promptly(period)
      return unless period.scheduled_lock_enforced? && period.status != "finalized" && period.cutoff_at <= Time.current

      PayrollCutoffFinalizationJob.perform_later
    rescue StandardError => e
      Rails.logger.error("Payroll cutoff finalization could not be queued after a lock-now publication: #{e.class}: #{e.message}")
    end

    def record_cutoff_change_audit!(period)
      return if @previous_cutoff.nil? && !period.cutoff_overridden?
      previous = @previous_cutoff || { source: "policy", cutoff_at: nil, override_id: nil }
      return if previous[:source] == period.cutoff_source && previous[:override_id] == period.cutoff_override&.fetch("override_id", nil)

      AuditLog.record!(
        action: period.cutoff_overridden? ? "payroll_calendar_period.cutoff_overridden" : "payroll_calendar_period.cutoff_reset",
        actor: nil,
        actor_kind: "integration",
        source: "integration",
        event_category: "payroll",
        auditable: period,
        metadata: {
          external_pay_period_id: period.external_pay_period_id,
          schedule_version: period.schedule_version,
          publication_id: period.publication_id,
          cutoff_at: period.cutoff_at.iso8601,
          previous_cutoff_at: previous[:cutoff_at],
          policy_cutoff_at: period.default_cutoff_at.iso8601,
          cutoff_override: period.cutoff_override
        }.compact
      )
    end

    def parse_date!(value, name)
      Date.iso8601(value.to_s)
    rescue Date::Error
      raise ArgumentError, "#{name} must use YYYY-MM-DD"
    end

    def parse_time!(value, name)
      text = value.to_s
      unless text.match?(/(?:Z|[+-]\d{2}:\d{2})\z/i)
        raise ArgumentError, "#{name} must include an explicit UTC offset"
      end

      Time.iso8601(text)
    rescue ArgumentError => e
      raise e if e.message.include?("explicit UTC offset")

      raise ArgumentError, "#{name} must be a valid ISO 8601 timestamp"
    end

    def serialize(value)
      return value.iso8601(6) if value.respond_to?(:subsec)

      value.respond_to?(:iso8601) ? value.iso8601 : value
    end

    def create!
      raise ConflictError, "The first schedule version must be 1" unless attributes.fetch(:schedule_version) == 1
      fence_late_lock_now!(nil)

      reject_overlap!
      reject_frozen_batch_overlap!
      PayrollCalendarPeriod.create!(period_attributes.merge(
        status: "scheduled",
        next_finalization_attempt_at: attributes.fetch(:cutoff_at)
      ))
    end

    def revise!(period)
      period.lock!
      @previous_cutoff = {
        source: period.cutoff_source,
        cutoff_at: period.cutoff_at.iso8601,
        override_id: period.cutoff_override&.fetch("override_id", nil)
      }
      if period.status == "finalized" || period.cutoff_at <= now
        raise ConflictError, "A payroll period cannot be revised after its cutoff"
      end

      if period.lock_mode != @derived_lock_mode || (period.cutoff_enforcement_starts_on && period.cutoff_enforcement_starts_on != @activation_date)
        raise ConflictError, "Published calendar lock mode is immutable"
      end
      @activation_date = period.cutoff_enforcement_starts_on
      # Versions only move forward. Cornerstone may skip one AIRE refused, so a
      # gap is allowed; every publication is a complete snapshot of the period.
      expected_version = period.schedule_version + 1
      unless attributes.fetch(:schedule_version) >= expected_version
        raise ConflictError, "schedule_version must be #{expected_version} or later"
      end
      fence_late_lock_now!(period)

      reject_overlap!(excluding: period)
      reject_invalid_settlement_routes!(period)
      reject_frozen_batch_overlap!
      if attributes.key?(:overtime_policy) && period.overtime_policy != attributes.fetch(:overtime_policy)
        @previous_overtime_policy = period.overtime_policy.deep_dup
        period.allow_weekly_overtime_policy_upgrade = true
      end
      period.update!(period_attributes.merge(
        status: "scheduled",
        next_finalization_attempt_at: attributes.fetch(:cutoff_at),
        finalization_attempts: 0,
        last_finalization_attempt_at: nil,
        last_finalization_error: nil
      ))
      period
    end

    # Only a lock-now instant that already passed needs this; any other cutoff
    # is still ahead, so the pending-cutoff guard already sees it.
    def fence_late_lock_now!(period)
      return unless lock_now? && attributes.fetch(:cutoff_at) <= now

      LockNowClaimFence.call!(start_date: attributes.fetch(:start_date), end_date: attributes.fetch(:end_date),
        cutoff_at: attributes.fetch(:cutoff_at), period: period)
    rescue LockNowClaimFence::ConflictError => e
      raise ConflictError, e.message
    rescue ActiveRecord::Deadlocked, ActiveRecord::LockWaitTimeout
      raise BusyError, "Payroll finalization is busy. Retry this publication."
    end

    def reject_invalid_settlement_routes!(period)
      invalid_route = period.targeted_payroll_settlement_cases
        .active
        .joins(:origin_payroll_batch)
        .where("payroll_batches.end_date >= ?", attributes.fetch(:start_date))
        .exists?
      return unless invalid_route

      raise ConflictError, "The revised period would no longer be after an assigned settlement case"
    end

    def reject_overlap!(excluding: nil)
      scope = PayrollCalendarPeriod.where(
        "start_date <= ? AND end_date >= ?",
        attributes.fetch(:end_date),
        attributes.fetch(:start_date)
      )
      scope = scope.where.not(id: excluding.id) if excluding
      raise ConflictError, "Payroll calendar periods cannot overlap" if scope.exists?
    end

    # Manual finalizers hold this publisher's advisory lock until their batch
    # commits, so this check needs no batch lock. (A late Lock now takes one in
    # LockNowClaimFence, which explains why that order is safe.)
    def reject_frozen_batch_overlap!
      batch = PayrollBatch.regular.where("start_date <= ? AND end_date >= ?", attributes.fetch(:end_date), attributes.fetch(:start_date)).first
      return unless batch

      raise ConflictError, "Payroll batch #{batch.public_id} already covers part of this period; a published calendar cannot replace its frozen snapshot"
    end

    def period_attributes
      fields = attributes.slice(
        :external_pay_period_id,
        :start_date,
        :end_date,
        :pay_date,
        :cutoff_at,
        :time_zone,
        :cutoff_days_before,
        :schedule_version,
        :publication_id,
        :request_checksum
      )
      fields[:overtime_policy] = attributes.fetch(:overtime_policy) if attributes.key?(:overtime_policy)
      fields[:schema_version] = attributes.fetch(:schema_version)
      if attributes.fetch(:schema_version) == "2.0"
        fields[:cutoff_rule] = attributes.fetch(:cutoff_rule)
        fields[:cutoff_days] = attributes.fetch(:cutoff_days)
        fields[:previous_regular_pay_date] = attributes[:previous_regular_pay_date]
      else
        fields[:cutoff_rule] = "before_pay_date"
        fields[:cutoff_days] = 7
        fields[:previous_regular_pay_date] = nil
      end
      fields[:lock_mode] = @derived_lock_mode
      fields[:cutoff_enforcement_starts_on] = @activation_date
      fields[:cutoff_source] = override? ? "override" : "policy"
      fields[:policy_cutoff_at] = override? ? attributes.fetch(:policy_cutoff_at) : nil
      fields[:cutoff_override] = override? ? attributes.fetch(:cutoff_override) : nil
      fields
    end

    def record_revision!(period)
      period.payroll_calendar_period_revisions.create!(
        schedule_version: attributes.fetch(:schedule_version),
        publication_id: attributes.fetch(:publication_id),
        request_checksum: attributes.fetch(:request_checksum),
        payload: revision_payload.merge(@previous_overtime_policy ? { previous_overtime_policy: @previous_overtime_policy } : {}),
        published_at: now
      )
    end

    def revision_payload
      attributes.merge(lock_mode: @derived_lock_mode, cutoff_enforcement_starts_on: @activation_date).except(:request_checksum).transform_values { |value| serialize(value) }.merge(
        overtime_policy: PayrollCalendarPeriod.find_by!(external_pay_period_id: attributes.fetch(:external_pay_period_id)).overtime_policy
      )
    end

    def replay_result(revision)
      unless revision.request_checksum == attributes.fetch(:request_checksum) &&
             revision.payroll_calendar_period.external_pay_period_id == attributes.fetch(:external_pay_period_id)
        raise ConflictError, "publication_id already belongs to a different calendar publication"
      end

      Result.new(period: revision.payroll_calendar_period, created: false, idempotent: true)
    end

    def record_audit!(period, created:)
      cutoff_policy = if period.schema_version == "1.0"
                        { cutoff_days_before: period.cutoff_days_before }
      else
                        {
                          cutoff_rule: period.cutoff_rule,
                          cutoff_days: period.cutoff_days,
                          previous_regular_pay_date: period.previous_regular_pay_date&.iso8601
                        }
      end
      AuditLog.record!(
        action: created ? "payroll_calendar_period.published" : "payroll_calendar_period.revised",
        actor: nil,
        actor_kind: "integration",
        source: "integration",
        event_category: "payroll",
        auditable: period,
        metadata: {
          lock_mode: period.lock_mode,
          cutoff_enforcement_starts_on: period.cutoff_enforcement_starts_on&.iso8601,
          external_pay_period_id: period.external_pay_period_id,
          schedule_version: period.schedule_version,
          publication_id: period.publication_id,
          start_date: period.start_date.iso8601,
          end_date: period.end_date.iso8601,
          pay_date: period.pay_date.iso8601,
          cutoff_at: period.cutoff_at.iso8601,
          time_zone: period.time_zone,
          schema_version: period.schema_version,
          request_checksum: period.request_checksum,
          overtime_policy: period.overtime_policy,
          previous_overtime_policy: @previous_overtime_policy,
          cutoff_source: period.cutoff_source,
          policy_cutoff_at: period.policy_cutoff_at&.iso8601,
          cutoff_override: period.cutoff_override,
          **cutoff_policy
        }
      )
    end
  end
end
