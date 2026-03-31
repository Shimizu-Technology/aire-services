class AddExcludedTemplateTaskIdsToClientOperationAssignments < ActiveRecord::Migration[8.1]
  def change
    add_column :client_operation_assignments, :excluded_template_task_ids, :integer, array: true, default: [], null: false
  end
end
