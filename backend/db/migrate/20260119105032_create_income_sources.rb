class CreateIncomeSources < ActiveRecord::Migration[8.1]
  def change
    create_table :income_sources do |t|
      t.references :tax_return, null: false, foreign_key: true
      t.string :source_type
      t.string :payer_name
      t.text :notes

      t.timestamps
    end
  end
end
