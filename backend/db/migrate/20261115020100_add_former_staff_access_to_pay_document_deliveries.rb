# frozen_string_literal: true

class AddFormerStaffAccessToPayDocumentDeliveries < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    add_column :pay_document_deliveries, :former_staff_access, :boolean, default: false, null: false
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    remove_column :pay_document_deliveries, :former_staff_access
  end
end
