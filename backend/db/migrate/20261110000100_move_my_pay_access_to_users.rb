# frozen_string_literal: true

# My Pay access moves from the "my_pay_enabled_user_ids" Setting allowlist to
# a per-person users.my_pay_enabled switch managed on the Team page. The one
# global switch stays the "my_pay_enabled_for_all" Setting. Preview access is
# now a role capability (owner and admin), so the "my_pay_preview_user_ids"
# allowlist is retired.
class MoveMyPayAccessToUsers < ActiveRecord::Migration[8.1]
  ALLOWLIST_KEY = "my_pay_enabled_user_ids"
  PREVIEW_KEY = "my_pay_preview_user_ids"

  def up
    add_column :users, :my_pay_enabled, :boolean, default: false, null: false

    ids = allowlisted_ids
    execute("UPDATE users SET my_pay_enabled = TRUE WHERE id IN (#{ids.join(',')})") if ids.any?
    say "Backfilled my_pay_enabled for user IDs: #{ids.any? ? ids.join(',') : '(none)'}"

    execute("DELETE FROM settings WHERE key IN (#{quote(ALLOWLIST_KEY)}, #{quote(PREVIEW_KEY)})")
  end

  def down
    ids = select_values("SELECT id FROM users WHERE my_pay_enabled ORDER BY id")
    if ids.any?
      execute(<<~SQL.squish)
        INSERT INTO settings (key, value, description, created_at, updated_at)
        VALUES (#{quote(ALLOWLIST_KEY)}, #{quote(ids.join(','))}, 'Comma-separated AIRE user IDs who can see My Pay (pilot)', NOW(), NOW())
      SQL
    end
    # The preview allowlist is not restored; absent means no one, the safe default.
    remove_column :users, :my_pay_enabled
  end

  private

  def allowlisted_ids
    value = select_value("SELECT value FROM settings WHERE key = #{quote(ALLOWLIST_KEY)}").to_s
    ids = value.split(",").map(&:strip).select { |id| id.match?(/\A[1-9]\d*\z/) }.map(&:to_i).uniq
    return [] if ids.empty?

    select_values("SELECT id FROM users WHERE id IN (#{ids.join(',')}) ORDER BY id").map(&:to_i)
  end

  def quote(value)
    connection.quote(value)
  end
end
