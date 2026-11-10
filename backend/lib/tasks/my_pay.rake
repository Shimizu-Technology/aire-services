# frozen_string_literal: true

namespace :my_pay do
  desc "Show who can see My Pay"
  task status: :environment do
    ids = Setting.my_pay_enabled_user_ids
    puts "my_pay_enabled_for_all=#{Setting.get('my_pay_enabled_for_all') == 'true'}"
    puts "my_pay_enabled_user_ids=#{ids.join(',')}"
    User.where(id: ids).order(:id).each { |user| puts "  #{user.id} #{user.full_name} (#{user.role}#{user.is_active? ? '' : ', inactive'})" }
    preview_ids = Setting.my_pay_preview_user_ids
    puts "my_pay_preview_user_ids=#{preview_ids.join(',')}"
    User.where(id: preview_ids).order(:id).each { |user| puts "  #{user.id} #{user.full_name} (#{user.role}#{user.is_active? ? '' : ', inactive'})" }
  end

  desc "Set who can preview any worker's My Pay, read-only: bin/rails my_pay:preview IDS=1,2 (IDS= to clear). Active admins only."
  task preview: :environment do
    raise ArgumentError, "Set IDS=comma-separated AIRE admin user IDs (IDS= clears the list)" unless ENV.key?("IDS")

    ids = ENV.fetch("IDS").split(",").map(&:strip).reject(&:empty?)
    raise ArgumentError, "IDS must be positive integers" unless ids.all? { |id| id.match?(/\A[1-9]\d*\z/) }

    users = User.admins.where(id: ids, is_active: true).pluck(:id)
    missing = ids.map(&:to_i).uniq - users
    raise ArgumentError, "Unknown, inactive or non-admin user IDs: #{missing.join(',')}" if missing.any?

    previous = Setting.my_pay_preview_user_ids
    Setting.transaction do
      setting = Setting.set("my_pay_preview_user_ids", users.sort.join(","), description: "Comma-separated AIRE admin user IDs who can preview any worker's My Pay (read-only)")
      AuditLog.record!(action: "setting.my_pay_preview_updated", auditable: setting, actor: nil, actor_kind: "system", source: "system",
        event_category: "settings", metadata: { previous_user_ids: previous, user_ids: users.sort })
    end
    puts "my_pay_preview_user_ids=#{users.sort.join(',')}"
  end

  desc "Set the My Pay pilot allowlist: bin/rails my_pay:pilot IDS=12,34,56 (IDS= to clear)"
  task pilot: :environment do
    raise ArgumentError, "Set IDS=comma-separated AIRE user IDs (IDS= clears the list)" unless ENV.key?("IDS")

    ids = ENV.fetch("IDS").split(",").map(&:strip).reject(&:empty?)
    raise ArgumentError, "IDS must be positive integers" unless ids.all? { |id| id.match?(/\A[1-9]\d*\z/) }

    users = User.staff.where(id: ids).pluck(:id)
    missing = ids.map(&:to_i) - users
    raise ArgumentError, "Unknown or non-staff user IDs: #{missing.join(',')}" if missing.any?

    previous = Setting.my_pay_enabled_user_ids
    Setting.transaction do
      setting = Setting.set("my_pay_enabled_user_ids", users.sort.join(","), description: "Comma-separated AIRE user IDs who can see My Pay (pilot)")
      AuditLog.record!(action: "setting.my_pay_pilot_updated", auditable: setting, actor: nil, actor_kind: "system", source: "system",
        event_category: "settings", metadata: { previous_user_ids: previous, user_ids: users.sort })
    end
    puts "my_pay_enabled_user_ids=#{users.sort.join(',')}"
  end

  desc "Open or close My Pay for every active staff member: bin/rails my_pay:everyone ENABLED=true|false"
  task everyone: :environment do
    value = ENV.fetch("ENABLED", "")
    raise ArgumentError, "Set ENABLED=true or ENABLED=false" unless %w[true false].include?(value)

    Setting.transaction do
      setting = Setting.set("my_pay_enabled_for_all", value, description: "When true, every active staff member can see My Pay")
      AuditLog.record!(action: "setting.my_pay_everyone_updated", auditable: setting, actor: nil, actor_kind: "system", source: "system",
        event_category: "settings", metadata: { enabled: value == "true" })
    end
    puts "my_pay_enabled_for_all=#{value}"
  end
end
