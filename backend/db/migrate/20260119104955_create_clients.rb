class CreateClients < ActiveRecord::Migration[8.1]
  def change
    create_table :clients do |t|
      # Basic Info
      t.string :first_name, null: false
      t.string :last_name, null: false
      t.date :date_of_birth
      t.string :email
      t.string :phone
      t.text :mailing_address

      # Filing Info
      t.string :filing_status  # married, single, hoh, other
      t.boolean :is_new_client, default: true
      t.boolean :has_prior_year_return, default: false
      t.text :changes_from_prior_year

      # Spouse Info
      t.string :spouse_name
      t.date :spouse_dob

      # Special Questions
      t.boolean :denied_eic_actc, default: false
      t.integer :denied_eic_actc_year
      t.boolean :has_crypto_transactions, default: false

      # Bank Info (encrypted)
      t.string :bank_routing_number_encrypted
      t.string :bank_account_number_encrypted
      t.string :bank_account_type  # checking, savings
      t.boolean :wants_direct_deposit, default: false

      t.timestamps
    end

    add_index :clients, :email
    add_index :clients, [:last_name, :first_name]
  end
end
