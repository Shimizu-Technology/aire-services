# frozen_string_literal: true

require "rails_helper"

RSpec.describe OperationTask, type: :model do
  let!(:admin) do
    User.create!(
      clerk_id: "spec-admin-operation-task",
      email: "admin-operation-task@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:client) do
    Client.create!(
      first_name: "Test",
      last_name: "Client",
      email: "client-operation-task@example.com"
    )
  end

  let!(:template) do
    OperationTemplate.create!(
      name: "Operation Task Guard Template #{SecureRandom.hex(4)}",
      category: "general",
      recurrence_type: "monthly",
      auto_generate: true,
      created_by: admin
    )
  end

  let!(:dependency_template_task) do
    template.operation_template_tasks.create!(title: "Dependency Task", position: 1)
  end

  let!(:main_template_task) do
    template.operation_template_tasks.create!(
      title: "Main Task",
      position: 2,
      dependency_template_task_ids: [ dependency_template_task.id ]
    )
  end

  let!(:cycle) do
    OperationCycle.create!(
      client: client,
      operation_template: template,
      period_start: Date.current.beginning_of_month,
      period_end: Date.current.end_of_month,
      cycle_label: "Spec Cycle",
      generation_mode: "manual",
      status: "active"
    )
  end

  let!(:dependency_task) do
    OperationTask.create!(
      operation_cycle: cycle,
      operation_template_task: dependency_template_task,
      client: client,
      title: dependency_template_task.title,
      position: 1,
      status: "not_started",
      evidence_required: false
    )
  end

  let!(:main_task) do
    OperationTask.create!(
      operation_cycle: cycle,
      operation_template_task: main_template_task,
      client: client,
      title: main_template_task.title,
      position: 2,
      status: "not_started",
      evidence_required: false
    )
  end

  describe "prerequisite guard" do
    it "blocks transition to in_progress when dependency is not done" do
      main_task.status = "in_progress"

      expect(main_task).not_to be_valid
      expect(main_task.errors[:status]).to include("cannot be updated until prerequisites are completed")
    end

    it "allows transition to done when dependency is done" do
      dependency_task.update!(status: "done")
      main_task.status = "done"

      expect(main_task).to be_valid
    end

    it "returns unmet prerequisite tasks" do
      expect(main_task.unmet_prerequisite_tasks.map(&:id)).to eq([ dependency_task.id ])
    end
  end

  describe "evidence validation" do
    it "requires evidence note when evidence is required and task is done" do
      task = OperationTask.create(
        operation_cycle: cycle,
        operation_template_task: dependency_template_task,
        client: client,
        title: "Evidence Task",
        position: 3,
        status: "done",
        evidence_required: true,
        evidence_note: nil
      )

      expect(task).not_to be_valid
      expect(task.errors[:evidence_note]).to include("is required to complete this task")
    end

    it "allows completion when evidence note is present" do
      task = OperationTask.new(
        operation_cycle: cycle,
        operation_template_task: dependency_template_task,
        client: client,
        title: "Evidence Task Complete",
        position: 4,
        status: "done",
        evidence_required: true,
        evidence_note: "Uploaded payroll confirmation"
      )

      expect(task).to be_valid
    end
  end
end
