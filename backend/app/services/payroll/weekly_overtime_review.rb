# frozen_string_literal: true

require "set"

module Payroll
  # A fresh, request-scoped allocation map: never cache source approvals or
  # hours across calls. Reuse complete report context when it is already loaded.
  class WeeklyOvertimeReview
    PAIR_QUERY_BATCH_SIZE = 250

    def self.call(entries, context_entries: nil, allocations: nil)
      flagged = entries.select do |entry|
        entry.overtime_status.in?(%w[pending denied]) && entry.counts_toward_hours?
      end
      return {} if flagged.empty?

      unless allocations
        pairs = flagged.map { |entry| [ entry.user_id, entry.work_date.beginning_of_week(:sunday) ] }.to_set
        context = context_entries || context_for(pairs)
        eligible = context.select do |entry|
          entry.counts_toward_hours? && pairs.include?([ entry.user_id, entry.work_date.beginning_of_week(:sunday) ])
        end
        allocations = eligible.group_by(&:user_id).each_with_object({}) do |(_user_id, user_entries), result|
          result.merge!(WeeklyOvertimeAllocator.call(user_entries))
        end
      end
      flagged.index_with { |entry| allocations.fetch(entry.id, {}).fetch(:overtime_hours, 0).positive? }
        .transform_keys(&:id)
    end

    def self.context_for(pairs)
      pairs.to_a.each_slice(PAIR_QUERY_BATCH_SIZE).flat_map do |slice|
        records = slice.map { |user_id, week_start| { user_id: user_id, week_start: week_start.iso8601 } }
        join_sql = ActiveRecord::Base.sanitize_sql_array([
          <<~SQL.squish,
            INNER JOIN jsonb_to_recordset(?::jsonb) AS overtime_review_pairs(user_id bigint, week_start date)
              ON overtime_review_pairs.user_id = time_entries.user_id
             AND time_entries.work_date BETWEEN overtime_review_pairs.week_start AND overtime_review_pairs.week_start + 6
          SQL
          records.to_json
        ])
        TimeEntry.countable.joins(join_sql).to_a
      end
    end
    private_class_method :context_for
  end
end
