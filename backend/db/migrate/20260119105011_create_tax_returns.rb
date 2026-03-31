class CreateTaxReturns < ActiveRecord::Migration[8.1]
  def change
    create_table :tax_returns do |t|
      t.references :client, null: false, foreign_key: true
      t.integer :tax_year, null: false
      t.references :workflow_stage, foreign_key: true
      t.references :assigned_to, foreign_key: { to_table: :users }
      t.references :reviewed_by, foreign_key: { to_table: :users }
      t.text :notes
      t.datetime :completed_at

      t.timestamps
    end

    add_index :tax_returns, [:client_id, :tax_year], unique: true
  end
end
