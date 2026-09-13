# frozen_string_literal: true

class PayrollOutboxDeliveryJob < ApplicationJob
  queue_as :payroll

  def perform(event_id = nil)
    if event_id
      Payroll::OutboxDispatcher.new(event_id: event_id).call
    else
      Payroll::OutboxDispatcher.call_due
    end
  end
end
