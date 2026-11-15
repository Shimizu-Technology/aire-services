# frozen_string_literal: true

class IndexPayDocumentItemPeriods < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    add_index :pay_document_items, [ :period_start, :period_end ]
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    remove_index :pay_document_items, [ :period_start, :period_end ]
  end
end
