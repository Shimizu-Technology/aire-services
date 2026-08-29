# frozen_string_literal: true

class DeactivateStaffWithoutAccess < ActiveRecord::Migration[8.1]
  def up
    # Legacy records can predate both Clerk access and usable kiosk setup. Keep
    # their identity and time history, but fail closed instead of leaving an
    # active employee who cannot satisfy the new access invariant.
    execute <<~SQL.squish
      UPDATE users
      SET is_active = FALSE
      WHERE is_active = TRUE
        AND personal_access_enabled = FALSE
        AND kiosk_enabled = FALSE
    SQL
  end

  def down
    # Access cannot be inferred safely, so do not reactivate staff implicitly.
  end
end
