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

ActiveRecord::Schema[8.1].define(version: 2026_04_09_061342) do
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
    t.string "clerk_id", null: false
    t.datetime "created_at", null: false
    t.string "email"
    t.string "first_name"
    t.boolean "kiosk_enabled", default: false, null: false
    t.integer "kiosk_failed_attempts_count", default: 0, null: false
    t.datetime "kiosk_locked_until"
    t.string "kiosk_pin_digest"
    t.datetime "kiosk_pin_last_rotated_at"
    t.string "kiosk_pin_lookup_hash"
    t.string "last_name"
    t.string "phone"
    t.string "role", default: "employee"
    t.datetime "updated_at", null: false
    t.index ["clerk_id"], name: "index_users_on_clerk_id", unique: true
    t.index ["email"], name: "index_users_on_email"
    t.index ["kiosk_enabled"], name: "index_users_on_kiosk_enabled"
    t.index ["kiosk_locked_until"], name: "index_users_on_kiosk_locked_until"
    t.index ["kiosk_pin_lookup_hash"], name: "index_users_on_kiosk_pin_lookup_hash", unique: true
    t.index ["role"], name: "index_users_on_role"
    t.check_constraint "role::text = ANY (ARRAY['admin'::character varying, 'employee'::character varying]::text[])", name: "check_valid_role"
  end

  add_foreign_key "audit_logs", "users"
  add_foreign_key "employee_pay_rates", "time_categories"
  add_foreign_key "employee_pay_rates", "users"
  add_foreign_key "schedules", "users"
  add_foreign_key "schedules", "users", column: "created_by_id"
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
