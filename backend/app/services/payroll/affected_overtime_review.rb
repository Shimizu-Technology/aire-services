# frozen_string_literal: true

module Payroll
  # Every normal source mutation uses the same employee lock, before locking
  # entry rows. This is stronger than a week lock and serializes cross-week
  # moves/overnights without acquiring two week locks in opposite orders.
  class AffectedOvertimeReview
    INPUTS = %w[user_id work_date start_time end_time clock_in_at clock_out_at hours break_minutes time_category_id status approval_status].freeze

    def self.lock(user_ids)
      User.where(id: user_ids.compact.uniq.sort).order(:id).lock.load
      yield
    end

    def self.around(entry)
      return yield if entry.skip_overtime_recomputation

      ids = [ entry.user_id, entry.attribute_in_database("user_id") ].compact.uniq
      lock(ids) do
        before = allocations(ids)
        previous = entry.persisted? ? TimeEntry.find_by(id: entry.id) : nil
        result = yield
        after = allocations(ids)
        context = TimeEntry.where(user_id: ids).index_by(&:id)
        context.each_value do |row|
          old_signature = signature(previous&.id == row.id ? previous : row, before[row.id])
          new_signature = signature(row, after[row.id])
          prior_signature = row.overtime_allocation_signature || old_signature
          changed = prior_signature != new_signature
          overtime = after.dig(row.id, :overtime_hours).to_f.positive?
          # Explicit decisions only authorize this exact allocation. Evidence
          # on unchanged siblings remains byte-identical.
          next if !changed && row.overtime_allocation_signature.nil?

          attrs = { overtime_allocation_signature: new_signature }
          if changed && !(row.overtime_status == "pending" && !overtime && before.dig(row.id, :overtime_hours).to_f.zero?) && !(previous.nil? && row.id == entry.id && row.overtime_status.in?(%w[pending approved denied]))
            attrs.merge!(overtime_status: overtime ? "pending" : "none",
              overtime_approved_by_id: nil, overtime_approved_at: nil, overtime_note: nil)
          end
          next if attrs.all? { |key, value| row.public_send(key) == value }

          target = row.id == entry.id ? entry : row
          if target.equal?(entry)
            target.update_columns(attrs.merge(updated_at: Time.current))
          else
            target.skip_overtime_recomputation = true
            target.assign_attributes(attrs)
            target.save!(validate: false)
          end
        end
        result
      end
    end

    def self.allocations(ids)
      TimeEntry.where(user_id: ids).includes(:time_entry_breaks).to_a.group_by(&:user_id).each_with_object({}) do |(_id, entries), result|
        result.merge!(WeeklyOvertimeAllocator.call(entries.select(&:counts_toward_hours?)))
      end
    end

    def self.signature(entry, allocation)
      return [] unless entry && allocation

      [ entry.user_id, entry.time_category_id, allocation[:hold_reason],
        allocation.fetch(:segments, []).map { |s| [ s[:work_date].iso8601, s[:regular_hours], s[:overtime_hours] ] } ]
    end
  end
end
