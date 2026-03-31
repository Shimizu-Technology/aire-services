class AddArchivedAtToClients < ActiveRecord::Migration[8.1]
  def change
    unless column_exists?(:clients, :archived_at)
      add_column :clients, :archived_at, :datetime
      add_index :clients, :archived_at
    end
  end
end
