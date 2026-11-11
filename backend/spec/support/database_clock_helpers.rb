# frozen_string_literal: true

# Rails travel_to cannot move PostgreSQL's clock, and the payroll guards and
# revision triggers read it directly. Fixtures pinned to the first production
# cutoff stopped working once that real date passed, so this reruns them with
# the real trigger bodies on a shifted clock. Both clocks keep ticking by the
# same offset, as they did when these specs ran before that date.
#
# Use it as the outermost around hook of a transactional example group:
#
#   around { |example| with_shifted_database_clock(instant) { example.run } }
#
# It sets up before any travel_to in the example and tears down after it, so
# Rails time stubs always unwind onto this clock and nothing leaks onward. The
# trigger rewrite rolls back with the example transaction.
module DatabaseClockHelpers
  CLOCK_FUNCTIONS = %w[
    capture_payroll_break_revision
    capture_payroll_manual_allocation_revision
    capture_payroll_time_entry_revision
    protect_payroll_calendar_period_after_cutoff
  ].freeze

  def with_shifted_database_clock(instant)
    connection = ActiveRecord::Base.connection
    unless connection.transaction_open?
      raise "with_shifted_database_clock needs a transactional example so the trigger rewrite rolls back"
    end

    # Whole microseconds, so both clocks shift by the same exact amount.
    database_epoch = connection.select_value("SELECT EXTRACT(EPOCH FROM clock_timestamp())")
    offset_usec = ((database_epoch.to_r - instant.to_r) * 1_000_000).round
    shifted = ->(clock) { "(#{clock} - #{offset_usec} * interval '1 microsecond')" }
    CLOCK_FUNCTIONS.each do |name|
      definition = connection.select_value("SELECT pg_get_functiondef('public.#{name}'::regproc)")
      connection.execute(definition
        .gsub(/\bclock_timestamp\(\)/i, shifted.call("pg_catalog.clock_timestamp()"))
        .gsub(/\bCURRENT_TIMESTAMP\b/i, shifted.call("CURRENT_TIMESTAMP")))
    end

    swaps = []
    real_select_value = connection.method(:select_value)
    database_now = "SELECT #{shifted.call('pg_catalog.clock_timestamp()')}"
    connection.define_singleton_method(:select_value) do |sql, *args, **options|
      real_select_value.call(sql == "SELECT clock_timestamp()" ? database_now : sql, *args, **options)
    end
    swaps << -> { connection.singleton_class.remove_method(:select_value) }

    [ [ Time, :now ], [ Date, :today ] ].each do |object, name|
      saved = :"__database_clock_saved_#{name}"
      object.singleton_class.alias_method saved, name
      swaps << lambda do
        object.singleton_class.silence_redefinition_of_method(name)
        object.singleton_class.alias_method name, saved
        object.singleton_class.undef_method saved
      end
    end
    # Read the system clock directly rather than through any stubbed Time.now.
    # Integer nanoseconds, like the real Time.now: a Float time can carry a
    # sub-nanosecond tail that Rails' microsecond rounding leaves in memory
    # while PostgreSQL stores only the microseconds, so reload would differ.
    offset_nsec = offset_usec * 1_000
    Time.define_singleton_method(:now) do
      at(Rational(Process.clock_gettime(Process::CLOCK_REALTIME, :nanosecond) - offset_nsec, 1_000_000_000))
    end
    Date.define_singleton_method(:today) { Time.now.to_date }

    yield
  ensure
    travel_back
    Array(swaps).reverse_each(&:call)
  end
end
