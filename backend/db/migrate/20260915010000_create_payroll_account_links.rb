# frozen_string_literal: true

class CreatePayrollAccountLinks < ActiveRecord::Migration[8.1]
  def change
    create_table :payroll_account_links do |t|
      t.references :user, null: false, foreign_key: { on_delete: :restrict }
      t.string :external_system, null: false, default: "cornerstone_payroll"
      t.string :external_actor_id, null: false
      t.string :external_actor_email
      t.boolean :active, null: false, default: true
      t.datetime :linked_at, null: false
      t.datetime :revoked_at
      t.timestamps
    end

    add_index :payroll_account_links,
              [ :external_system, :external_actor_id ],
              unique: true,
              name: "idx_payroll_account_links_external_actor"
    add_index :payroll_account_links,
              [ :external_system, :user_id ],
              unique: true,
              name: "idx_payroll_account_links_external_user"

    create_table :payroll_account_link_sessions do |t|
      t.string :token_digest, null: false
      t.string :external_system, null: false, default: "cornerstone_payroll"
      t.string :external_actor_id, null: false
      t.string :external_actor_email
      t.string :return_url, null: false
      t.datetime :expires_at, null: false
      t.datetime :consumed_at
      t.references :linked_user, foreign_key: { to_table: :users, on_delete: :nullify }
      t.timestamps
    end

    add_index :payroll_account_link_sessions, :token_digest, unique: true
    add_index :payroll_account_link_sessions, :expires_at
  end
end
