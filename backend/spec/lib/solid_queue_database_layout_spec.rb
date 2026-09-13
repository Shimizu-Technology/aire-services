# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Solid Queue database layout" do
  it "installs the queue tables through the primary migration path" do
    expected_tables = %w[
      solid_queue_jobs
      solid_queue_processes
      solid_queue_ready_executions
      solid_queue_recurring_tasks
      solid_queue_scheduled_executions
    ]

    expect(expected_tables).to all(satisfy { |table| ActiveRecord::Base.connection.data_source_exists?(table) })
  end
end
