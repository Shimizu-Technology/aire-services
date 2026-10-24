# frozen_string_literal: true

module Payroll
  # Employee locks precede entry locks. Only affected weeks are reconciled;
  # adjacent-week context is loaded when an overlapping entry bridges them.
  class AffectedOvertimeReview
    INPUTS = %w[user_id work_date start_time end_time clock_in_at clock_out_at hours break_minutes time_category_id status approval_status].freeze
    ACTIVE_KEY = :payroll_affected_overtime_entries

    def self.lock_users!(user_ids)
      User.where(id: user_ids.compact.uniq.sort).order(:id).lock.load
    end

    def self.lock(user_ids)
      lock_users!(user_ids)
      yield
    end

    def self.around(entry, force: false, &block)
      around_entries([ entry ], force: force, &block)
    end

    # A correction or bulk decision shares one before snapshot and one final
    # comparison. Nested source/break callbacks do not repeat the allocation.
    def self.around_entries(entries, force: false)
      active = ActiveSupport::IsolatedExecutionState[ACTIVE_KEY] ||= []
      entries = entries.reject do |entry|
        entry.skip_overtime_recomputation || active.any? { |row| row.equal?(entry) || (row.id && row.id == entry.id) }
      end
      return yield if entries.empty? || (!force && entries.all? { |entry| unrelated_save?(entry) })

      ids = entries.flat_map { |entry| [ entry.user_id, entry.attribute_in_database("user_id") ] }.compact.uniq
      lock(ids) do
        previous = TimeEntry.where(id: entries.select(&:persisted?).map(&:id)).includes(:time_entry_breaks).to_a
        active.concat(entries)
        begin
          result = yield
          reconcile(entries, previous)
          result
        ensure
          entries.each { |entry| active.delete(entry) }
          ActiveSupport::IsolatedExecutionState.delete(ACTIVE_KEY) if active.empty?
        end
      end
    end

    def self.unrelated_save?(entry)
      entry.persisted? && entry.allocation_contract_version == WeeklyOvertimeAllocator::CONTRACT_VERSION &&
        !entry.overtime_allocation_signature.nil? && (entry.changes.keys & INPUTS).empty?
    end

    def self.reconcile(entries, previous)
      by_id = entries.index_by(&:id)
      current = TimeEntry.where(id: by_id.keys).includes(:time_entry_breaks).to_a
      pairs = pairs_for(previous + current)
      return if pairs.empty?

      candidates = context_for_pairs(pairs)
      candidate_ids = candidates.map(&:id).to_set
      # A Saturday candidate's other segment needs its complete week too.
      context_pairs = pairs_for(candidates + previous)
      rows = (context_pairs - pairs).empty? ? candidates : context_for_pairs(context_pairs)
      before_rows = rows.reject { |row| by_id.key?(row.id) } + previous
      before = allocations(before_rows)
      after = allocations(rows)
      legacy = allocations(before_rows, legacy: true) if previous.any? { |row| row.allocation_contract_version.nil? } || candidates.any? { |row| row.allocation_contract_version.nil? }
      before_by_id = before_rows.index_by(&:id)
      rows.select { |row| candidate_ids.include?(row.id) }.each do |row|
        old = before_by_id[row.id]
        baseline = old && old.allocation_contract_version.nil? && row.overtime_allocation_signature.nil? ? legacy : before
        old_signature = signature(old, baseline&.dig(row.id))
        new_signature = signature(row, after[row.id])
        changed = (row.overtime_allocation_signature || old_signature) != new_signature
        overtime = after.dig(row.id, :overtime_hours).to_f.positive?
        # No blanket upgrade stamp: unchanged legacy approvals remain intact.
        next if !changed && row.overtime_allocation_signature.nil?

        attrs = { overtime_allocation_signature: new_signature }
        if changed && !(row.overtime_status == "pending" && !overtime && before.dig(row.id, :overtime_hours).to_f.zero?) && !(old.nil? && by_id.key?(row.id) && row.overtime_status.in?(%w[pending approved denied]))
          attrs.merge!(overtime_status: overtime ? "pending" : "none",
            overtime_approved_by_id: nil, overtime_approved_at: nil, overtime_note: nil)
        end
        next if attrs.all? { |key, value| row.public_send(key) == value }

        if by_id.key?(row.id)
          by_id.fetch(row.id).update_columns(attrs.merge(updated_at: Time.current))
        else
          row.skip_overtime_recomputation = true
          row.assign_attributes(attrs)
          row.save!(validate: false)
        end
      end
    end

    def self.pairs_for(rows)
      rows.flat_map { |row| WeeklyOvertimeAllocator.weeks(row).map { |week| [ row.user_id, week ] } }.to_set
    end

    def self.context_for_pairs(pairs)
      scopes = pairs.map { |user_id, week| TimeEntry.where(user_id: user_id, work_date: (week - 1)..(week + 6)) }
      scopes.reduce(&:or).includes(:time_entry_breaks).to_a.select do |row|
        WeeklyOvertimeAllocator.weeks(row).any? { |week| pairs.include?([ row.user_id, week ]) }
      end
    end

    def self.allocation_for(entry)
      pairs = pairs_for([ entry ])
      candidates = context_for_pairs(pairs)
      context_pairs = pairs_for(candidates)
      rows = (context_pairs - pairs).empty? ? candidates : context_for_pairs(context_pairs)
      allocations(rows)[entry.id]
    end

    def self.allocations(rows, legacy: false)
      rows.group_by(&:user_id).each_with_object({}) do |(_id, entries), result|
        eligible = entries.select(&:counts_toward_hours?)
        result.merge!(legacy ? WeeklyOvertimeAllocator.legacy_call(eligible) : WeeklyOvertimeAllocator.call(eligible))
      end
    end

    def self.approval_valid?(entry, allocation, legacy_allocation: nil)
      return false unless entry.overtime_status == "approved" && allocation && !allocation[:hold_reason]

      current = signature(entry, allocation)
      if entry.allocation_contract_version == WeeklyOvertimeAllocator::CONTRACT_VERSION
        entry.overtime_allocation_signature == current
      elsif entry.allocation_contract_version.nil?
        legacy_allocation && signature(entry, legacy_allocation) == current
      else
        false
      end
    end

    def self.signature(entry, allocation)
      return [] unless entry && allocation

      segments = allocation.fetch(:segments) { [ allocation.merge(work_date: entry.work_date) ] }
      [ entry.user_id, entry.time_category_id, allocation[:hold_reason],
        segments.map { |s| [ s[:work_date].iso8601, s[:regular_hours], s[:overtime_hours] ] } ]
    end
  end
end
