# frozen_string_literal: true

# Rails travel_to cannot move PostgreSQL's clock, and the payroll guards and
# revision triggers read it directly. Fixtures pinned to the first production
# cutoff stopped working once that real date passed, so this reruns them with
# the real trigger bodies on a shifted clock. Both clocks keep ticking by the
# same offset; a spec's own travel_to still works and returns to this clock.
# It relies on transactional fixtures: the rewritten functions roll back.
module DatabaseClockHelpers
  CLOCK_FUNCTIONS = %w[
    capture_payroll_break_revision
    capture_payroll_manual_allocation_revision
    capture_payroll_time_entry_revision
    protect_payroll_calendar_period_after_cutoff
  ].freeze

  def shift_database_clock_to(instant)
    connection = ActiveRecord::Base.connection
    offset = connection.select_value("SELECT EXTRACT(EPOCH FROM clock_timestamp())").to_f - instant.to_f
    shifted = ->(clock) { "(#{clock} - make_interval(secs => #{offset}))" }
    CLOCK_FUNCTIONS.each do |name|
      definition = connection.select_value("SELECT pg_get_functiondef('public.#{name}'::regproc)")
      connection.execute(definition
        .gsub(/\bclock_timestamp\(\)/i, shifted.call("pg_catalog.clock_timestamp()"))
        .gsub(/\bCURRENT_TIMESTAMP\b/i, shifted.call("CURRENT_TIMESTAMP")))
    end
    allow(connection).to receive(:select_value).and_call_original
    allow(connection).to receive(:select_value).with("SELECT clock_timestamp()") do
      connection.select_value("SELECT #{shifted.call('pg_catalog.clock_timestamp()')}")
    end

    # Read the system clock directly: an enclosing travel_to may already stub Time.now.
    allow(Time).to receive(:now) { Time.at(Process.clock_gettime(Process::CLOCK_REALTIME) - offset) }
    allow(Date).to receive(:today) { Time.now.to_date }
  end
end
