# frozen_string_literal: true

require "rails_helper"

RSpec.describe GenerateOperationCycleService, type: :service do
  let!(:admin) do
    User.create!(
      clerk_id: "spec-admin-generate-cycle-service",
      email: "admin-generate-cycle-service@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:client) do
    Client.create!(
      first_name: "Cycle",
      last_name: "Client",
      email: "cycle-client@example.com"
    )
  end

  let!(:template) do
    OperationTemplate.create!(
      name: "Generate Cycle Service Template #{SecureRandom.hex(4)}",
      category: "general",
      recurrence_type: "monthly",
      auto_generate: true,
      created_by: admin
    )
  end

  let!(:task_a) do
    template.operation_template_tasks.create!(
      title: "Collect Inputs",
      position: 1,
      due_offset_value: 1,
      due_offset_unit: "days",
      due_offset_from: "cycle_start"
    )
  end

  let!(:task_b) do
    template.operation_template_tasks.create!(
      title: "Finalize Work",
      position: 2,
      dependency_template_task_ids: [ task_a.id ],
      evidence_required: true
    )
  end

  let!(:assignment) do
    ClientOperationAssignment.create!(
      client: client,
      operation_template: template,
      auto_generate: true,
      assignment_status: "active",
      created_by: admin
    )
  end

  describe "#call" do
    it "creates cycle and tasks with expected metadata" do
      period_start = Date.current.beginning_of_month
      period_end = Date.current.end_of_month

      result = described_class.new(
        client: client,
        operation_template: template,
        period_start: period_start,
        period_end: period_end,
        generation_mode: "manual",
        generated_by: admin
      ).call

      expect(result.success?).to be(true)
      expect(result.errors).to eq([])
      expect(result.cycle).to be_present
      expect(result.cycle.operation_tasks.count).to eq(2)

      generated_task_a = result.cycle.operation_tasks.find_by(operation_template_task_id: task_a.id)
      generated_task_b = result.cycle.operation_tasks.find_by(operation_template_task_id: task_b.id)

      expect(generated_task_a.due_at).to be_present
      expect(generated_task_b.evidence_required).to be(true)
      expect(generated_task_b.unmet_prerequisite_tasks.map(&:id)).to eq([ generated_task_a.id ])
    end

    it "preserves template task ordering in generated tasks" do
      task_a.update!(position: 5)
      task_b.update!(position: 1)

      result = described_class.new(
        client: client,
        operation_template: template,
        period_start: Date.current.beginning_of_month,
        period_end: Date.current.end_of_month,
        generation_mode: "manual",
        generated_by: admin
      ).call

      expect(result.success?).to be(true)
      ordered_template_task_ids = result.cycle.operation_tasks.order(:position).pluck(:operation_template_task_id)
      expect(ordered_template_task_ids).to eq([ task_b.id, task_a.id ])
    end

    it "returns failure for invalid period range" do
      result = described_class.new(
        client: client,
        operation_template: template,
        period_start: Date.current,
        period_end: Date.current - 1.day,
        generation_mode: "manual",
        generated_by: admin
      ).call

      expect(result.success?).to be(false)
      expect(result.errors.join).to include("Period end must be on or after period start")
    end

    it "returns failure for inactive template" do
      template.update!(is_active: false)
      result = described_class.new(
        client: client,
        operation_template: template,
        period_start: Date.current.beginning_of_month,
        period_end: Date.current.end_of_month,
        generation_mode: "manual",
        generated_by: admin
      ).call

      expect(result.success?).to be(false)
      expect(result.errors.join).to include("Operation template is not active")
    end

    it "skips excluded template tasks for assignment" do
      assignment.update!(excluded_template_task_ids: [ task_b.id ])

      result = described_class.new(
        client: client,
        operation_template: template,
        assignment: assignment,
        period_start: Date.current.beginning_of_month,
        period_end: Date.current.end_of_month,
        generation_mode: "manual",
        generated_by: admin
      ).call

      expect(result.success?).to be(true)
      expect(result.cycle.operation_tasks.pluck(:operation_template_task_id)).to eq([ task_a.id ])
    end
  end
end
