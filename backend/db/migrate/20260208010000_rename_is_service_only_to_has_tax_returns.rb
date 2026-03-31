# frozen_string_literal: true

class RenameIsServiceOnlyToHasTaxReturns < ActiveRecord::Migration[8.1]
  def change
    # Rename the column and invert the boolean logic
    # is_service_only: true means NO tax returns
    # has_tax_returns: true means HAS tax returns (clearer naming)
    rename_column :clients, :is_service_only, :has_tax_returns

    # Invert all existing values: is_service_only=true -> has_tax_returns=false
    reversible do |dir|
      dir.up do
        execute "UPDATE clients SET has_tax_returns = NOT has_tax_returns"
      end
      dir.down do
        execute "UPDATE clients SET has_tax_returns = NOT has_tax_returns"
      end
    end

    # Update default: is_service_only defaulted to false (meaning has tax returns)
    # has_tax_returns should default to true (most clients are tax clients)
    change_column_default :clients, :has_tax_returns, from: false, to: true
  end
end
