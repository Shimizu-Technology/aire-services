# frozen_string_literal: true

require "rails_helper"

RSpec.describe OperationTemplateTask, type: :model do
  let!(:admin) do
    User.create!(
      clerk_id: "spec-admin-operation-template-task",
      email: "admin-operation-template-task@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:template) do
    OperationTemplate.create!(
      name: "Spec Template #{SecureRandom.hex(4)}",
      category: "general",
      recurrence_type: "monthly",
      auto_generate: true,
      created_by: admin
    )
  end

  let!(:other_template) do
    OperationTemplate.create!(
      name: "Other Spec Template #{SecureRandom.hex(4)}",
      category: "general",
      recurrence_type: "monthly",
      auto_generate: true,
      created_by: admin
    )
  end

  describe "dependency_template_task_ids validation" do
    it "allows dependencies that belong to the same template" do
      dependency = template.operation_template_tasks.create!(title: "Dependency Task", position: 1)
      task = template.operation_template_tasks.build(
        title: "Main Task",
        position: 2,
        dependency_template_task_ids: [ dependency.id ]
      )

      expect(task).to be_valid
    end

    it "rejects dependencies from a different template" do
      external_dependency = other_template.operation_template_tasks.create!(title: "External Dependency", position: 1)
      task = template.operation_template_tasks.build(
        title: "Main Task",
        position: 2,
        dependency_template_task_ids: [ external_dependency.id ]
      )

      expect(task).not_to be_valid
      expect(task.errors[:dependency_template_task_ids]).to include("contain invalid task references")
    end

    it "rejects self dependency on update" do
      task = template.operation_template_tasks.create!(title: "Main Task", position: 1)
      task.dependency_template_task_ids = [ task.id ]

      expect(task).not_to be_valid
      expect(task.errors[:dependency_template_task_ids]).to include("cannot include the task itself")
    end
  end
end
