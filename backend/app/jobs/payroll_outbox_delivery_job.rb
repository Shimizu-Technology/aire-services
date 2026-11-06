# frozen_string_literal: true

class PayrollOutboxDeliveryJob < ApplicationJob
  queue_as :payroll

  def perform(event_id = nil)
    if event_id
      result = Payroll::OutboxDispatcher.new(event_id: event_id).call
      retry_job(wait: 1.minute) if result[:status] == "paused"
    else
      Payroll::OutboxDispatcher.call_due
    end
  end
end
