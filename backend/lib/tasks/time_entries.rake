# frozen_string_literal: true

namespace :time_entries do
  desc "Read-only JSONL audit of long clocks and saved-hours discrepancies; never repairs entries"
  task audit_clock_anomalies: :environment do
    TimeEntryClockAnomalyReport.new.each_row { |row| puts JSON.generate(row) }
  end

  desc "Auto-close time entries that have been clocked in for >12 hours (forgotten clock-outs)"
  task flag_stale: :environment do
    threshold = ENV.fetch("STALE_THRESHOLD_HOURS", "12").to_i
    count = TimeClockService.flag_stale_entries(threshold_hours: threshold)
    if count > 0
      puts "Flagged #{count} stale time entr#{count == 1 ? 'y' : 'ies'} (>#{threshold}h)"
    else
      puts "No stale time entries found"
    end
  end
end
