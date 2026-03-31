# frozen_string_literal: true

class CreateClientNotes < ActiveRecord::Migration[8.1]
  def change
    create_table :client_notes do |t|
      t.references :client, null: false, foreign_key: true, index: true
      t.text :content, null: false
      t.string :category, default: "general", null: false # general, document, question
      t.datetime :deleted_at # soft delete

      t.timestamps
    end

    add_index :client_notes, [:client_id, :created_at]
  end
end
