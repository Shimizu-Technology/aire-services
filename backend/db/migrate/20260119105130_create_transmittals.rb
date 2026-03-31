class CreateTransmittals < ActiveRecord::Migration[8.1]
  def change
    create_table :transmittals do |t|
      t.references :client, null: false, foreign_key: true
      t.references :tax_return, foreign_key: true  # optional
      t.references :created_by, null: false, foreign_key: { to_table: :users }
      t.string :transmittal_number
      t.date :date
      t.jsonb :items, default: []
      t.text :notes
      t.string :status, default: 'draft'

      t.timestamps
    end
  end
end
