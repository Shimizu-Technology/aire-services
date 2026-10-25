# frozen_string_literal: true

namespace :payroll do
  desc "Configure this installation's immutable manual/scheduled lock boundary (STARTS_ON, ACTOR, REASON required)"
  task configure_lock_rollout: :environment do
    config = PayrollLockRollout.configure!(starts_on: ENV.fetch("STARTS_ON"), actor: ENV.fetch("ACTOR"), reason: ENV.fetch("REASON"))
    puts "Installation lock rollout configured: #{config.cutoff_enforcement_starts_on.iso8601} (immutable)"
  end
end
