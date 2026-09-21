# frozen_string_literal: true

# These exact historical entries were owner-attested as already paid, but the
# matching check evidence was not established. Keep them out of future payroll
# without mislabeling them as confirmed AIRE/Cornerstone payments.
class RecordVerifiedJeremiahPaymentHold < ActiveRecord::Migration[8.1]
  USER_ID = 36
  USER_UUID = "03edb121-6f05-4c5c-be54-dce93d32dd19"
  ENTRY_DATES = {
    427 => "2026-05-11", 428 => "2026-05-12", 429 => "2026-05-13",
    430 => "2026-05-14", 431 => "2026-05-15", 432 => "2026-05-16",
    433 => "2026-05-18", 434 => "2026-05-19", 435 => "2026-05-20",
    436 => "2026-05-21", 437 => "2026-05-22", 438 => "2026-05-23",
    439 => "2026-05-25", 440 => "2026-05-26"
  }.freeze
  REASON = "Owner confirmed these historical maintenance hours were paid; matching Cornerstone check evidence remains pending review."

  def up
    person = User.find_by(id: USER_ID)
    raise "Verified historical AIRE employee is missing" unless person
    raise "Verified historical AIRE identity changed" unless person.payroll_integration_uuid == USER_UUID && person.staff?

    entries = TimeEntry.where(id: ENTRY_DATES.keys).index_by(&:id)
    raise "Verified historical AIRE entries are missing" unless entries.length == ENTRY_DATES.length

    actor = User.find_by(id: 1)
    raise "Verified AIRE attestation actor is unavailable" unless actor&.admin? && actor.is_active?

    ENTRY_DATES.each do |entry_id, work_date|
      entry = entries.fetch(entry_id)
      unless entry.user_id == USER_ID && entry.lock_version == 0 && entry.hours.to_d == 8.to_d &&
             entry.work_date == Date.iso8601(work_date) && entry.counts_toward_hours?
        raise "Historical AIRE entry #{entry_id} changed; review payment before rollout"
      end

      existing = PayrollPaymentAttestation.find_by(time_entry_id: entry_id)
      if existing
        raise "Historical AIRE entry #{entry_id} has different payment evidence" unless
          existing.status == "pending_evidence" && existing.source_user_uuid == USER_UUID &&
          existing.hours.to_d == 8.to_d && existing.source_time_entry_version == 0
      else
        Payroll::PaymentAttestationRecorder.new(actor: actor).attest!(
          entry: entry, source_user_uuid: USER_UUID, reason: REASON
        )
      end
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Owner payment attestations must not be deleted without reviewed evidence"
  end
end
