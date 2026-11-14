# frozen_string_literal: true

# Unlike Rails optimistic locking, this token ignores Clerk profile sync,
# PIN failure counters and ordinary user saves. Check while holding the row.
class AdminPersonEdit
  class Conflict < StandardError; end
  MESSAGE = "Someone else changed this person since you opened it. Nothing was saved. Reload to see their changes."

  OUTDATED_MESSAGE = "This page is out of date. Reload to continue."

  def self.check!(user, version)
    raise Conflict, OUTDATED_MESSAGE if version.blank?

    unless version.to_s.match?(/\A\d+\z/) && version.to_i == user.admin_edit_version
      raise Conflict, MESSAGE
    end
  end
end
