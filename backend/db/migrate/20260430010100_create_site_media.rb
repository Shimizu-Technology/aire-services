class CreateSiteMedia < ActiveRecord::Migration[8.1]
  def change
    create_table :site_media do |t|
      t.string :title, null: false
      t.string :alt_text
      t.string :caption
      t.string :placement, null: false
      t.string :media_type, null: false, default: "image"
      t.string :external_url
      t.integer :sort_order, null: false, default: 0
      t.boolean :active, null: false, default: true
      t.boolean :featured, null: false, default: false
      t.references :uploaded_by, foreign_key: { to_table: :users }
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :site_media, :placement
    add_index :site_media, :media_type
    add_index :site_media, [ :placement, :active, :sort_order ]
  end
end
