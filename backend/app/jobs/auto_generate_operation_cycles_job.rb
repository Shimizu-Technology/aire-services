# frozen_string_literal: true

class AutoGenerateOperationCyclesJob < ApplicationJob
  queue_as :default

  def perform(run_date: Date.current, generated_by_id: nil)
    generated_by = User.find_by(id: generated_by_id) if generated_by_id.present?
    result = AutoGenerateOperationCyclesService.new(
      run_date: run_date,
      generated_by: generated_by
    ).call

    Rails.logger.info(
      "AutoGenerateOperationCyclesJob completed: generated=#{result.generated_count}, " \
      "skipped=#{result.skipped_count}, errors=#{result.errors.count}"
    )

    result
  end
end
