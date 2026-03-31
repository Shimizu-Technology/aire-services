# frozen_string_literal: true

namespace :time_entries do
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
