# frozen_string_literal: true

class AireKioskService
  class KioskError < StandardError; end

  class << self
    def verify_pin(pin:)
      validate_pin!(pin)

      user = User.find_kiosk_user_by_pin(pin)
      raise KioskError, invalid_pin_message unless user
      raise KioskError, invalid_pin_message unless user.staff?
      raise KioskError, "Kiosk access is temporarily locked. Please contact a manager." if user.kiosk_locked?
      raise KioskError, invalid_pin_message unless user.kiosk_enabled?
      raise KioskError, invalid_pin_message unless user.verify_kiosk_pin(pin)

      user.clear_kiosk_failures!

      {
        user: user,
        kiosk_token: AireKioskToken.issue_for(user),
        current_status: TimeClockService.current_status(user: user),
        available_categories: available_categories_for(user)
      }
    end

    def clock_in(kiosk_token:, time_category_id: nil)
      user = user_from_token!(kiosk_token)
      entry = TimeClockService.clock_in(user: user, time_category_id: time_category_id, clock_source: "kiosk")
      log_action(entry: entry, action: "created", metadata: "source=kiosk;event=clock_in")
      response_payload(user, entry)
    end

    def clock_out(kiosk_token:)
      user = user_from_token!(kiosk_token)
      entry = TimeClockService.clock_out(user: user)
      log_action(entry: entry, action: "updated", metadata: "source=kiosk;event=clock_out")
      response_payload(user, entry)
    end

    def start_break(kiosk_token:)
      user = user_from_token!(kiosk_token)
      entry = TimeClockService.start_break(user: user)
      log_action(entry: entry, action: "updated", metadata: "source=kiosk;event=start_break")
      response_payload(user, entry)
    end

    def end_break(kiosk_token:)
      user = user_from_token!(kiosk_token)
      entry = TimeClockService.end_break(user: user)
      log_action(entry: entry, action: "updated", metadata: "source=kiosk;event=end_break")
      response_payload(user, entry)
    end

    def switch_category(kiosk_token:, time_category_id:)
      user = user_from_token!(kiosk_token)
      entry = TimeClockService.switch_category(user: user, time_category_id: time_category_id, clock_source: "kiosk")
      log_action(entry: entry, action: "created", metadata: "source=kiosk;event=switch_category")
      response_payload(user, entry)
    end

    private

    def response_payload(user, entry)
      {
        user: user,
        entry: entry,
        current_status: TimeClockService.current_status(user: user),
        available_categories: available_categories_for(user)
      }
    end

    def user_from_token!(kiosk_token)
      user = AireKioskToken.user_from_token(kiosk_token)
      raise KioskError, "Kiosk session expired. Please enter your PIN again." unless user
      raise KioskError, "Kiosk access is unavailable for this employee." unless user.kiosk_access_enabled?

      user
    end

    def available_categories_for(user)
      user.assigned_time_categories.active.order(:name)
    end

    def validate_pin!(pin)
      return if pin.present? && pin.match?(User::KIOSK_PIN_FORMAT)

      raise KioskError, invalid_pin_message
    end

    def invalid_pin_message
      "Invalid PIN"
    end

    def log_action(entry:, action:, metadata:)
      AuditLog.log(auditable: entry, action: action, metadata: metadata)
    rescue StandardError => e
      Rails.logger.warn("AIRE kiosk audit log failed for time_entry=#{entry.id}: #{e.message}")
    end
  end
end
