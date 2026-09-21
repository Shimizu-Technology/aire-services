# frozen_string_literal: true

# Leon confirmed these remaining May 1–15 hours were already paid. Their check
# numbers are still pending review, so record owner attestations instead of
# inventing check evidence or allowing the hours into another payroll.
class RecordVerifiedLegacyPaymentHolds < ActiveRecord::Migration[8.1]
  USERS = {
    29 => "2e4f3daa-ea39-40d7-a751-f24e29eb1e9f",
    30 => "a9bc15ae-0d89-444d-954c-cb0124e8fba5",
    34 => "4050d872-6a13-4156-8be4-8ad251b72347",
    35 => "e191670d-2094-46ae-ae55-c6b82e8a64d8",
    36 => "03edb121-6f05-4c5c-be54-dce93d32dd19"
  }.freeze
  ENTRIES = {
    35 => [ 29, "2026-05-02", "5.00" ],
    17 => [ 30, "2026-05-01", "8.26" ],
    32 => [ 30, "2026-05-02", "6.90" ],
    53 => [ 30, "2026-05-03", "6.43" ],
    88 => [ 30, "2026-05-05", "5.23" ],
    130 => [ 30, "2026-05-08", "9.19" ],
    149 => [ 30, "2026-05-09", "5.33" ],
    156 => [ 30, "2026-05-10", "5.07" ],
    171 => [ 30, "2026-05-12", "6.11" ],
    233 => [ 30, "2026-05-15", "8.00" ],
    39 => [ 34, "2026-05-02", "3.40" ],
    55 => [ 34, "2026-05-03", "3.13" ],
    58 => [ 34, "2026-05-03", "3.31" ],
    201 => [ 34, "2026-05-13", "2.98" ],
    77 => [ 35, "2026-05-04", "2.91" ],
    78 => [ 35, "2026-05-07", "8.00" ],
    160 => [ 35, "2026-05-11", "8.09" ],
    172 => [ 35, "2026-05-12", "7.88" ],
    217 => [ 35, "2026-05-14", "8.12" ],
    681 => [ 36, "2026-05-15", "0.50" ]
  }.freeze
  REASON = "Owner confirmed these remaining May 1–15 AIRE hours were paid; matching check numbers remain pending review."

  def up
    users = User.where(id: USERS.keys).index_by(&:id)
    raise "Verified historical AIRE employees are missing" unless users.length == USERS.length

    USERS.each do |user_id, source_uuid|
      person = users.fetch(user_id)
      unless person.staff? && person.payroll_integration_uuid == source_uuid
        raise "Verified historical AIRE identity #{user_id} changed"
      end
    end

    entries = TimeEntry.where(id: ENTRIES.keys).index_by(&:id)
    raise "Verified historical AIRE entries are missing" unless entries.length == ENTRIES.length

    actor = User.find_by(id: 1)
    raise "Verified AIRE attestation actor is unavailable" unless actor&.admin? && actor.is_active?

    ENTRIES.each do |entry_id, (user_id, work_date, hours)|
      entry = entries.fetch(entry_id)
      unless entry.user_id == user_id && entry.lock_version == 0 &&
             entry.hours.to_d == hours.to_d && entry.work_date == Date.iso8601(work_date) &&
             entry.counts_toward_hours?
        raise "Historical AIRE entry #{entry_id} changed; review payment before rollout"
      end

      source_uuid = USERS.fetch(user_id)
      existing = PayrollPaymentAttestation.find_by(time_entry_id: entry_id)
      if existing
        unless existing.status == "pending_evidence" && existing.source_user_uuid == source_uuid &&
               existing.hours.to_d == hours.to_d && existing.source_time_entry_version == 0
          raise "Historical AIRE entry #{entry_id} has different payment evidence"
        end
      else
        Payroll::PaymentAttestationRecorder.new(actor: actor).attest!(
          entry: entry, source_user_uuid: source_uuid, reason: REASON
        )
      end
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Owner payment attestations must be retracted through reviewed evidence"
  end
end
