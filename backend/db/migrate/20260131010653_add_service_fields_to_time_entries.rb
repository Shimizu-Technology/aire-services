class AddServiceFieldsToTimeEntries < ActiveRecord::Migration[8.1]
  def change
    # Both are optional - not all time entries need a service (internal work)
    add_reference :time_entries, :service_type, null: true, foreign_key: true
    add_reference :time_entries, :service_task, null: true, foreign_key: true
  end
end
