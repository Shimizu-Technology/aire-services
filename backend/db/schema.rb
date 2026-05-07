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

ActiveRecord::Schema[8.1].define(version: 2026_05_07_010000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "active_storage_attachments", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.bigint "record_id", null: false
    t.string "record_type", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "filename", null: false
    t.string "key", null: false
    t.text "metadata"
    t.string "service_name", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "active_storage_variant_records", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.string "variation_digest", null: false
    t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
  end

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

  create_table "employee_pay_rates", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "hourly_rate_cents", null: false
    t.bigint "time_category_id", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["time_category_id"], name: "index_employee_pay_rates_on_time_category_id"
    t.index ["user_id", "time_category_id"], name: "idx_employee_pay_rates_user_category", unique: true
    t.index ["user_id"], name: "index_employee_pay_rates_on_user_id"
  end

  create_table "leave_requests", force: :cascade do |t|
    t.datetime "cancelled_at"
    t.bigint "cancelled_by_id"
    t.datetime "created_at", null: false
    t.date "end_date", null: false
    t.string "leave_type", null: false
    t.text "reason"
    t.text "review_note"
    t.datetime "reviewed_at"
    t.bigint "reviewed_by_id"
    t.date "start_date", null: false
    t.string "status", default: "pending", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["cancelled_by_id"], name: "index_leave_requests_on_cancelled_by_id"
    t.index ["reviewed_by_id"], name: "index_leave_requests_on_reviewed_by_id"
    t.index ["status", "start_date"], name: "index_leave_requests_on_status_and_start_date"
    t.index ["status"], name: "index_leave_requests_on_status"
    t.index ["user_id", "start_date"], name: "index_leave_requests_on_user_id_and_start_date"
    t.index ["user_id"], name: "index_leave_requests_on_user_id"
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

  create_table "settings", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "description"
    t.string "key"
    t.datetime "updated_at", null: false
    t.text "value"
    t.index ["key"], name: "index_settings_on_key"
  end

  create_table "site_media", force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.string "alt_text"
    t.string "caption"
    t.datetime "created_at", null: false
    t.string "external_url"
    t.boolean "featured", default: false, null: false
    t.string "media_type", default: "image", null: false
    t.jsonb "metadata", default: {}, null: false
    t.string "placement", null: false
    t.integer "sort_order", default: 0, null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.bigint "uploaded_by_id"
    t.index ["media_type"], name: "index_site_media_on_media_type"
    t.index ["placement", "active", "sort_order"], name: "index_site_media_on_placement_and_active_and_sort_order"
    t.index ["placement"], name: "index_site_media_on_placement"
    t.index ["uploaded_by_id"], name: "index_site_media_on_uploaded_by_id"
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
    t.datetime "clock_in_at"
    t.datetime "clock_out_at"
    t.string "clock_source"
    t.datetime "created_at", null: false
    t.text "description"
    t.integer "effective_rate_cents_snapshot"
    t.time "end_time"
    t.string "entry_method", default: "manual", null: false
    t.decimal "hours", precision: 4, scale: 2, null: false
    t.datetime "locked_at"
    t.datetime "overtime_approved_at"
    t.bigint "overtime_approved_by_id"
    t.text "overtime_note"
    t.string "overtime_status"
    t.bigint "schedule_id"
    t.time "start_time"
    t.string "status", default: "completed", null: false
    t.bigint "time_category_id"
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.date "work_date", null: false
    t.index ["approval_status"], name: "index_time_entries_on_approval_status"
    t.index ["approved_by_id"], name: "index_time_entries_on_approved_by_id"
    t.index ["clock_source"], name: "index_time_entries_on_clock_source"
    t.index ["entry_method"], name: "index_time_entries_on_entry_method"
    t.index ["overtime_approved_by_id"], name: "index_time_entries_on_overtime_approved_by_id"
    t.index ["overtime_status"], name: "index_time_entries_on_overtime_status"
    t.index ["schedule_id"], name: "index_time_entries_on_schedule_id"
    t.index ["status"], name: "index_time_entries_on_status"
    t.index ["time_category_id"], name: "index_time_entries_on_time_category_id"
    t.index ["user_id", "work_date", "entry_method"], name: "idx_time_entries_user_date_method"
    t.index ["user_id", "work_date"], name: "idx_time_entries_user_date"
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

  create_table "user_time_categories", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "hourly_rate_cents"
    t.bigint "time_category_id", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["time_category_id"], name: "index_user_time_categories_on_time_category_id"
    t.index ["user_id", "time_category_id"], name: "index_user_time_categories_on_user_id_and_time_category_id", unique: true
    t.index ["user_id"], name: "index_user_time_categories_on_user_id"
  end

  create_table "users", force: :cascade do |t|
    t.string "approval_group"
    t.string "clerk_id", null: false
    t.datetime "created_at", null: false
    t.string "email"
    t.string "first_name"
    t.boolean "is_active", default: true, null: false
    t.boolean "kiosk_enabled", default: false, null: false
    t.integer "kiosk_failed_attempts_count", default: 0, null: false
    t.datetime "kiosk_locked_until"
    t.string "kiosk_pin_digest"
    t.datetime "kiosk_pin_last_rotated_at"
    t.string "kiosk_pin_lookup_hash"
    t.string "last_name"
    t.string "phone"
    t.boolean "public_team_enabled", default: false, null: false
    t.string "public_team_name"
    t.integer "public_team_sort_order", default: 0, null: false
    t.string "public_team_title"
    t.string "role", default: "employee"
    t.string "staff_title"
    t.datetime "updated_at", null: false
    t.index ["approval_group"], name: "index_users_on_approval_group"
    t.index ["clerk_id"], name: "index_users_on_clerk_id", unique: true
    t.index ["email"], name: "index_users_on_email"
    t.index ["is_active"], name: "index_users_on_is_active"
    t.index ["kiosk_enabled"], name: "index_users_on_kiosk_enabled"
    t.index ["kiosk_locked_until"], name: "index_users_on_kiosk_locked_until"
    t.index ["kiosk_pin_lookup_hash"], name: "index_users_on_kiosk_pin_lookup_hash", unique: true
    t.index ["public_team_enabled", "public_team_sort_order"], name: "index_users_on_public_team_visibility_and_sort"
    t.index ["role"], name: "index_users_on_role"
    t.check_constraint "role::text = ANY (ARRAY['admin'::character varying, 'employee'::character varying]::text[])", name: "check_valid_role"
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "audit_logs", "users"
  add_foreign_key "employee_pay_rates", "time_categories"
  add_foreign_key "employee_pay_rates", "users"
  add_foreign_key "leave_requests", "users"
  add_foreign_key "leave_requests", "users", column: "cancelled_by_id"
  add_foreign_key "leave_requests", "users", column: "reviewed_by_id"
  add_foreign_key "schedules", "users"
  add_foreign_key "schedules", "users", column: "created_by_id"
  add_foreign_key "site_media", "users", column: "uploaded_by_id"
  add_foreign_key "time_entries", "schedules"
  add_foreign_key "time_entries", "time_categories"
  add_foreign_key "time_entries", "users"
  add_foreign_key "time_entries", "users", column: "approved_by_id"
  add_foreign_key "time_entries", "users", column: "overtime_approved_by_id"
  add_foreign_key "time_entry_breaks", "time_entries"
  add_foreign_key "time_period_locks", "users", column: "locked_by_id"
  add_foreign_key "user_time_categories", "time_categories"
  add_foreign_key "user_time_categories", "users"
end
