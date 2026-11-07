# frozen_string_literal: true

# Rails travel_to cannot move PostgreSQL's clock, and the payroll guards and
# revision triggers read it directly. Fixtures pinned to the first production
# cutoff stopped working once that real date passed, so this reruns them with
# the real trigger bodies on a shifted clock. Both clocks keep ticking by the
# same offset, as they did when these specs ran before that date.
#
# The Ruby clock is a plain singleton-method swap, not an RSpec stub: a spec's
# own travel_to aliases whatever Time.now is and restores it afterwards, so it
# always returns to this clock, and the swap is undone after each example.
module DatabaseClockHelpers
  CLOCK_FUNCTIONS = %w[
    capture_payroll_break_revision
    capture_payroll_manual_allocation_revision
    capture_payroll_time_entry_revision
    protect_payroll_calendar_period_after_cutoff
  ].freeze

  def self.included(group)
    group.after do
      travel_back
      restore_ruby_clock
    end
  end

  def shift_database_clock_to(instant)
    connection = ActiveRecord::Base.connection
    unless connection.transaction_open?
      raise "shift_database_clock_to needs a transactional example so the trigger rewrite rolls back"
    end

    # Rewrite from the original bodies so a second shift in one example is safe.
    @original_clock_functions ||= CLOCK_FUNCTIONS.to_h do |name|
      [ name, connection.select_value("SELECT pg_get_functiondef('public.#{name}'::regproc)") ]
    end
    offset = connection.select_value("SELECT EXTRACT(EPOCH FROM clock_timestamp())").to_f - instant.to_f
    shifted = ->(clock) { "(#{clock} - make_interval(secs => #{offset}))" }
    @original_clock_functions.each_value do |definition|
      connection.execute(definition
        .gsub(/\bclock_timestamp\(\)/i, shifted.call("pg_catalog.clock_timestamp()"))
        .gsub(/\bCURRENT_TIMESTAMP\b/i, shifted.call("CURRENT_TIMESTAMP")))
    end
    allow(connection).to receive(:select_value).and_call_original
    allow(connection).to receive(:select_value).with("SELECT clock_timestamp()") do
      connection.select_value("SELECT #{shifted.call('pg_catalog.clock_timestamp()')}")
    end
    shift_ruby_clock(offset)
  end

  private

  def shift_ruby_clock(offset)
    restore_ruby_clock
    @ruby_clock_swaps = [ [ Time, :now ], [ Date, :today ] ].map do |object, name|
      saved = :"__database_clock_saved_#{name}"
      object.singleton_class.alias_method saved, name
      [ object, name, saved ]
    end
    # Read the system clock directly: an enclosing travel_to may already stub Time.now.
    Time.define_singleton_method(:now) { at(Process.clock_gettime(Process::CLOCK_REALTIME) - offset) }
    Date.define_singleton_method(:today) { Time.now.to_date }
  end

  def restore_ruby_clock
    Array(@ruby_clock_swaps).each do |object, name, saved|
      object.singleton_class.silence_redefinition_of_method(name)
      object.singleton_class.alias_method name, saved
      object.singleton_class.undef_method saved
    end
    @ruby_clock_swaps = nil
  end
end
