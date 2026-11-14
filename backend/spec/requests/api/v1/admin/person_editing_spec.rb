# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Versioned person editing and employment", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  around { |example| travel_to(Time.utc(2026, 11, 14, 2)) { example.run } }

  let!(:owner) { create(:user, :owner) }
  let(:admin) { create(:user, :admin) }
  let(:worker) { create(:user, first_name: "Ana", last_name: "Rivera", my_pay_enabled: true) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

  def edit(person, attributes, version: person.admin_edit_version)
    patch "/api/v1/admin/users/#{person.id}", params: attributes.merge(admin_edit_version: version), headers: headers
  end

  def end_employment(person, **attributes)
    post "/api/v1/admin/users/#{person.id}/terminate",
      params: { effective_on: Date.current.iso8601, admin_edit_version: person.admin_edit_version, confirm_name: person.full_name }.merge(attributes), headers: headers
  end

  it "serializes the explicit version and rejects stale edits without fields, assignments, My Pay or audit writes" do
    get "/api/v1/admin/users/#{worker.id}", headers: headers
    version = response.parsed_body.dig("user", "admin_edit_version")
    expect(version).to eq(0)
    edit(worker, { staff_title: "Instructor", approval_groups: [ "cfi" ] }, version: version)
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.dig("user", "admin_edit_version")).to eq(1)
    expect {
      edit(worker, { role: "manager", staff_title: "Overwrite", approval_groups: [ "ops_maintenance" ], my_pay_enabled: false }, version: version)
    }.not_to change { AuditLog.where(auditable: worker).count }
    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body["error"]).to eq(AdminPersonEdit::MESSAGE)
    expect(worker.reload).to have_attributes(role: "employee", staff_title: "Instructor", my_pay_enabled: true)
    expect(worker.approval_group_keys).to eq([ "cfi" ])
  end

  it "returns the conflict copy when another editor promoted the person beyond this admin's access" do
    worker.update!(role: "admin", admin_edit_version: 1)
    edit(worker, { role: "manager", staff_title: "Stale" }, version: 0)
    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body["error"]).to eq(AdminPersonEdit::MESSAGE)
    expect(worker.reload).to have_attributes(role: "admin", staff_title: nil, admin_edit_version: 1)
  end

  it "requires a valid version, rather than silently allowing an unprotected update" do
    [ nil, "invalid", -1, "0.5" ].each do |version|
      edit(worker, { staff_title: "Must not save" }, version: version)
      expect(response).to have_http_status(:conflict)
    end
    expect(worker.reload.staff_title).to be_nil
  end

  it "does not enable Rails optimistic locking on ordinary user saves" do
    expect(User.locking_enabled?).to be_falsey
    worker.update!(time_tracking_enabled: true, kiosk_enabled: true, kiosk_pin: "627154")
    worker.user_time_categories.create!(time_category: create(:time_category))
    admin_snapshot = User.find(worker.id)
    clerk_sync = User.find(worker.id)
    kiosk_failures = User.find(worker.id)
    clerk_sync.update!(first_name: "Clerk synced")
    kiosk_failures.update!(kiosk_failed_attempts_count: 2)
    expect(worker.reload.admin_edit_version).to eq(0)
    edit(admin_snapshot, { staff_title: "Still saves" })
    expect(response).to have_http_status(:ok)
    expect(worker.reload).to have_attributes(first_name: "Clerk synced", kiosk_failed_attempts_count: 2, staff_title: "Still saves", admin_edit_version: 1)
    # A user model loaded before the admin edit also remains safe to save.
    clerk_sync.update!(last_name: "Updated after admin")
    kiosk_failures.update!(kiosk_failed_attempts_count: 3)
    expect(worker.reload).to have_attributes(staff_title: "Still saves", admin_edit_version: 1, kiosk_failed_attempts_count: 3)
  end

  it "audits role, access, employment, work types and all department changes with before and after" do
    category = create(:time_category)
    edit(worker, { role: "manager", staff_title: "Instructor", approval_groups: [ "cfi", "ops_maintenance" ], is_intern: true,
      time_tracking_enabled: true, time_category_ids: [ category.id ], my_pay_enabled: false, public_team_bio: "Teaches flight safety." })
    expect(response).to have_http_status(:ok)
    rows = AuditLog.where(auditable: worker, user: admin)
    changes = rows.map(&:changes_made).reduce({}, :merge)
    expect(changes).to include("role" => %w[employee manager], "staff_title" => [ nil, "Instructor" ], "is_intern" => [ false, true ],
      "time_tracking_enabled" => [ false, true ], "my_pay_enabled" => [ true, false ], "time_category_ids" => [ [], [ category.id ] ],
      "approval_groups" => [ [], %w[cfi ops_maintenance] ], "public_team_bio" => [ nil, "Teaches flight safety." ])
    # Adding a secondary department must not disappear from the audit simply
    # because the primary department is unchanged.
    edit(worker.reload, { approval_groups: [ "cfi" ] })
    expect(response).to have_http_status(:ok)
    expect(AuditLog.where(auditable: worker).order(:id).last.changes_made).to include("approval_groups" => [ %w[cfi ops_maintenance], [ "cfi" ] ])
  end

  it "rolls back the version, assignments, My Pay and audit when Clerk sync fails" do
    allow(ClerkUserService).to receive(:update_user!).and_raise(ClerkUserService::Error, "Clerk unavailable")
    expect {
      edit(worker, { first_name: "Changed", approval_groups: [ "cfi" ], my_pay_enabled: false })
    }.not_to change { AuditLog.where(auditable: worker).count }
    expect(response).to have_http_status(:unprocessable_entity)
    expect(worker.reload).to have_attributes(first_name: "Ana", admin_edit_version: 0, my_pay_enabled: true)
    expect(worker.approval_group_keys).to eq([])
  end

  it "previews waiting time separately from overtime, open clocks, live links and open leave" do
    zone = ActiveSupport::TimeZone["Pacific/Guam"]
    [ 10, 10, 10, 7, 5 ].each_with_index do |hours, index|
      start = zone.local(2026, 11, 9 + index, 8)
      create(:time_entry, user: worker, status: "completed", entry_method: "clock", work_date: start.to_date,
        start_time: start, end_time: start + hours.hours, clock_in_at: start, clock_out_at: start + hours.hours,
        hours: hours, approval_status: index == 4 ? "pending" : "approved", overtime_status: index == 4 ? "pending" : "none")
    end
    create(:leave_request, user: worker, start_date: Date.current + 2, end_date: Date.current + 3)
    create(:time_entry, user: worker, status: "clocked_in", end_time: nil, work_date: Date.current + 1)
    get "/api/v1/admin/users/#{worker.id}/termination_preview", headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("preview")).to include("waiting_shifts" => 1, "waiting_hours" => 5.0,
      "waiting_overtime_hours" => 2.0, "open_clock" => true, "open_pay_stub_links" => 0, "open_leave_requests" => 1)
    end_employment(worker)
    expect(response).to have_http_status(:unprocessable_entity)
    expect(worker.reload).to be_is_active
  end

  it "rejects the wrong typed name, then turns off access, closes leave and preserves waiting time, with audit rows" do
    category = create(:time_category)
    worker.update!(time_tracking_enabled: true, kiosk_enabled: true, kiosk_pin: "976512")
    worker.user_time_categories.create!(time_category: category)
    entry = create(:time_entry, user: worker, status: "completed", approval_status: "pending")
    entry.update_columns(overtime_status: "pending")
    pending = create(:leave_request, user: worker, start_date: Date.current + 2, end_date: Date.current + 3)
    approved = create(:leave_request, user: worker, status: "approved", start_date: Date.current + 5, end_date: Date.current + 6)
    historical = create(:leave_request, user: worker, status: "approved", start_date: Date.current - 6, end_date: Date.current - 5)
    link = PayDocumentDelivery.create!(user: worker, sent_by: admin, origin: "sender", recipient_kind: "on_file",
      recipient_email: worker.email, token_digest: PayDocumentDelivery.digest(PayDocumentDelivery.generate_token), expires_at: 1.day.from_now, email_status: "captured", max_downloads_per_document: 5)
    end_employment(worker, confirm_name: "Ana")
    expect(response).to have_http_status(:unprocessable_entity)
    expect(worker.reload).to be_is_active
    end_employment(worker)
    expect(response).to have_http_status(:ok)
    expect(worker.reload).to have_attributes(is_active: false, personal_access_enabled: false, kiosk_enabled: false, time_tracking_enabled: false,
      my_pay_enabled: false, kiosk_pin_digest: nil, admin_edit_version: 1)
    expect(link.reload).to be_revoked
    expect([ pending.reload.status, approved.reload.status, historical.reload.status ]).to eq(%w[cancelled cancelled approved])
    expect(entry.reload).to have_attributes(approval_status: "pending", overtime_status: "pending")
    row = AuditLog.find_by!(action: "admin.users.terminate", auditable: worker, outcome: "succeeded")
    expect(row.changes_made).to include("is_active" => [ true, false ], "personal_access_enabled" => [ true, false ], "my_pay_enabled" => [ true, false ])
    expect(AuditLog.find_by!(action: "leave_request.cancelled", auditable: pending).changes_made).to include("status" => %w[pending cancelled])
    post "/api/v1/admin/users/#{worker.id}/reactivate", params: { admin_edit_version: 1 }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(worker.reload).to have_attributes(is_active: true, personal_access_enabled: true, kiosk_enabled: true, my_pay_enabled: false, kiosk_pin_digest: nil, admin_edit_version: 2)
    expect(link.reload).to be_revoked
    expect(pending.reload.status).to eq("cancelled")
    expect(AuditLog.find_by!(action: "admin.users.reactivate", auditable: worker).changes_made).to include("is_active" => [ false, true ], "employment_status" => %w[terminated active])
  end

  it "gives kiosk-only staff a new one-time PIN on reactivation" do
    kiosk = create(:user, :kiosk_only)
    original_digest = kiosk.kiosk_pin_digest
    end_employment(kiosk)
    expect(response).to have_http_status(:ok)
    post "/api/v1/admin/users/#{kiosk.id}/reactivate", params: { admin_edit_version: kiosk.reload.admin_edit_version }, headers: headers
    expect(response).to have_http_status(:ok)
    pin = response.parsed_body.fetch("kiosk_pin")
    expect(pin).to match(/\A\d{6}\z/)
    expect(kiosk.reload.kiosk_pin_digest).not_to eq(original_digest)
    expect(kiosk.authenticate_kiosk_pin(pin)).to eq(kiosk)
  end

  it "saves photo and employment fields atomically, audits photo changes, and rejects a stale photo replacement" do
    upload = fixture_file_upload("team_photo.png", "image/png")
    patch "/api/v1/admin/users/#{worker.id}", params: {
      person_edit: { admin_edit_version: 0, staff_title: "Pilot", public_team_bio: "Safety instructor." }.to_json, photo: upload
    }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(worker.reload).to have_attributes(staff_title: "Pilot", public_team_bio: "Safety instructor.", admin_edit_version: 1)
    expect(worker.public_team_photo).to be_attached
    blob_id = worker.public_team_photo.blob.id
    expect(AuditLog.where(auditable: worker).order(:id).last.changes_made).to include("public_team_photo" => [ nil, blob_id ])
    expect {
      patch "/api/v1/admin/users/#{worker.id}", params: {
        person_edit: { admin_edit_version: 0, staff_title: "Stale" }.to_json,
        photo: fixture_file_upload("team_photo.png", "image/png")
      }, headers: headers
    }.not_to change(ActiveStorage::Blob, :count)
    expect(response).to have_http_status(:conflict)
    expect(worker.reload.staff_title).to eq("Pilot")
    expect(worker.public_team_photo.blob.id).to eq(blob_id)
    edit(worker, { remove_photo: true })
    expect(response).to have_http_status(:ok)
    expect(worker.reload.public_team_photo).not_to be_attached
    expect(AuditLog.where(auditable: worker).order(:id).last.changes_made).to include("public_team_photo" => [ blob_id, nil ])
  end

  it "versions and audits legacy photo uploads and removals so stale Employment drafts cannot overwrite them" do
    post "/api/v1/admin/users/#{worker.id}/public_team_photo", params: { photo: fixture_file_upload("team_photo.png", "image/png") }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(worker.reload.admin_edit_version).to eq(1)
    blob_id = worker.public_team_photo.blob.id
    expect(AuditLog.where(auditable: worker).map(&:changes_made)).to include(include("public_team_photo" => [ nil, blob_id ]))
    edit(worker, { remove_photo: true, staff_title: "Stale" }, version: 0)
    expect(response).to have_http_status(:conflict)
    expect(worker.reload.public_team_photo.blob.id).to eq(blob_id)
    expect(worker.staff_title).to be_nil

    delete "/api/v1/admin/users/#{worker.id}/public_team_photo", headers: headers
    expect(response).to have_http_status(:ok)
    expect(worker.reload.admin_edit_version).to eq(2)
    expect(worker.public_team_photo).not_to be_attached
    expect(AuditLog.where(auditable: worker).map(&:changes_made)).to include(include("public_team_photo" => [ blob_id, nil ]))
    edit(worker, { staff_title: "Also stale" }, version: 1)
    expect(response).to have_http_status(:conflict)
    expect(worker.reload.staff_title).to be_nil

    post "/api/v1/admin/users/#{worker.id}/public_team_photo", params: { admin_edit_version: 1, photo: fixture_file_upload("team_photo.png", "image/png") }, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(worker.reload.admin_edit_version).to eq(2)
    expect(worker.public_team_photo).not_to be_attached
  end

  it "rejects invalid photo or bio without saving the rest of Employment" do
    patch "/api/v1/admin/users/#{worker.id}", params: {
      person_edit: { admin_edit_version: 0, staff_title: "Must not save" }.to_json,
      photo: fixture_file_upload("not_image.txt", "text/plain")
    }, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    edit(worker, { staff_title: "Must not save", public_team_bio: "x" * 5_001 })
    expect(response).to have_http_status(:unprocessable_entity)
    expect(worker.reload).to have_attributes(staff_title: nil, admin_edit_version: 0)
  end

  it "denies managers every person-editing and employment endpoint" do
    manager_headers = { "Authorization" => "Bearer test_token_#{create(:user, :manager).id}" }
    get "/api/v1/admin/users/#{worker.id}/termination_preview", headers: manager_headers
    expect(response).to have_http_status(:forbidden)
    patch "/api/v1/admin/users/#{worker.id}", params: { admin_edit_version: 0, role: "admin" }, headers: manager_headers
    expect(response).to have_http_status(:forbidden)
    post "/api/v1/admin/users/#{worker.id}/terminate", headers: manager_headers
    expect(response).to have_http_status(:forbidden)
    post "/api/v1/admin/users/#{worker.id}/reactivate", headers: manager_headers
    expect(response).to have_http_status(:forbidden)
  end
