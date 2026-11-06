# frozen_string_literal: true

# Detection only: actual and nominal endpoints can intentionally differ. Never
# infer a payable correction from this report, including for previously paid rows.
class TimeEntryClockAnomalyReport
  def initialize(observed_at: Time.current)
    @observed_at = observed_at
  end

  def each_row
    return enum_for(:each_row) unless block_given?

    ActiveRecord::Base.while_preventing_writes do
      TimeEntry.where(entry_method: "clock").where.not(clock_in_at: nil).includes(:user).find_in_batches(batch_size: 200) do |entries|
        anomalies = entries.filter_map { |entry| anomaly(entry) }
        lifecycles = Payroll::EntryLifecycleResolver.new(entries: anomalies.map(&:first)).call
        anomalies.each do |entry, row|
          lifecycle = lifecycles.fetch(entry.id)
          yield row.merge(
            payroll_status: lifecycle.fetch(:status),
            settlements: lifecycle.fetch(:settlements).map { |settlement| settlement.slice(:batch_id, :status, :total_hours, :paid_hours, :prepared_hours, :outstanding_hours) },
            exports: ReportExport.where("entry_ids @> ?", [ entry.id ].to_json).order(:id).map do |export|
              { public_id: export.public_id, state: export.state, protects_entries: export.protects_entries }
            end
          )
        end
      end
    end
  end

  private

  def anomaly(entry)
    span = ((entry.clock_out_at || @observed_at) - entry.clock_in_at) / 3600.0
    net = entry.clock_out_at && span - entry.break_minutes.to_f / 60
    difference = net && entry.hours.to_f - net
    flags = []
    flags << "elapsed_at_least_24h" if span >= TimeEntry::MAX_CLOCK_SPAN / 3600.0
    flags << "saved_hours_discrepancy" if difference && difference.abs >= 1
    return if flags.empty?

    [ entry, {
      id: entry.id, user: { id: entry.user_id, name: entry.user.full_name }, work_date: entry.work_date.iso8601,
      status: entry.status, approval_status: entry.approval_status, saved_hours: entry.hours.to_f,
      clock_in_at: entry.clock_in_at.iso8601(6), clock_out_at: entry.clock_out_at&.iso8601(6),
      observed_at: @observed_at.iso8601(6), span_basis: entry.clock_out_at ? "actual_punches" : "open_as_of_report",
      actual_elapsed_hours: span.round(6), break_minutes: entry.break_minutes,
      net_elapsed_hours: net&.round(6), hours_difference: difference&.round(6), flags: flags
    } ]
  end
end
