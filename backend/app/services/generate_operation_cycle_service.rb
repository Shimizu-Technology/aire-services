# frozen_string_literal: true

class GenerateOperationCycleService
  Result = Struct.new(:success, :cycle, :errors, :duplicate, keyword_init: true) do
    def success? = success
    def duplicate? = duplicate
  end

  def initialize(client:, operation_template:, period_start:, period_end:, generation_mode:, generated_by:, assignment: nil, pay_date: nil)
    @client = client
    @operation_template = operation_template
    @assignment = assignment
    @period_start = period_start
    @period_end = period_end
    @generation_mode = generation_mode
    @generated_by = generated_by
    @pay_date = pay_date
    @errors = []
  end

  def call
    return failure("Period start and period end are required") if @period_start.blank? || @period_end.blank?
    return failure("Period end must be on or after period start") if @period_end < @period_start
    return failure("Operation template is not active") unless @operation_template.is_active?

    if OperationCycle.exists?(
      client_id: @client.id,
      operation_template_id: @operation_template.id,
      period_start: @period_start,
      period_end: @period_end
    )
      return Result.new(success: false, cycle: nil, errors: ["Operation cycle already exists for this period"], duplicate: true)
    end

    cycle = nil

    ActiveRecord::Base.transaction do
      cycle = OperationCycle.create!(
        client: @client,
        operation_template: @operation_template,
        client_operation_assignment: @assignment,
        period_start: @period_start,
        period_end: @period_end,
        pay_date: @pay_date,
        cycle_label: cycle_label,
        generation_mode: @generation_mode,
        generated_by: @generated_by,
        status: "active"
      )

      build_tasks!(cycle)
    end

    Result.new(success: true, cycle: cycle, errors: [], duplicate: false)
  rescue ActiveRecord::RecordInvalid => e
    # Explicit duplicate handling for race conditions hitting unique index
    if e.record.is_a?(OperationCycle) && e.record.errors.added?(:period_start, :taken)
      Result.new(success: false, cycle: nil, errors: ["Operation cycle already exists for this period"], duplicate: true)
    else
      failure(e.record.errors.full_messages)
    end
  rescue ActiveRecord::RecordNotUnique
    Result.new(success: false, cycle: nil, errors: ["Operation cycle already exists for this period"], duplicate: true)
  rescue StandardError => e
    failure(e.message)
  end

  private

  def build_tasks!(cycle)
    excluded_task_ids = Array(@assignment&.excluded_template_task_ids).map(&:to_i)
    template_tasks = @operation_template.operation_template_tasks.active.ordered
    template_tasks = template_tasks.where.not(id: excluded_task_ids) if excluded_task_ids.any?

    template_tasks.each do |template_task|
      cycle.operation_tasks.create!(
        client: @client,
        operation_template_task: template_task,
        title: template_task.title,
        description: template_task.description,
        position: template_task.position,
        evidence_required: template_task.evidence_required,
        due_at: calculate_due_at(template_task)
      )
    end
  end

  def calculate_due_at(template_task)
    return nil if template_task.due_offset_value.blank? || template_task.due_offset_unit.blank? || template_task.due_offset_from.blank?

    anchor = template_task.due_offset_from == "cycle_end" ? @period_end : @period_start
    multiplier = template_task.due_offset_unit == "hours" ? template_task.due_offset_value.hours : template_task.due_offset_value.days
    anchor + multiplier
  end

  def cycle_label
    "#{@operation_template.name} (#{@period_start.strftime('%b %-d')} - #{@period_end.strftime('%b %-d, %Y')})"
  end

  def failure(message)
    errors = message.is_a?(Array) ? message : [message]
    Result.new(success: false, cycle: nil, errors: errors, duplicate: false)
  end
end
