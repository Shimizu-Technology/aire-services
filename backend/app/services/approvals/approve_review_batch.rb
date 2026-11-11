# frozen_string_literal: true

require "digest"

module Approvals
  # POST /api/v1/time_entries/review_batch. Approves exactly the entries and
  # versions the approver saw, or nothing:
  #
  # - Every item names the version it was shown. Any mismatch (or a row that
  #   is gone or no longer waiting) approves nothing and lists changed_ids.
  # - Overtime is approved only on items that say approve_overtime, with the
  #   overtime hours that were shown. Overtime that appears because the time
  #   was approved stays waiting.
  # - In "ordinary" mode (the default, for group and Approve all actions)
  #   every item must still be ordinary for this viewer. "reviewed" mode is for
  #   a decision made in the Review sheet, one person at a time.
  # - The Idempotency-Key makes a retried request return the same batch.
  class ApproveReviewBatch
    MAX_ITEMS = 100
    MODES = %w[ordinary reviewed].freeze

    class Error < StandardError
      attr_reader :status, :code, :details

      def initialize(message, status:, code:, details: {})
        super(message)
        @status, @code, @details = status, code, details
      end
    end

    Result = Data.define(:batch, :replayed)
    Item = Data.define(:id, :version, :approve_time, :approve_overtime, :overtime_hours)

    def self.call(**args)
      new(**args).call
    end

    def initialize(actor:, items:, idempotency_key:, mode: nil, note: nil)
      @actor = actor
      @raw_items = Array(items)
      @idempotency_key = idempotency_key.to_s.strip
      @mode = mode.presence || "ordinary"
      @note = note.to_s.strip.presence
    end

    def call
      raise invalid("Only managers and admins can approve time", status: :forbidden, code: "forbidden") unless @actor.can_approve_time?

      @items = parse_items
      validate_request!
      existing = ::ReviewBatch.find_by(actor_id: @actor.id, idempotency_key: @idempotency_key)
      return replay(existing) if existing

      Result.new(batch: approve!, replayed: false)
    rescue ActiveRecord::RecordNotUnique
      # The same key raced in from a double tap; the first request won.
      replay(::ReviewBatch.find_by!(actor_id: @actor.id, idempotency_key: @idempotency_key))
    end

    private

    def approve!
      ActiveRecord::Base.transaction do
        # Claim the key first so a concurrent duplicate waits here, before
        # taking any employee or entry locks.
        batch = ::ReviewBatch.create!(actor: @actor, idempotency_key: @idempotency_key,
                                      request_fingerprint: fingerprint, entry_count: @items.size)
        ids = @items.map(&:id)
        # The same employee-before-entry lock order as bulk_approve, single
        # approvals and clock writes.
        User.where(id: TimeEntry.where(id: ids).select(:user_id)).order(:id).lock.load
        entries = TimeEntry.where(id: ids).order(:id).lock.includes(:user, :time_entry_breaks).index_by(&:id)

        ensure_unchanged!(entries)
        ensure_allowed!(entries)
        ensure_ordinary!(entries) if @mode == "ordinary"
        ensure_overtime_as_shown!(entries)

        before = entries.transform_values { |entry| [ entry.lock_version, ReviewBatchItem.review_state(entry) ] }
        approve_entries!(batch, entries)
        record_items!(batch, before)
        record_batch_audit!(batch, entries.values)
        batch
      end
    end

    def approve_entries!(batch, entries)
      metadata = { review_batch_id: batch.public_id }
      reason = "Approved in review batch #{batch.public_id}"
      Payroll::AffectedOvertimeReview.around_entries(entries.values, force: true) do
        @items.each do |item|
          entry = entries.fetch(item.id)
          entry = TimeClockService.approve_entry(entry: entry, approved_by: @actor, note: @note, audit_metadata: metadata) if item.approve_time
          if item.approve_overtime
            TimeClockService.approve_overtime(entry: entry, approved_by: @actor, note: @note, audit_metadata: metadata)
          end
          ReportExport.invalidate_for_entry!(entry_id: entry.id, changed_by: @actor, reason: reason)
        end
      end
    rescue TimeClockService::AuthorizationError => e
      raise invalid(e.message, status: :forbidden, code: "forbidden")
    rescue TimeClockService::ClockError => e
      raise invalid(e.message, code: "not_approvable")
    end

    # Versions and states after the whole batch, including the overtime
    # reconciliation that runs once at the end.
    def record_items!(batch, before)
      after = TimeEntry.where(id: before.keys).index_by(&:id)
      by_id = @items.index_by(&:id)
      now = Time.current
      rows = before.map do |id, (version, state)|
        entry = after.fetch(id)
        item = by_id.fetch(id)
        { review_batch_id: batch.id, time_entry_id: id, version_before: version, version_after: entry.lock_version,
          approved_time: item.approve_time, approved_overtime: item.approve_overtime,
          hours: entry.hours.to_f, overtime_hours: item.approve_overtime ? item.overtime_hours.to_f : 0,
          before_state: state, after_state: ReviewBatchItem.review_state(entry), created_at: now, updated_at: now }
      end
      ReviewBatchItem.insert_all!(rows)
      batch.update!(overtime_count: @items.count(&:approve_overtime), hours: rows.sum { |row| row[:hours] }.round(2))
    end

    def record_batch_audit!(batch, entries)
      people = entries.map(&:user).uniq(&:id)
      single = people.one? ? people.first : nil
      AuditLog.record!(
        action: "review_batch.approved",
        auditable: batch,
        actor: @actor,
        subject_name: "#{shift_phrase(entries.size)} for #{single ? single.full_name : "#{people.size} people"}",
        event_category: "approvals",
        source: "admin",
        metadata: {
          review_batch_id: batch.public_id,
          mode: @mode,
          entry_count: entries.size,
          overtime_count: batch.overtime_count,
          hours: batch.hours.to_f,
          employee_count: people.size,
          employee_id: single&.id,
          employee_name: single&.full_name,
          entry_ids: entries.map(&:id).sort,
          review_note: @note
        }.compact
      )
    end

    def ensure_unchanged!(entries)
      changed = @items.reject do |item|
        entry = entries[item.id]
        entry && entry.lock_version == item.version && waiting_as_requested?(entry, item)
      end
      return if changed.empty?

      count = changed.size
      raise invalid("#{shift_phrase(count)} changed since you loaded this list. Nothing was approved.",
                    status: :conflict, code: "stale_entries", details: { changed_ids: changed.map(&:id) })
    end

    # Time is approved only while waiting, and overtime only while its overtime
    # waits. Overtime-only items need the time already approved.
    def waiting_as_requested?(entry, item)
      return false if item.approve_time && entry.approval_status != "pending"
      return false if !item.approve_time && entry.approval_status == "pending"
      return false if item.approve_overtime && entry.overtime_status != "pending"

      true
    end

    def ensure_allowed!(entries)
      return if entries.each_value.all? { |entry| @actor.can_review_time_of?(entry.user_id) }

      raise invalid("#{TimeClockService::OWN_TIME_REVIEW_MESSAGE}. Remove your own shifts and try again.",
                    status: :forbidden, code: "own_time")
    end

    def ensure_ordinary!(entries)
      kinds = ReviewClassifier.call(entries.values, viewer: @actor)
      needs_look = @items.map(&:id).reject { |id| kinds.dig(id, :review_kind) == ReviewClassifier::ORDINARY }
      return if needs_look.empty?

      raise invalid("#{shift_phrase(needs_look.size)} now #{needs_look.one? ? 'needs' : 'need'} a look. Nothing was approved.",
                    status: :conflict, code: "needs_look", details: { changed_ids: needs_look })
    end

    # The overtime hours must still be what the approver saw.
    def ensure_overtime_as_shown!(entries)
      overtime = @items.select(&:approve_overtime)
      return if overtime.empty?

      allocations = Payroll::AffectedOvertimeReview.projected_allocations_for(overtime.map { |item| entries.fetch(item.id) })
      changed = overtime.reject do |item|
        allocations.dig(item.id, :overtime_hours).to_f.round(2) == item.overtime_hours.to_f.round(2)
      end
      return if changed.empty?

      raise invalid("The overtime on #{shift_phrase(changed.size)} changed since you loaded this list. Nothing was approved.",
                    status: :conflict, code: "stale_entries", details: { changed_ids: changed.map(&:id) })
    end

    def replay(batch)
      unless batch.request_fingerprint == fingerprint
        raise invalid("This Idempotency-Key was already used for a different approval", code: "idempotency_key_reused")
      end

      Result.new(batch: batch, replayed: true)
    end

    def validate_request!
      raise invalid("An Idempotency-Key header is required", code: "idempotency_key_required") if @idempotency_key.blank?
      raise invalid("The Idempotency-Key is too long", code: "invalid_request") if @idempotency_key.length > 255
      raise invalid("Unknown review mode", code: "invalid_request") unless MODES.include?(@mode)
      raise invalid("Choose at least one shift to approve", code: "invalid_request") if @items.empty?
      raise invalid("Approve at most #{MAX_ITEMS} shifts at a time", code: "too_many_items") if @items.size > MAX_ITEMS
      raise invalid("Each shift can appear only once", code: "invalid_request") if @items.map(&:id).uniq.size != @items.size
      raise invalid("Each shift needs approve_time or approve_overtime", code: "invalid_request") if @items.any? { |item| !item.approve_time && !item.approve_overtime }
      return unless @items.any? { |item| item.approve_overtime && item.overtime_hours.nil? }

      raise invalid("Send the overtime hours shown for each overtime approval", code: "invalid_request")
    end

    def parse_items
      @raw_items.map do |raw|
        raw = raw.to_h.with_indifferent_access
        Item.new(id: positive_integer(raw[:id]), version: non_negative_integer(raw[:version]),
                 approve_time: boolean(raw[:approve_time]), approve_overtime: boolean(raw[:approve_overtime]),
                 overtime_hours: raw[:overtime_hours].presence && Float(raw[:overtime_hours].to_s))
      end
    rescue ArgumentError, TypeError
      raise invalid("Each shift needs an id, a version and the overtime hours as numbers", code: "invalid_request")
    end

    def positive_integer(value)
      Integer(value.to_s, 10).tap { |number| raise ArgumentError unless number.positive? }
    end

    def non_negative_integer(value)
      Integer(value.to_s, 10).tap { |number| raise ArgumentError if number.negative? }
    end

    def boolean(value)
      ActiveModel::Type::Boolean.new.cast(value) == true
    end

    def fingerprint
      @fingerprint ||= Digest::SHA256.hexdigest([ @mode, @note, @items.sort_by(&:id).map(&:to_h) ].to_json)
    end

    def shift_phrase(count)
      "#{count} #{count == 1 ? 'shift' : 'shifts'}"
    end

    def invalid(message, status: :unprocessable_entity, code:, details: {})
      Error.new(message, status: status, code: code, details: details)
    end
  end
end
