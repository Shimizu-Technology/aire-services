# frozen_string_literal: true

module Approvals
  # Moves a review batch's shifts back to waiting, exactly as they were before
  # the approval (time and any overtime the batch approved). Approvals commit
  # immediately; this is a real, audited reversal, not a delayed send.
  #
  # Allowed for the approver, or an owner or admin, for 15 minutes. All or
  # nothing: refused if any shift changed after the approval, or a payroll
  # lock or finalized batch now covers it. The window and the lock check use
  # the database clock, read after the locks are held, like the payroll freeze
  # and Payroll::PendingCutoffClaimGuard.
  #
  # Only the review fields (ReviewBatchItem::REVIEW_FIELDS) are put back.
  # overtime_allocation_signature and allocation_contract_version are
  # recalculated for the week by Payroll::AffectedOvertimeReview, not restored
  # from before the approval.
  class UndoReviewBatch
    Error = ApproveReviewBatch::Error

    def self.call(**args)
      new(**args).call
    end

    def initialize(batch:, actor:, entry_ids: nil)
      @batch = batch
      @actor = actor
      @entry_ids = entry_ids&.map(&:to_i)
    end

    def call
      ensure_permitted!

      ActiveRecord::Base.transaction do
        @batch.lock!
        items = selected_items
        user_ids = TimeEntry.where(id: items.map(&:time_entry_id)).distinct.pluck(:user_id)
        User.lock_employees!(user_ids)
        entries = TimeEntry.where(id: items.map(&:time_entry_id)).order(:id).lock.includes(:user, :time_entry_breaks).index_by(&:id)
        @now = ActiveRecord::Base.connection.select_value("SELECT clock_timestamp()")
        raise error("The 15 minutes to undo this approval have passed. Correct it in Timecards instead.", code: "undo_expired") unless @batch.undo_window_open?(@now)

        ensure_reviewable!(entries)
        ensure_undoable!(items, entries)
        OvertimeResetAudit.around(entries.values, actor: @actor, except_ids: entries.keys,
                                  metadata: { review_batch_id: @batch.public_id, reason: "approval_undone" }) do
          restore!(items, entries)
        end
        @batch.update!(undone_at: @now, undone_by: @actor) unless @batch.review_batch_items.active.exists?
        record_batch_audit!(items, entries)
        items.map { |item| entries.fetch(item.time_entry_id) }
      end
    end

    private

    def ensure_permitted!
      return if @actor.can_approve_time? && (@batch.actor_id == @actor.id || @actor.administrator?)

      raise error("Only the person who approved these shifts, or an owner or admin, can undo it.", status: :forbidden, code: "undo_forbidden")
    end

    def selected_items
      items = @batch.review_batch_items.active.order(:time_entry_id).lock.to_a
      if @entry_ids
        unknown = @entry_ids - items.map(&:time_entry_id)
        raise error("Those shifts aren't part of this approval, or were already moved back.", code: "already_undone") if unknown.any?

        items.select! { |item| @entry_ids.include?(item.time_entry_id) }
      end
      raise error("This approval was already undone.", code: "already_undone") if items.empty?

      items
    end

    def ensure_reviewable!(entries)
      return if entries.each_value.all? { |entry| @actor.can_review_time_of?(entry.user_id) }

      raise error(TimeClockService::OWN_TIME_REVIEW_MESSAGE, status: :forbidden, code: "own_time")
    end

    # Same version and review fields as right after the approval, and no lock.
    def ensure_undoable!(items, entries)
      locked_ids = LockedEntries.call(entries.values, now: @now)
      blocked = items.filter_map do |item|
        entry = entries[item.time_entry_id]
        reason = if entry.nil? || entry.lock_version != item.version_after || ReviewBatchItem.review_state(entry) != item.after_state
          "changed"
        elsif locked_ids.include?(entry.id)
          "locked"
        end
        next unless reason

        { id: item.time_entry_id, work_date: entry&.work_date&.iso8601, reason: reason }
      end
      return if blocked.empty?

      raise error(refusal_message(blocked, items.size), status: :conflict, code: "undo_refused", details: { blocked: blocked })
    end

    def restore!(items, entries)
      Payroll::AffectedOvertimeReview.around_entries(entries.values, force: true) do
        items.each do |item|
          entry = entries.fetch(item.time_entry_id)
          entry.assign_attributes(item.before_state.slice(*ReviewBatchItem::REVIEW_FIELDS))
          entry.save!
        end
      end
      # One reload for the whole batch, after the reconciliation.
      entries.merge!(TimeEntry.where(id: entries.keys).includes(:user).index_by(&:id))
      items.each do |item|
        entry = entries.fetch(item.time_entry_id)
        # The week's overtime reconciliation ran once above for everyone it
        # affects. Put back this shift's own overtime review exactly as it was;
        # its allocation signature stays as the reconciliation set it.
        overtime = item.before_state.slice("overtime_status", "overtime_approved_by_id", "overtime_approved_at", "overtime_note")
        entry.update_columns(overtime.merge("updated_at" => @now)) if ReviewBatchItem.review_state(entry).slice(*overtime.keys) != overtime
        record_entry_audit!(entry, item)
      end
      ReviewBatchItem.where(id: items.map(&:id)).update_all(undone_at: @now, undone_by_id: @actor.id, updated_at: @now)
      ReportExport.invalidate_for_entries!(entry_ids: entries.keys, changed_by: @actor,
                                           reason: "Approval undone from review batch #{@batch.public_id}")
    end

    def record_entry_audit!(entry, item)
      AuditLog.record!(
        action: "time_entry.approval_undone",
        auditable: entry,
        actor: @actor,
        event_category: "approvals",
        source: "admin",
        metadata: {
          review_batch_id: @batch.public_id,
          employee_id: entry.user_id,
          employee_name: entry.user&.full_name,
          work_date: entry.work_date&.iso8601,
          hours: entry.hours.to_f,
          time_reverted: item.approved_time,
          overtime_reverted: item.approved_overtime,
          approved_by_id: @batch.actor_id
        }
      )
    end

    def record_batch_audit!(items, entries)
      people = entries.values.map(&:user).uniq(&:id)
      single = people.one? ? people.first : nil
      AuditLog.record!(
        action: "review_batch.undone",
        auditable: @batch,
        actor: @actor,
        subject_name: "#{items.size} #{items.one? ? 'shift' : 'shifts'} for #{single ? single.full_name : "#{people.size} people"}",
        event_category: "approvals",
        source: "admin",
        metadata: {
          review_batch_id: @batch.public_id,
          entry_count: items.size,
          overtime_count: items.count(&:approved_overtime),
          employee_count: people.size,
          employee_id: single&.id,
          employee_name: single&.full_name,
          entry_ids: items.map(&:time_entry_id),
          approved_by_id: @batch.actor_id,
          approved_by_name: @batch.actor&.full_name
        }.compact
      )
    end

    def refusal_message(blocked, total)
      first = blocked.first
      day = first[:work_date] ? Date.iso8601(first[:work_date]).strftime("%a, %b %-d") : "One shift"
      why = first[:reason] == "locked" ? "is already locked for payroll" : "changed after it was approved"
      lead = total == 1 ? "Can't undo this approval" : "Can't undo #{blocked.size} of #{total}"
      "#{lead}: #{day} #{why}. Nothing was moved back. Ask an admin to correct it in Timecards."
    end

    def error(message, code:, status: :conflict, details: {})
      Error.new(message, status: status, code: code, details: details)
    end

    # Entries a payroll lock or finalized batch now covers.
    class LockedEntries
      def self.call(entries, now:)
        return Set.new if entries.empty?

        dates = entries.map(&:work_date)
        periods = PayrollCalendarPeriod.scheduled_locks.where(cutoff_at: ..now)
          .or(PayrollCalendarPeriod.where(status: "finalized"))
          .overlapping(dates.min, dates.max).pluck(:start_date, :end_date)
        periods += PayrollBatch.where("start_date <= ? AND end_date >= ?", dates.max, dates.min).pluck(:start_date, :end_date)
        in_batch = PayrollBatchEntry.where(source_time_entry_id: entries.map(&:id)).distinct.pluck(:source_time_entry_id) +
          PayrollBatchExclusion.where(source_time_entry_id: entries.map(&:id)).distinct.pluck(:source_time_entry_id)
        entries.select do |entry|
          in_batch.include?(entry.id) || periods.any? { |starts_on, ends_on| entry.work_date.between?(starts_on, ends_on) }
        end.map(&:id).to_set
      end
    end
  end
end
