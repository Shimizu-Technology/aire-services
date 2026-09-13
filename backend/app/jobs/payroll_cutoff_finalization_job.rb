# frozen_string_literal: true

class PayrollCutoffFinalizationJob < ApplicationJob
  queue_as :payroll

  def perform
    Payroll::ScheduledCutoffFinalizer.call_due
  end
end
