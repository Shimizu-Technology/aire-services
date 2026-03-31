# frozen_string_literal: true

class EnsurePayrollChecklistPeriodsService
  def initialize(assignments:, period_starts:, generated_by:)
    @assignments = assignments
    @period_starts = period_starts
    @generated_by = generated_by
  end

  def call
    @assignments.find_each do |assignment|
      @period_starts.each do |period_start|
        period_end = period_start + 13.days
        next unless assignment_active_for_period?(assignment, period_start, period_end)
        next if assignment.operation_template.blank? || !assignment.operation_template.is_active?
        next if OperationCycle.exists?(
          client_id: assignment.client_id,
          operation_template_id: assignment.operation_template_id,
          period_start: period_start,
          period_end: period_end
        )

        GenerateOperationCycleService.new(
          client: assignment.client,
          operation_template: assignment.operation_template,
          assignment: assignment,
          period_start: period_start,
          period_end: period_end,
          generation_mode: "auto",
          generated_by: @generated_by
        ).call
      end
    end
  end

  private

  def assignment_active_for_period?(assignment, period_start, period_end)
    starts_ok = assignment.starts_on.blank? || assignment.starts_on <= period_end
    ends_ok = assignment.ends_on.blank? || assignment.ends_on >= period_start
    starts_ok && ends_ok
  end
end
