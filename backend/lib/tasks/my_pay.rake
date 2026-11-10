# frozen_string_literal: true

# My Pay access is managed on the Team page by owners and admins: a "My Pay on"
# switch per person (users.my_pay_enabled) and one "On for everyone" switch.
# Preview access is a role capability (owner and admin). The old pilot and
# preview allowlist tasks are retired; my_pay:everyone stays as an audited
# break-glass kill switch in case the Team page is unavailable.
namespace :my_pay do
  desc "Show who can see My Pay"
  task status: :environment do
    puts "my_pay_enabled_for_all=#{Setting.my_pay_enabled_for_all?}"
    users = User.staff.where(my_pay_enabled: true).order(:id)
    puts "my_pay_on=#{users.pluck(:id).join(',')}"
    users.each { |user| puts "  #{user.id} #{user.full_name} (#{user.role}#{user.is_active? ? '' : ', inactive'})" }
    puts "preview: owners and admins (#{User.administrators.where(is_active: true).order(:id).pluck(:id).join(',')})"
  end

  desc "Break-glass: open or close My Pay for every active staff member: " \
       "bin/rails my_pay:everyone ENABLED=true|false OPERATOR='Name' REASON='...'. Prefer the Team page."
  task everyone: :environment do
    value = ENV.fetch("ENABLED", "")
    raise ArgumentError, "Set ENABLED=true or ENABLED=false" unless %w[true false].include?(value)
    raise ArgumentError, "Set OPERATOR and REASON; this is a break-glass task" if ENV.fetch("OPERATOR", "").strip.empty? || ENV.fetch("REASON", "").strip.empty?

    enabled = value == "true"
    Setting.transaction do
      before = Setting.lock.find_by(key: Setting::MY_PAY_FOR_ALL_KEY)&.value == "true"
      setting = Setting.set(Setting::MY_PAY_FOR_ALL_KEY, value, description: "When true, every active staff member can see My Pay")
      AuditLog.record!(action: "setting.my_pay_everyone_updated", auditable: setting, actor: nil, actor_kind: "system", source: "system",
        event_category: "settings", changes: { my_pay_enabled_for_all: [ before, enabled ] },
        metadata: { enabled: enabled, break_glass: true, operator: ENV.fetch("OPERATOR").strip, reason: ENV.fetch("REASON").strip })
    end
    puts "my_pay_enabled_for_all=#{value}"
  end
end
