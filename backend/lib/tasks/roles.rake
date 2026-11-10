# frozen_string_literal: true

namespace :roles do
  desc "List everyone with owner, admin or manager access"
  task status: :environment do
    puts "Roles: #{User::ROLES.join(', ')}"
    User.where(role: User::SUPERVISOR_ROLES).sort_by { |user| [ User::ROLES.index(user.role), user.id ] }.each do |user|
      puts "  #{user.id} #{user.full_name} (#{user.role}#{user.is_active? ? '' : ', inactive'}#{user.personal_access_enabled? ? '' : ', no sign-in'})"
    end
    puts "Employees: #{User.employees.where(is_active: true).count} active"
  end

  desc "Set one person's role: bin/rails roles:assign ID=1 ROLE=owner OPERATOR='Name' " \
       "(owner only while no active owner exists, or with BREAK_GLASS=1 REASON='...')"
  task assign: :environment do
    raise ArgumentError, "Set ID=<AIRE user ID>" unless ENV.fetch("ID", "").match?(/\A[1-9]\d*\z/)
    raise ArgumentError, "Set ROLE=#{User::ROLES.join('|')}" if ENV.fetch("ROLE", "").blank?

    result = RoleAssignment.new(
      user_id: ENV.fetch("ID").to_i,
      role: ENV.fetch("ROLE"),
      operator: ENV.fetch("OPERATOR", ""),
      break_glass: ENV["BREAK_GLASS"] == "1",
      reason: ENV.fetch("REASON", nil)
    ).call

    user = result.user
    if result.changed
      puts "Changed #{user.id} #{user.full_name}: #{result.from} -> #{result.to} (audited as #{RoleAssignment::AUDIT_ACTION})"
    else
      puts "No change: #{user.id} #{user.full_name} is already #{result.to}"
    end
    Rake::Task["roles:status"].reenable
    Rake::Task["roles:status"].invoke
  rescue RoleAssignment::Error => e
    abort "roles:assign refused: #{e.message}"
  end
end
