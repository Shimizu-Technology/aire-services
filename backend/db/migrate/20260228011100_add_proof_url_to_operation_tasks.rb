class AddProofUrlToOperationTasks < ActiveRecord::Migration[8.1]
  def change
    add_column :operation_tasks, :proof_url, :string
  end
end
