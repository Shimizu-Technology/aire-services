# frozen_string_literal: true

require "set"

module Payroll
  class TimeEntryRevisionLedger
    attr_reader :cutoff_at

    def initialize(cutoff_at:)
      @cutoff_at = cutoff_at
    end

    def available?
      return @available if defined?(@available)

      @available = PayrollTimeEntryRevision.where("recorded_at <= ?", cutoff_at).exists?
    end

    def entries_in_range(range)
      states(latest_scope.where(source_work_date: range))
    end

    def entries_for_ids(ids)
      ids = Array(ids).compact.uniq
      return [] if ids.empty?

      states(latest_scope_for(source_time_entry_id: ids))
    end

    def entries_for_pairs(pairs)
      pairs = pairs.to_set
      return [] if pairs.empty?

      user_ids = pairs.map(&:first).uniq
      week_starts = pairs.map(&:last)
      work_dates = week_starts.min..(week_starts.max + 6.days)
      states(latest_scope.where(source_user_id: user_ids, source_work_date: work_dates))
        .select { |entry| pairs.include?([ entry.user_id, entry.work_date.beginning_of_week(:sunday) ]) }
    end

    def entries_created_after_cutoff_in_range(range)
      states(first_post_cutoff_create_scope.where(source_work_date: range))
    end

    def entries_created_after_cutoff_for_pairs(pairs)
      pairs = pairs.to_set
      return [] if pairs.empty?

      user_ids = pairs.map(&:first).uniq
      week_starts = pairs.map(&:last)
      work_dates = week_starts.min..(week_starts.max + 6.days)
      states(first_post_cutoff_create_scope.where(source_user_id: user_ids, source_work_date: work_dates))
        .select { |entry| pairs.include?([ entry.user_id, entry.work_date.beginning_of_week(:sunday) ]) }
    end

    private

    def latest_scope_for(filters = {})
      source = PayrollTimeEntryRevision
        .where("recorded_at <= ?", cutoff_at)
        .where(filters)
        .select("DISTINCT ON (source_time_entry_id) payroll_time_entry_revisions.*")
        .order(:source_time_entry_id, recorded_at: :desc, id: :desc)

      PayrollTimeEntryRevision
        .from("(#{source.to_sql}) payroll_time_entry_revisions")
        .where(deleted: false)
    end

    def latest_scope
      latest_scope_for
    end

    def first_post_cutoff_create_scope
      source = PayrollTimeEntryRevision
        .where("recorded_at > ?", cutoff_at)
        .where(deleted: false)
        .where("(snapshot -> 'time_entry' ->> 'created_at')::timestamp > ?", cutoff_at)
        .select("DISTINCT ON (source_time_entry_id) payroll_time_entry_revisions.*")
        .order(:source_time_entry_id, :recorded_at, :id)

      PayrollTimeEntryRevision.from("(#{source.to_sql}) payroll_time_entry_revisions")
    end

    def states(scope)
      scope.order(:source_time_entry_id).map(&:time_entry_state)
    end
  end
end
