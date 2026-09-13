# frozen_string_literal: true

module Payroll
  module RetrySchedule
    MAX_RETRY_DELAY = 1.hour
    DEFAULT_ALERT_THRESHOLD = 5

    class RepeatedFailure < StandardError; end

    private

    def retry_delay(attempts)
      exponent = [ [ attempts, 1 ].max, 7 ].min - 1
      [ 1.minute * (2**exponent), MAX_RETRY_DELAY ].min
    end

    def safe_error(error)
      "#{error.class}: #{error.message}".truncate(500)
    end

    def report_repeated_failure!(record_type:, record_id:, attempts:, error:)
      return if attempts < retry_alert_threshold

      Rails.error.report(
        RepeatedFailure.new("#{record_type} #{record_id} has failed #{attempts} delivery attempts"),
        handled: true,
        severity: :warning,
        context: {
          record_type: record_type,
          record_id: record_id,
          attempts: attempts,
          last_error: safe_error(error)
        }
      )
    rescue StandardError => monitoring_error
      Rails.logger.error("Payroll retry alert failed: #{monitoring_error.class}: #{monitoring_error.message}")
    end

    def retry_alert_threshold
      source = respond_to?(:env, true) ? env : ENV
      Integer(source.fetch("PAYROLL_RETRY_ALERT_THRESHOLD", DEFAULT_ALERT_THRESHOLD.to_s), 10).clamp(1, 1_000)
    rescue ArgumentError
      DEFAULT_ALERT_THRESHOLD
    end
  end
end