end

# Exercise the real request transaction boundary; transactional fixtures would
# mask a missing transaction around the legacy endpoint's lock.
RSpec.describe "Legacy person photo request transactions", type: :request do
  self.use_transactional_tests = false
  let(:suffix) { SecureRandom.hex(8) }
  let!(:admin) { create(:user, :admin, email: "photo-admin-#{suffix}@example.test", clerk_id: "photo_admin_#{suffix}") }
  let!(:worker) { create(:user, email: "photo-worker-#{suffix}@example.test", clerk_id: "photo_worker_#{suffix}") }
  let(:headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

  after do
    worker.public_team_photo.purge if worker.public_team_photo.attached?
    AuditLog.transaction do
      connection = AuditLog.connection
      connection.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
      AuditLog.where(auditable: [ worker, admin ]).delete_all
      connection.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    end
    User.where(id: [ worker.id, admin.id ]).destroy_all
  end

  it "opens its own transaction for upload and removal without fixture transactions" do
    expect(ActiveRecord::Base.connection.transaction_open?).to be(false)
    post "/api/v1/admin/users/#{worker.id}/public_team_photo", params: { photo: fixture_file_upload("team_photo.png", "image/png") }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(worker.reload.admin_edit_version).to eq(1)
    expect(worker.public_team_photo).to be_attached
    delete "/api/v1/admin/users/#{worker.id}/public_team_photo", headers: headers
    expect(response).to have_http_status(:ok)
    expect(worker.reload.admin_edit_version).to eq(2)
    expect(worker.public_team_photo).not_to be_attached
    expect(AuditLog.where(auditable: worker).where("changes_made ? 'public_team_photo'").count).to eq(2)
  end
end
