class CreateDocuments < ActiveRecord::Migration[8.1]
  def change
    create_table :documents do |t|
      t.references :tax_return, null: false, foreign_key: true
      t.references :uploaded_by, foreign_key: { to_table: :users }  # null if client uploaded
      t.string :document_type
      t.string :filename, null: false
      t.string :s3_key, null: false
      t.string :content_type
      t.integer :file_size

      t.timestamps
    end
  end
end
