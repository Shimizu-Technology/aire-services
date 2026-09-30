# frozen_string_literal: true

class MakeSettingKeysUnique < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL
      DELETE FROM settings
      WHERE id IN (
        SELECT id
        FROM (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY key
              ORDER BY updated_at DESC, id DESC
            ) AS duplicate_position
          FROM settings
          WHERE key IS NOT NULL
        ) ranked_settings
        WHERE duplicate_position > 1
      )
    SQL

    remove_index :settings, :key
    add_index :settings, :key, unique: true
  end

  def down
    remove_index :settings, :key
    add_index :settings, :key
  end
end
