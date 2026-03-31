# frozen_string_literal: true

class PayrollChecklistTemplateService
  DEFAULT_TEMPLATE_NAME = "Payroll Period Checklist".freeze
  DEFAULT_STEPS = [
    { key: "get_hours", label: "Get hours from client", position: 1 },
    { key: "calc_payroll", label: "Calculate payroll", position: 2 },
    { key: "prep_fit_grt", label: "Prepare FIT/GRT checks", position: 3 },
    { key: "drop_fit_grt", label: "Drop FIT/GRT checks (Treasurer of Guam)", position: 4 },
    { key: "prep_payroll_checks", label: "Prepare payroll checks", position: 5 },
    { key: "deliver_payroll_checks", label: "Deliver payroll checks to client", position: 6 }
  ].freeze

  def self.ensure_default_template!(created_by:)
    template = OperationTemplate.find_or_initialize_by(name: DEFAULT_TEMPLATE_NAME)
    template.assign_attributes(
      category: "payroll",
      recurrence_type: "biweekly",
      recurrence_interval: nil,
      auto_generate: true,
      is_active: true,
      created_by: template.created_by || created_by
    )
    template.save! if template.new_record? || template.changed?

    DEFAULT_STEPS.each do |step|
      task = template.operation_template_tasks.find_or_initialize_by(title: step[:label])
      task.assign_attributes(
        description: nil,
        position: step[:position],
        evidence_required: false,
        dependency_template_task_ids: [],
        is_active: true
      )
      task.save! if task.new_record? || task.changed?
    end

    # Keep the V1 experience predictable by deactivating legacy/non-default steps.
    canonical_titles = DEFAULT_STEPS.map { |step| step[:label] }
    template.operation_template_tasks.where.not(title: canonical_titles).where(is_active: true).find_each do |task|
      task.update!(is_active: false)
    end

    template
  end
end
