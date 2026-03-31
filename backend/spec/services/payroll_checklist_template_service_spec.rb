# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollChecklistTemplateService, type: :service do
  let!(:admin) do
    User.create!(
      clerk_id: "spec-admin-payroll-template-service",
      email: "admin-payroll-template-service@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  describe ".ensure_default_template!" do
    it "ensures default steps are active and deactivates legacy extra steps" do
      template = OperationTemplate.create!(
        name: PayrollChecklistTemplateService::DEFAULT_TEMPLATE_NAME,
        category: "payroll",
        recurrence_type: "biweekly",
        auto_generate: true,
        created_by: admin
      )
      template.operation_template_tasks.create!(
        title: "Legacy Extra Step",
        position: 99,
        is_active: true
      )

      result = described_class.ensure_default_template!(created_by: admin)

      expect(result.id).to eq(template.id)
      default_titles = PayrollChecklistTemplateService::DEFAULT_STEPS.map { |step| step[:label] }
      active_titles = result.operation_template_tasks.active.order(:position).pluck(:title)

      expect(active_titles).to eq(default_titles)
      expect(result.operation_template_tasks.find_by(title: "Legacy Extra Step").is_active).to eq(false)
    end
  end
end
