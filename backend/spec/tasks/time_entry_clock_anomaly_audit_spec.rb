# frozen_string_literal: true

require "rails_helper"
require "rake"

RSpec.describe "time_entries:audit_clock_anomalies" do
  it "prints each read-only report row as JSON without invoking the stale-clock closer" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("time_entries:audit_clock_anomalies")
    task = Rake::Task["time_entries:audit_clock_anomalies"]
    task.reenable
    service = instance_double(TimeEntryClockAnomalyReport)
    allow(TimeEntryClockAnomalyReport).to receive(:new).and_return(service)
    allow(service).to receive(:each_row).and_yield({ id: 42, flags: [ "elapsed_at_least_24h" ] })
    expect(TimeClockService).not_to receive(:flag_stale_entries)
    expect { task.invoke }.to output("{\"id\":42,\"flags\":[\"elapsed_at_least_24h\"]}\n").to_stdout
  end
end
