# frozen_string_literal: true

require "rails_helper"

RSpec.describe AuditLog, type: :model do
  let(:actor) { create(:user, :admin, first_name: "Ada", last_name: "Manager") }
  let(:employee_record) { create(:user, :employee, first_name: "Jordan", last_name: "Employee") }

  after { Current.reset }

  it "captures durable actor and subject snapshots while redacting sensitive values" do
    Current.request_id = "request-123"
    Current.ip_address = "192.0.2.10"

    event = described_class.record!(
      action: "user.updated",
      auditable: employee_record,
      actor: actor,
      event_category: "users",
      changes: { email: [ "old@example.com", "new@example.com" ], kiosk_pin: [ "123456", "654321" ] },
      metadata: { reason: "Access change", token: "do-not-store" }
    )

    expect(event).to have_attributes(
      actor_name: "Ada Manager",
      actor_email: actor.email,
      subject_name: "Jordan Employee",
      request_id: "request-123",
      ip_address: "192.0.2.10"
    )
    expect(event.changes_made.fetch("kiosk_pin")).to eq("[REDACTED]")
    expect(event.metadata.fetch("token")).to eq("[REDACTED]")
  end

  it "is immutable through Active Record" do
    event = described_class.record!(action: "user.updated", auditable: employee_record, actor: actor, event_category: "users")

    expect { event.update!(outcome: "failed") }.to raise_error(ActiveRecord::ReadOnlyRecord)
    expect { event.destroy! }.to raise_error(ActiveRecord::ReadOnlyRecord)
    expect(described_class.exists?(event.id)).to be(true)
  end

  it "rejects raw SQL updates at the database boundary" do
    event = described_class.record!(action: "user.updated", auditable: employee_record, actor: actor, event_category: "users")

    expect do
      ActiveRecord::Base.transaction(requires_new: true) do
        ActiveRecord::Base.connection.execute("UPDATE audit_logs SET outcome = 'failed' WHERE id = #{event.id}")
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
  end

  it "rejects raw SQL deletes at the database boundary" do
    event = described_class.record!(action: "user.updated", auditable: employee_record, actor: actor, event_category: "users")

    expect do
      ActiveRecord::Base.transaction(requires_new: true) do
        ActiveRecord::Base.connection.execute("DELETE FROM audit_logs WHERE id = #{event.id}")
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
  end

  it "keeps the actor snapshot when the actor is deleted" do
    event = described_class.record!(action: "user.updated", auditable: employee_record, actor: actor, event_category: "users")

    actor.destroy!

    expect(event.reload.user_id).to be_nil
    expect(event.actor_name).to eq("Ada Manager")
    expect(event.actor_email).to be_present
  end

  it "records one sign-in event per session fingerprint" do
    2.times { described_class.record_sign_in_once!(actor: actor, session_fingerprint: "session-hash") }

    expect(described_class.where(action: "auth.signed_in", session_fingerprint: "session-hash").count).to eq(1)
  end
end
