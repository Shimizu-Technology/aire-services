# frozen_string_literal: true

module Payroll
  class CalendarPeriodPublisher
    ADVISORY_LOCK_KEY = 638_318_282
    SUPPORTED_SCHEMA_VERSIONS = PayrollCalendarPeriod::SCHEMA_VERSIONS
    CURRENT_SCHEMA_VERSION = SUPPORTED_SCHEMA_VERSIONS.last
    SCHEMA_VERSION = CURRENT_SCHEMA_VERSION

    class ConflictError < StandardError; end

    Result = Data.define(:period, :created, :idempotent)

    attr_reader :attributes, :now

    def initialize(attributes, now: nil)
      @now = now
      @attributes = normalize(attributes)
    end

    def call
      PayrollCalendarPeriod.transaction do
        ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(#{ADVISORY_LOCK_KEY})")
        @now ||= Time.current
        replay = PayrollCalendarPeriodRevision.find_by(publication_id: attributes.fetch(:publication_id))
        return replay_result(replay) if replay

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
        SettlementCaseCoordinator.route_open_cases_to_period!(period)
        Result.new(period: period, created: created, idempotent: false)
      end
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

      checksum_payload = normalized.transform_values { |value| serialize(value) }.except(:publication_id)
      normalized.merge(request_checksum: CanonicalPayload.checksum(checksum_payload))
    rescue KeyError => e
      raise ArgumentError, "#{e.key} is required"
    rescue TypeError, ArgumentError => e
      raise e unless e.message.match?(/invalid value for Integer|base specified for non string value/)

      raise ArgumentError, "schedule_version and cutoff days must be integers"
    end

    def validate_publishable_time!
      return if attributes.fetch(:cutoff_at) > now

      raise ArgumentError, "cutoff_at must be in the future when published"
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

      reject_overlap!
      PayrollCalendarPeriod.create!(period_attributes.merge(
        status: "scheduled",
        next_finalization_attempt_at: attributes.fetch(:cutoff_at)
      ))
    end

    def revise!(period)
      period.lock!
      if period.status == "finalized" || period.cutoff_at <= now
        raise ConflictError, "A payroll period cannot be revised after its cutoff"
      end

      expected_version = period.schedule_version + 1
      unless attributes.fetch(:schedule_version) == expected_version
        raise ConflictError, "schedule_version must be #{expected_version}"
      end

      reject_overlap!(excluding: period)
      reject_invalid_settlement_routes!(period)
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
      attributes.except(:request_checksum).transform_values { |value| serialize(value) }.merge(
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
          **cutoff_policy
        }
      )
    end
  end
end
