# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_03_31_162100) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "audit_logs", force: :cascade do |t|
    t.string "action", null: false
    t.bigint "auditable_id", null: false
    t.string "auditable_type", null: false
    t.json "changes_made"
    t.datetime "created_at", null: false
    t.string "metadata"
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["action"], name: "index_audit_logs_on_action"
    t.index ["auditable_type", "auditable_id"], name: "index_audit_logs_on_auditable_type_and_auditable_id"
    t.index ["created_at"], name: "index_audit_logs_on_created_at"
    t.index ["user_id"], name: "index_audit_logs_on_user_id"
  end

  create_table "client_contacts", force: :cascade do |t|
    t.bigint "client_id", null: false
    t.datetime "created_at", null: false
    t.string "email"
    t.string "first_name", null: false
    t.boolean "is_primary", default: false, null: false
    t.string "last_name", null: false
    t.string "phone"
    t.string "role"
    t.datetime "updated_at", null: false
    t.index ["client_id", "is_primary"], name: "index_client_contacts_primary_unique", unique: true, where: "is_primary"
    t.index ["client_id"], name: "index_client_contacts_on_client_id"
  end

  create_table "client_notes", force: :cascade do |t|
    t.string "category", default: "general", null: false
    t.bigint "client_id", null: false
    t.text "content", null: false
    t.datetime "created_at", null: false
    t.datetime "deleted_at"
    t.datetime "updated_at", null: false
    t.index ["client_id", "created_at"], name: "index_client_notes_on_client_id_and_created_at"
    t.index ["client_id"], name: "index_client_notes_on_client_id"
  end

  create_table "client_operation_assignments", force: :cascade do |t|
    t.string "assignment_status", default: "active", null: false
    t.boolean "auto_generate", default: true, null: false
    t.date "cadence_anchor"
    t.integer "cadence_interval"
    t.string "cadence_type", default: "monthly", null: false
    t.bigint "client_id", null: false
    t.datetime "created_at", null: false
    t.bigint "created_by_id"
    t.date "ends_on"
    t.integer "excluded_template_task_ids", default: [], null: false, array: true
    t.bigint "operation_template_id", null: false
    t.date "starts_on"
    t.datetime "updated_at", null: false
    t.index ["assignment_status", "auto_generate", "starts_on", "ends_on"], name: "index_client_operation_assignments_auto_window"
    t.index ["assignment_status"], name: "index_client_operation_assignments_on_assignment_status"
    t.index ["client_id", "operation_template_id"], name: "index_client_operation_assignments_unique", unique: true
    t.index ["client_id"], name: "index_client_operation_assignments_on_client_id"
    t.index ["created_by_id"], name: "index_client_operation_assignments_on_created_by_id"
    t.index ["operation_template_id"], name: "index_client_operation_assignments_on_operation_template_id"
  end

  create_table "client_service_types", force: :cascade do |t|
    t.bigint "client_id", null: false
    t.datetime "created_at", null: false
    t.bigint "service_type_id", null: false
    t.datetime "updated_at", null: false
    t.index ["client_id", "service_type_id"], name: "index_client_service_types_on_client_id_and_service_type_id", unique: true
    t.index ["client_id"], name: "index_client_service_types_on_client_id"
    t.index ["service_type_id"], name: "index_client_service_types_on_service_type_id"
  end

  create_table "clients", force: :cascade do |t|
    t.datetime "archived_at"
    t.string "bank_account_number_encrypted"
    t.string "bank_account_type"
    t.string "bank_routing_number_encrypted"
    t.string "business_name"
    t.text "changes_from_prior_year"
    t.string "client_type", default: "individual"
    t.datetime "created_at", null: false
    t.date "date_of_birth"
    t.boolean "denied_eic_actc", default: false
    t.integer "denied_eic_actc_year"
    t.string "email"
    t.string "filing_status"
    t.string "first_name", null: false
    t.boolean "has_crypto_transactions", default: false
    t.boolean "has_prior_year_return", default: false
    t.boolean "has_tax_returns", default: true, null: false
    t.boolean "is_new_client", default: true
    t.string "last_name", null: false
    t.text "mailing_address"
    t.string "notification_preference", default: "email", null: false
    t.string "phone"
    t.date "spouse_dob"
    t.string "spouse_name"
    t.datetime "updated_at", null: false
    t.boolean "wants_direct_deposit", default: false
    t.index ["archived_at"], name: "index_clients_on_archived_at"
    t.index ["client_type"], name: "index_clients_on_client_type"
    t.index ["email"], name: "index_clients_on_email"
    t.index ["has_tax_returns"], name: "index_clients_on_has_tax_returns"
    t.index ["last_name", "first_name"], name: "index_clients_on_last_name_and_first_name"
  end

  create_table "daily_tasks", force: :cascade do |t|
    t.bigint "assigned_to_id"
    t.bigint "client_id"
    t.text "comments"
    t.datetime "completed_at"
    t.bigint "completed_by_id"
    t.datetime "created_at", null: false
    t.bigint "created_by_id"
    t.date "due_date"
    t.string "form_service"
    t.integer "position", default: 0, null: false
    t.string "priority", default: "normal", null: false
    t.bigint "reviewed_by_id"
    t.bigint "service_type_id"
    t.string "status", default: "not_started", null: false
    t.datetime "status_changed_at"
    t.bigint "status_changed_by_id"
    t.date "task_date", null: false
    t.bigint "tax_return_id"
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["assigned_to_id"], name: "index_daily_tasks_on_assigned_to_id"
    t.index ["client_id"], name: "index_daily_tasks_on_client_id"
    t.index ["due_date"], name: "index_daily_tasks_pending_by_due_date", where: "((status)::text <> 'done'::text)"
    t.index ["service_type_id"], name: "index_daily_tasks_on_service_type_id"
    t.index ["status"], name: "index_daily_tasks_on_status"
    t.index ["task_date", "position"], name: "index_daily_tasks_on_task_date_and_position"
    t.index ["task_date", "status"], name: "index_daily_tasks_on_task_date_and_status"
    t.index ["tax_return_id"], name: "index_daily_tasks_on_tax_return_id"
  end

  create_table "dependents", force: :cascade do |t|
    t.boolean "can_be_claimed_by_other"
    t.bigint "client_id", null: false
    t.datetime "created_at", null: false
    t.date "date_of_birth"
    t.boolean "is_disabled"
    t.boolean "is_student"
    t.integer "months_lived_with_client"
    t.string "name"
    t.string "relationship"
    t.datetime "updated_at", null: false
    t.index ["client_id"], name: "index_dependents_on_client_id"
  end

  create_table "documents", force: :cascade do |t|
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "document_type"
    t.integer "file_size"
    t.string "filename", null: false
    t.string "s3_key", null: false
    t.bigint "tax_return_id", null: false
    t.datetime "updated_at", null: false
    t.bigint "uploaded_by_id"
    t.index ["tax_return_id"], name: "index_documents_on_tax_return_id"
    t.index ["uploaded_by_id"], name: "index_documents_on_uploaded_by_id"
  end

  create_table "income_sources", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "notes"
    t.string "payer_name"
    t.string "source_type"
    t.bigint "tax_return_id", null: false
    t.datetime "updated_at", null: false
    t.index ["tax_return_id"], name: "index_income_sources_on_tax_return_id"
  end

  create_table "notifications", force: :cascade do |t|
    t.bigint "client_id", null: false
    t.text "content"
    t.datetime "created_at", null: false
    t.text "error_message"
    t.string "notification_type"
    t.string "recipient"
    t.datetime "sent_at"
    t.string "status", default: "pending"
    t.bigint "tax_return_id"
    t.string "template"
    t.datetime "updated_at", null: false
    t.index ["client_id"], name: "index_notifications_on_client_id"
    t.index ["status"], name: "index_notifications_on_status"
    t.index ["tax_return_id"], name: "index_notifications_on_tax_return_id"
  end

  create_table "operation_cycles", force: :cascade do |t|
    t.bigint "client_id", null: false
    t.bigint "client_operation_assignment_id"
    t.datetime "created_at", null: false
    t.string "cycle_label", null: false
    t.datetime "generated_at"
    t.bigint "generated_by_id"
    t.string "generation_mode", default: "manual", null: false
    t.bigint "operation_template_id", null: false
    t.date "pay_date"
    t.date "period_end", null: false
    t.date "period_start", null: false
    t.string "status", default: "active", null: false
    t.datetime "updated_at", null: false
    t.index ["client_id", "operation_template_id", "period_start", "period_end"], name: "index_operation_cycles_unique_period", unique: true
    t.index ["client_id", "period_start", "created_at"], name: "index_operation_cycles_client_recent", order: { period_start: :desc, created_at: :desc }
    t.index ["client_id", "status"], name: "index_operation_cycles_on_client_id_and_status"
    t.index ["client_id"], name: "index_operation_cycles_on_client_id"
    t.index ["client_operation_assignment_id"], name: "index_operation_cycles_on_client_operation_assignment_id"
    t.index ["generated_by_id"], name: "index_operation_cycles_on_generated_by_id"
    t.index ["operation_template_id"], name: "index_operation_cycles_on_operation_template_id"
    t.index ["pay_date"], name: "index_operation_cycles_on_pay_date"
    t.index ["status"], name: "index_operation_cycles_on_status"
  end

  create_table "operation_tasks", force: :cascade do |t|
    t.bigint "assigned_to_id"
    t.bigint "client_id", null: false
    t.datetime "completed_at"
    t.bigint "completed_by_id"
    t.datetime "created_at", null: false
    t.text "description"
    t.datetime "due_at"
    t.text "evidence_note"
    t.boolean "evidence_required", default: false, null: false
    t.bigint "linked_time_entry_id"
    t.text "notes"
    t.bigint "operation_cycle_id", null: false
    t.bigint "operation_template_task_id", null: false
    t.integer "position", default: 0, null: false
    t.string "proof_url"
    t.datetime "started_at"
    t.string "status", default: "not_started", null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["assigned_to_id", "status"], name: "index_operation_tasks_on_assigned_to_id_and_status"
    t.index ["assigned_to_id"], name: "index_operation_tasks_on_assigned_to_id"
    t.index ["client_id", "status"], name: "index_operation_tasks_on_client_id_and_status"
    t.index ["client_id"], name: "index_operation_tasks_on_client_id"
    t.index ["completed_by_id"], name: "index_operation_tasks_on_completed_by_id"
    t.index ["due_at"], name: "index_operation_tasks_on_due_at"
    t.index ["linked_time_entry_id"], name: "index_operation_tasks_on_linked_time_entry_id"
    t.index ["linked_time_entry_id"], name: "index_operation_tasks_on_linked_time_entry_unique", unique: true, where: "(linked_time_entry_id IS NOT NULL)"
    t.index ["operation_cycle_id", "position"], name: "index_operation_tasks_order"
    t.index ["operation_cycle_id"], name: "index_operation_tasks_on_operation_cycle_id"
    t.index ["operation_template_task_id"], name: "index_operation_tasks_on_operation_template_task_id"
    t.index ["status", "due_at"], name: "index_operation_tasks_active_status_due", where: "((status)::text <> 'done'::text)"
    t.index ["status"], name: "index_operation_tasks_on_status"
  end

  create_table "operation_template_tasks", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "default_assignee_id"
    t.integer "dependency_template_task_ids", default: [], null: false, array: true
    t.text "description"
    t.string "due_offset_from"
    t.string "due_offset_unit"
    t.integer "due_offset_value"
    t.boolean "evidence_required", default: false, null: false
    t.boolean "is_active", default: true, null: false
    t.bigint "operation_template_id", null: false
    t.integer "position", default: 0, null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["default_assignee_id"], name: "index_operation_template_tasks_on_default_assignee_id"
    t.index ["is_active"], name: "index_operation_template_tasks_on_is_active"
    t.index ["operation_template_id", "position"], name: "index_operation_template_tasks_order"
    t.index ["operation_template_id", "title"], name: "index_operation_template_tasks_unique_title", unique: true
    t.index ["operation_template_id"], name: "index_operation_template_tasks_on_operation_template_id"
  end

  create_table "operation_templates", force: :cascade do |t|
    t.boolean "auto_generate", default: true, null: false
    t.string "category", default: "general", null: false
    t.datetime "created_at", null: false
    t.bigint "created_by_id"
    t.text "description"
    t.boolean "is_active", default: true, null: false
    t.string "name", null: false
    t.date "recurrence_anchor"
    t.integer "recurrence_interval"
    t.string "recurrence_type", default: "monthly", null: false
    t.datetime "updated_at", null: false
    t.index ["created_by_id"], name: "index_operation_templates_on_created_by_id"
    t.index ["is_active"], name: "index_operation_templates_on_is_active"
    t.index ["name"], name: "index_operation_templates_on_name", unique: true
    t.index ["recurrence_type"], name: "index_operation_templates_on_recurrence_type"
  end

  create_table "payroll_import_batches", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "employee_count"
    t.text "error_message"
    t.string "idempotency_key", null: false
    t.jsonb "payload", default: {}, null: false
    t.jsonb "reconciliation_details", default: {}
    t.string "source_payroll_run_id", null: false
    t.string "status", default: "pending", null: false
    t.decimal "total_gross", precision: 12, scale: 2
    t.decimal "total_net", precision: 12, scale: 2
    t.decimal "total_tax", precision: 12, scale: 2
    t.datetime "updated_at", null: false
    t.index ["created_at"], name: "index_payroll_import_batches_on_created_at"
    t.index ["idempotency_key"], name: "index_payroll_import_batches_on_idempotency_key", unique: true
    t.index ["source_payroll_run_id"], name: "index_payroll_import_batches_on_source_payroll_run_id"
    t.index ["status"], name: "index_payroll_import_batches_on_status"
  end

  create_table "schedule_time_presets", force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.datetime "created_at", null: false
    t.time "end_time", null: false
    t.string "label", null: false
    t.integer "position", default: 0, null: false
    t.time "start_time", null: false
    t.datetime "updated_at", null: false
    t.index ["active"], name: "index_schedule_time_presets_on_active"
    t.index ["position"], name: "index_schedule_time_presets_on_position"
  end

  create_table "schedules", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "created_by_id"
    t.time "end_time", null: false
    t.text "notes"
    t.time "start_time", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.date "work_date", null: false
    t.index ["created_by_id"], name: "index_schedules_on_created_by_id"
    t.index ["user_id", "work_date"], name: "index_schedules_on_user_id_and_work_date"
    t.index ["user_id"], name: "index_schedules_on_user_id"
    t.index ["work_date"], name: "index_schedules_on_work_date"
  end

  create_table "service_tasks", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "description"
    t.boolean "is_active", default: true, null: false
    t.string "name", null: false
    t.integer "position", default: 0, null: false
    t.bigint "service_type_id", null: false
    t.datetime "updated_at", null: false
    t.index ["is_active"], name: "index_service_tasks_on_is_active"
    t.index ["service_type_id", "name"], name: "index_service_tasks_on_type_and_name_unique", unique: true
    t.index ["service_type_id", "position"], name: "index_service_tasks_on_service_type_id_and_position"
    t.index ["service_type_id"], name: "index_service_tasks_on_service_type_id"
  end

  create_table "service_types", force: :cascade do |t|
    t.string "color"
    t.datetime "created_at", null: false
    t.text "description"
    t.boolean "is_active", default: true, null: false
    t.string "name", null: false
    t.integer "position", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["is_active"], name: "index_service_types_on_is_active"
    t.index ["name"], name: "index_service_types_on_name_unique", unique: true
    t.index ["position"], name: "index_service_types_on_position"
  end

  create_table "settings", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "description"
    t.string "key"
    t.datetime "updated_at", null: false
    t.text "value"
    t.index ["key"], name: "index_settings_on_key"
  end

  create_table "tax_returns", force: :cascade do |t|
    t.bigint "assigned_to_id"
    t.bigint "client_id", null: false
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.text "notes"
    t.bigint "reviewed_by_id"
    t.integer "tax_year", null: false
    t.datetime "updated_at", null: false
    t.bigint "workflow_stage_id"
    t.index ["assigned_to_id"], name: "index_tax_returns_on_assigned_to_id"
    t.index ["client_id", "tax_year"], name: "index_tax_returns_on_client_id_and_tax_year", unique: true
    t.index ["client_id"], name: "index_tax_returns_on_client_id"
    t.index ["reviewed_by_id"], name: "index_tax_returns_on_reviewed_by_id"
    t.index ["workflow_stage_id"], name: "index_tax_returns_on_workflow_stage_id"
  end

  create_table "time_categories", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "description"
    t.integer "hourly_rate_cents"
    t.boolean "is_active", default: true
    t.string "key"
    t.string "name", null: false
    t.datetime "updated_at", null: false
    t.index ["key"], name: "index_time_categories_on_key", unique: true
  end

  create_table "time_entries", force: :cascade do |t|
    t.boolean "admin_override", default: false, null: false
    t.text "approval_note"
    t.string "approval_status"
    t.datetime "approved_at"
    t.bigint "approved_by_id"
    t.string "attendance_status"
    t.integer "break_minutes"
    t.bigint "client_id"
    t.datetime "clock_in_at"
    t.datetime "clock_out_at"
    t.string "clock_source"
    t.datetime "created_at", null: false
    t.text "description"
    t.time "end_time"
    t.string "entry_method", default: "manual", null: false
    t.decimal "hours", precision: 4, scale: 2, null: false
    t.datetime "locked_at"
    t.datetime "overtime_approved_at"
    t.bigint "overtime_approved_by_id"
    t.text "overtime_note"
    t.string "overtime_status"
    t.bigint "schedule_id"
    t.bigint "service_task_id"
    t.bigint "service_type_id"
    t.time "start_time"
    t.string "status", default: "completed", null: false
    t.bigint "tax_return_id"
    t.bigint "time_category_id"
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.date "work_date", null: false
    t.index ["approval_status"], name: "index_time_entries_on_approval_status"
    t.index ["approved_by_id"], name: "index_time_entries_on_approved_by_id"
    t.index ["client_id"], name: "index_time_entries_on_client_id"
    t.index ["clock_source"], name: "index_time_entries_on_clock_source"
    t.index ["entry_method"], name: "index_time_entries_on_entry_method"
    t.index ["overtime_approved_by_id"], name: "index_time_entries_on_overtime_approved_by_id"
    t.index ["overtime_status"], name: "index_time_entries_on_overtime_status"
    t.index ["schedule_id"], name: "index_time_entries_on_schedule_id"
    t.index ["service_task_id"], name: "index_time_entries_on_service_task_id"
    t.index ["service_type_id"], name: "index_time_entries_on_service_type_id"
    t.index ["status"], name: "index_time_entries_on_status"
    t.index ["tax_return_id"], name: "index_time_entries_on_tax_return_id"
    t.index ["time_category_id"], name: "index_time_entries_on_time_category_id"
    t.index ["user_id"], name: "index_time_entries_on_user_id"
    t.index ["user_id"], name: "index_time_entries_one_active_per_user", unique: true, where: "((status)::text = ANY (ARRAY[('clocked_in'::character varying)::text, ('on_break'::character varying)::text]))"
    t.index ["work_date"], name: "index_time_entries_on_work_date"
  end

  create_table "time_entry_breaks", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "duration_minutes"
    t.datetime "end_time"
    t.datetime "start_time", null: false
    t.bigint "time_entry_id", null: false
    t.datetime "updated_at", null: false
    t.index ["time_entry_id"], name: "index_time_entry_breaks_on_time_entry_id"
    t.index ["time_entry_id"], name: "index_time_entry_breaks_one_active_per_entry", unique: true, where: "(end_time IS NULL)"
  end

  create_table "time_period_locks", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.date "end_date", null: false
    t.datetime "locked_at", null: false
    t.bigint "locked_by_id", null: false
    t.text "reason"
    t.date "start_date", null: false
    t.datetime "updated_at", null: false
    t.index ["locked_by_id"], name: "index_time_period_locks_on_locked_by_id"
    t.index ["start_date", "end_date"], name: "index_time_period_locks_on_start_date_and_end_date", unique: true
  end

  create_table "transmittals", force: :cascade do |t|
    t.bigint "client_id", null: false
    t.datetime "created_at", null: false
    t.bigint "created_by_id", null: false
    t.date "date"
    t.jsonb "items", default: []
    t.text "notes"
    t.string "status", default: "draft"
    t.bigint "tax_return_id"
    t.string "transmittal_number"
    t.datetime "updated_at", null: false
    t.index ["client_id"], name: "index_transmittals_on_client_id"
    t.index ["created_by_id"], name: "index_transmittals_on_created_by_id"
    t.index ["tax_return_id"], name: "index_transmittals_on_tax_return_id"
  end

  create_table "users", force: :cascade do |t|
    t.string "clerk_id", null: false
    t.bigint "client_id"
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.string "first_name"
    t.boolean "kiosk_enabled", default: false, null: false
    t.integer "kiosk_failed_attempts_count", default: 0, null: false
    t.datetime "kiosk_locked_until"
    t.string "kiosk_pin_digest"
    t.datetime "kiosk_pin_last_rotated_at"
    t.string "kiosk_pin_lookup_hash"
    t.string "last_name"
    t.string "phone"
    t.string "role", default: "client"
    t.datetime "updated_at", null: false
    t.index ["clerk_id"], name: "index_users_on_clerk_id", unique: true
    t.index ["client_id"], name: "index_users_on_client_id_unique", unique: true, where: "(client_id IS NOT NULL)"
    t.index ["email"], name: "index_users_on_email"
    t.index ["kiosk_enabled"], name: "index_users_on_kiosk_enabled"
    t.index ["kiosk_locked_until"], name: "index_users_on_kiosk_locked_until"
    t.index ["kiosk_pin_lookup_hash"], name: "index_users_on_kiosk_pin_lookup_hash", unique: true
    t.index ["role"], name: "index_users_on_role"
    t.check_constraint "role::text = ANY (ARRAY['admin'::character varying::text, 'employee'::character varying::text, 'client'::character varying::text])", name: "check_valid_role"
  end

  create_table "workflow_events", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "description"
    t.string "event_type"
    t.string "new_value"
    t.string "old_value"
    t.bigint "tax_return_id", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["tax_return_id"], name: "index_workflow_events_on_tax_return_id"
    t.index ["user_id"], name: "index_workflow_events_on_user_id"
  end

  create_table "workflow_stages", force: :cascade do |t|
    t.string "color"
    t.datetime "created_at", null: false
    t.text "description"
    t.boolean "is_active", default: true
    t.string "name", null: false
    t.boolean "notify_client", default: false
    t.integer "position", null: false
    t.string "slug", null: false
    t.datetime "updated_at", null: false
    t.index ["position"], name: "index_workflow_stages_on_position"
    t.index ["slug"], name: "index_workflow_stages_on_slug", unique: true
  end

  add_foreign_key "audit_logs", "users"
  add_foreign_key "client_contacts", "clients"
  add_foreign_key "client_notes", "clients"
  add_foreign_key "client_operation_assignments", "clients"
  add_foreign_key "client_operation_assignments", "operation_templates"
  add_foreign_key "client_operation_assignments", "users", column: "created_by_id"
  add_foreign_key "client_service_types", "clients"
  add_foreign_key "client_service_types", "service_types"
  add_foreign_key "daily_tasks", "clients"
  add_foreign_key "daily_tasks", "service_types"
  add_foreign_key "daily_tasks", "tax_returns"
  add_foreign_key "daily_tasks", "users", column: "assigned_to_id"
  add_foreign_key "daily_tasks", "users", column: "completed_by_id"
  add_foreign_key "daily_tasks", "users", column: "created_by_id"
  add_foreign_key "daily_tasks", "users", column: "reviewed_by_id"
  add_foreign_key "daily_tasks", "users", column: "status_changed_by_id"
  add_foreign_key "dependents", "clients"
  add_foreign_key "documents", "tax_returns"
  add_foreign_key "documents", "users", column: "uploaded_by_id"
  add_foreign_key "income_sources", "tax_returns"
  add_foreign_key "notifications", "clients"
  add_foreign_key "notifications", "tax_returns"
  add_foreign_key "operation_cycles", "client_operation_assignments"
  add_foreign_key "operation_cycles", "clients"
  add_foreign_key "operation_cycles", "operation_templates"
  add_foreign_key "operation_cycles", "users", column: "generated_by_id"
  add_foreign_key "operation_tasks", "clients"
  add_foreign_key "operation_tasks", "operation_cycles"
  add_foreign_key "operation_tasks", "operation_template_tasks"
  add_foreign_key "operation_tasks", "time_entries", column: "linked_time_entry_id"
  add_foreign_key "operation_tasks", "users", column: "assigned_to_id"
  add_foreign_key "operation_tasks", "users", column: "completed_by_id"
  add_foreign_key "operation_template_tasks", "operation_templates"
  add_foreign_key "operation_template_tasks", "users", column: "default_assignee_id"
  add_foreign_key "operation_templates", "users", column: "created_by_id"
  add_foreign_key "schedules", "users"
  add_foreign_key "schedules", "users", column: "created_by_id"
  add_foreign_key "service_tasks", "service_types"
  add_foreign_key "tax_returns", "clients"
  add_foreign_key "tax_returns", "users", column: "assigned_to_id"
  add_foreign_key "tax_returns", "users", column: "reviewed_by_id"
  add_foreign_key "tax_returns", "workflow_stages"
  add_foreign_key "time_entries", "clients"
  add_foreign_key "time_entries", "schedules"
  add_foreign_key "time_entries", "service_tasks"
  add_foreign_key "time_entries", "service_types"
  add_foreign_key "time_entries", "tax_returns"
  add_foreign_key "time_entries", "time_categories"
  add_foreign_key "time_entries", "users"
  add_foreign_key "time_entries", "users", column: "approved_by_id"
  add_foreign_key "time_entries", "users", column: "overtime_approved_by_id"
  add_foreign_key "time_entry_breaks", "time_entries"
  add_foreign_key "time_period_locks", "users", column: "locked_by_id"
  add_foreign_key "transmittals", "clients"
  add_foreign_key "transmittals", "tax_returns"
  add_foreign_key "transmittals", "users", column: "created_by_id"
  add_foreign_key "users", "clients"
  add_foreign_key "workflow_events", "tax_returns"
  add_foreign_key "workflow_events", "users"
end
