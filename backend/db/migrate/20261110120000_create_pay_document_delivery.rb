# frozen_string_literal: true

# Pay stub requests and secure download links. A "pay document" is anything
# AIRE emails a worker a link to; today that is a Cornerstone pay statement,
# and year-end forms (W-2GU, 1099) can be added later as another item kind.
# No amounts, SSNs or bank data are stored: items hold only the Cornerstone
# statement ID and its dates, and each PDF is fetched live at download time.
class CreatePayDocumentDelivery < ActiveRecord::Migration[8.1]
  def change
    create_table :pay_document_requests do |t|
      t.references :user, null: false, foreign_key: true
      t.string :source, null: false
      t.string :document_kind, null: false, default: "pay_statement"
      t.string :scope, null: false
      t.string :document_reference
      t.date :document_date
      t.integer :year
      t.string :recipient_kind, null: false
      t.string :recipient_email
      t.string :status, null: false, default: "open"
      t.references :resolved_by, foreign_key: { to_table: :users }
      t.datetime :resolved_at
      t.string :resolution_note, limit: 500
      t.timestamps
    end
    add_index :pay_document_requests, [ :status, :created_at ]
    add_index :pay_document_requests, [ :user_id, :created_at ]
    add_check_constraint :pay_document_requests, "source IN ('kiosk', 'web')", name: "pay_document_requests_source"
    add_check_constraint :pay_document_requests, "document_kind IN ('pay_statement')", name: "pay_document_requests_kind"
    add_check_constraint :pay_document_requests, "scope IN ('latest', 'pay_date', 'year')", name: "pay_document_requests_scope"
    add_check_constraint :pay_document_requests, "recipient_kind IN ('on_file', 'typed')", name: "pay_document_requests_recipient_kind"
    add_check_constraint :pay_document_requests, "status IN ('open', 'fulfilled', 'dismissed')", name: "pay_document_requests_status"
    add_check_constraint :pay_document_requests,
                         "(recipient_kind = 'typed') = (recipient_email IS NOT NULL)",
                         name: "pay_document_requests_typed_email"

    create_table :pay_document_deliveries do |t|
      t.references :user, null: false, foreign_key: true
      t.references :sent_by, null: false, foreign_key: { to_table: :users }
      t.references :pay_document_request, foreign_key: true
      t.string :origin, null: false
      t.string :recipient_email, null: false
      t.string :recipient_kind, null: false
      t.string :token_digest, null: false
      t.datetime :expires_at, null: false
      t.integer :max_downloads_per_document, null: false
      t.datetime :revoked_at
      t.references :revoked_by, foreign_key: { to_table: :users }
      t.string :email_status, null: false, default: "pending"
      t.datetime :emailed_at
      t.timestamps
    end
    add_index :pay_document_deliveries, :token_digest, unique: true
    add_index :pay_document_deliveries, [ :user_id, :created_at ]
    add_index :pay_document_deliveries, [ :sent_by_id, :created_at ]
    add_check_constraint :pay_document_deliveries, "origin IN ('sender', 'self')", name: "pay_document_deliveries_origin"
    add_check_constraint :pay_document_deliveries, "recipient_kind IN ('on_file', 'typed')", name: "pay_document_deliveries_recipient_kind"
    add_check_constraint :pay_document_deliveries, "email_status IN ('pending', 'sent', 'captured', 'failed')", name: "pay_document_deliveries_email_status"
    add_check_constraint :pay_document_deliveries, "max_downloads_per_document > 0", name: "pay_document_deliveries_download_cap"

    create_table :pay_document_items do |t|
      t.references :pay_document_delivery, null: false, foreign_key: true
      t.string :kind, null: false
      t.string :reference, null: false
      t.date :document_date
      t.date :period_start
      t.date :period_end
      t.integer :position, null: false, default: 0
      t.integer :download_count, null: false, default: 0
      t.timestamps
    end
    add_index :pay_document_items, [ :pay_document_delivery_id, :kind, :reference ], unique: true, name: "index_pay_document_items_identity"
    add_check_constraint :pay_document_items, "kind IN ('pay_statement')", name: "pay_document_items_kind"
    add_check_constraint :pay_document_items, "download_count >= 0", name: "pay_document_items_download_count"

    create_table :pay_document_downloads do |t|
      t.references :pay_document_delivery, null: false, foreign_key: true
      t.references :pay_document_item, null: false, foreign_key: true
      t.boolean :bundled, null: false, default: false
      t.string :ip_address
      t.string :user_agent, limit: 1000
      t.datetime :created_at, null: false
    end
  end
end
