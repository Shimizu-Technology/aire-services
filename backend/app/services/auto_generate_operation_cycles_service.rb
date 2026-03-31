# frozen_string_literal: true

class AutoGenerateOperationCyclesService
  Result = Struct.new(:generated_count, :skipped_count, :errors, keyword_init: true)

  def initialize(run_date: Date.current, generated_by: nil)
    @run_date = run_date
    @generated_by = generated_by
    @errors = []
    @generated_count = 0
    @skipped_count = 0
  end

  def call
    eligible_assignments.find_each do |assignment|
      period_start, period_end = period_for(assignment)
      unless period_start && period_end
        @skipped_count += 1
        next
      end

      result = GenerateOperationCycleService.new(
        client: assignment.client,
        operation_template: assignment.operation_template,
        assignment: assignment,
        period_start: period_start,
        period_end: period_end,
        generation_mode: "auto",
        generated_by: @generated_by
      ).call

      if result.success?
        @generated_count += 1
      elsif result.duplicate?
        # Duplicate period generation is expected and treated as idempotent skip
        @skipped_count += 1
      else
        @errors << "Assignment #{assignment.id}: #{result.errors.join(', ')}"
      end
    end

    Result.new(generated_count: @generated_count, skipped_count: @skipped_count, errors: @errors)
  end

  private

  def eligible_assignments
    ClientOperationAssignment
      .includes(:operation_template, :client)
      .where(assignment_status: "active", auto_generate: true)
      .joins(:operation_template)
      .where(operation_templates: { is_active: true, auto_generate: true })
      .where("starts_on IS NULL OR starts_on <= ?", @run_date)
      .where("ends_on IS NULL OR ends_on >= ?", @run_date)
  end

  def period_for(assignment)
    template = assignment.operation_template
    case template.recurrence_type
    when "weekly"
      [ @run_date.beginning_of_week, @run_date.end_of_week ]
    when "biweekly"
      biweekly_period(assignment.starts_on || @run_date.beginning_of_week)
    when "monthly"
      [ @run_date.beginning_of_month, @run_date.end_of_month ]
    when "quarterly"
      [ @run_date.beginning_of_quarter, @run_date.end_of_quarter ]
    when "custom"
      custom_period(assignment.starts_on || @run_date, template.recurrence_interval)
    else
      [ nil, nil ]
    end
  end

  def biweekly_period(anchor_date)
    anchor = anchor_date.to_date
    days_since_anchor = (@run_date - anchor).to_i
    offset_days = days_since_anchor % 14
    period_start = @run_date - offset_days
    [ period_start, period_start + 13.days ]
  end

  # Custom recurrence is treated as an N-day period for now.
  def custom_period(anchor_date, interval_days)
    return [ nil, nil ] if interval_days.blank? || interval_days <= 0

    anchor = anchor_date.to_date
    days_since_anchor = (@run_date - anchor).to_i
    offset_days = days_since_anchor % interval_days
    period_start = @run_date - offset_days
    [ period_start, period_start + (interval_days - 1).days ]
  end
end
