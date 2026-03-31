class CreateNotifications < ActiveRecord::Migration[8.1]
  def change
    create_table :notifications do |t|
      t.references :client, null: false, foreign_key: true
      t.references :tax_return, foreign_key: true  # optional
      t.string :notification_type  # email, sms
      t.string :template  # ready_to_sign, ready_for_pickup, etc.
      t.string :recipient  # email address or phone number
      t.string :status, default: 'pending'  # pending, sent, failed
      t.text :content
      t.datetime :sent_at
      t.text :error_message

      t.timestamps
    end

    add_index :notifications, :status
  end
end
