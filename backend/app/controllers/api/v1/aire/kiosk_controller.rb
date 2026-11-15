# frozen_string_literal: true

module Api
  module V1
    module Aire
      class KioskController < BaseController
        # A PIN is proved afresh even when the tablet already has a device token.
        def lock
          device = AireKioskAccessToken.device_from_token(params[:kiosk_access_token].to_s)
          return render json: { error: "Kiosk session expired. Sign in again.", code: "kiosk_device_revoked" }, status: :unauthorized unless device

          result = AireKioskService.verify_pin(pin: params[:pin].to_s, kiosk_access_token: params[:kiosk_access_token].to_s)
          manager = result[:user]
          unless manager.can_unlock_kiosk?
            record_pin_failure!(AireKioskService::KioskError.new("Enter a manager's PIN to lock this kiosk."), "kiosk.lock_failed")
            return render json: { error: "Enter a manager's PIN to lock this kiosk." }, status: :forbidden
          end

          device.with_lock do
            device.update!(revoked_at: Time.current)
            AuditLog.record!(action: "kiosk.locked", auditable: device, actor: manager,
                             event_category: "security", source: "kiosk", metadata: { device_id: device.id })
          end
          head :no_content
        rescue AireKioskService::KioskError => e
          record_pin_failure!(e, "kiosk.lock_failed")
          render json: { error: e.message, code: kiosk_error_code(e) }, status: :unprocessable_entity
        end

        # A device may discard its own access after a failed manager sign-out.
        # This endpoint only reduces access and does not permit leaving a kiosk.
        def revoke
          device = AireKioskAccessToken.device_from_token(params[:kiosk_access_token].to_s)
          if device
            device.with_lock do
              device.update!(revoked_at: Time.current)
              AuditLog.record!(action: "kiosk.session_revoked", auditable: device, actor: device.user,
                               event_category: "security", source: "kiosk", metadata: { device_id: device.id })
            end
          end
          head :no_content
        end

        # POST /api/v1/aire/kiosk/verify
        def verify
          result = AireKioskService.verify_pin(
            pin: params[:pin].to_s,
            kiosk_access_token: params[:kiosk_access_token].to_s
          )

          AuditLog.record!(
            action: "kiosk.verified",
            auditable: result[:user],
            actor: result[:user],
            event_category: "security",
            source: "kiosk",
            metadata: { kiosk_session: "verified" }
          )

          render json: {
            employee: serialize_user(result[:user]),
            kiosk_token: result[:kiosk_token],
            current_status: serialize_status(result[:current_status]),
            available_categories: serialize_categories_for(result[:user], result[:available_categories]),
            pay_stub_requests_enabled: ::PayDocuments.kiosk_requests_enabled?
          }
        rescue AireKioskService::KioskError => e
          record_pin_failure!(e, "kiosk.verification_failed")
          render json: { error: e.message, code: kiosk_error_code(e) }, status: :unprocessable_entity
        end

        def record_pin_failure!(error, action)
          failed_user = User.find_kiosk_user_by_pin(params[:pin].to_s)
          if error.message == AireKioskService::INVALID_PIN_MESSAGE && failed_user&.staff? && !failed_user.kiosk_locked?
            failed_user.register_kiosk_failure!
          end
          AuditLog.record!(
            action: action,
            actor: failed_user,
            subject_type: "User",
            subject_id: failed_user&.id || 0,
            subject_name: failed_user&.full_name || "Unknown employee",
            event_category: "security",
            actor_kind: failed_user ? "user" : "system",
            source: "kiosk",
            outcome: "failed",
            metadata: { reason: error.message, account_locked: failed_user&.kiosk_locked? }
          )
        end
        private :record_pin_failure!

        # POST /api/v1/aire/kiosk/clock_in
        def clock_in
          result = AireKioskService.clock_in(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s,
            time_category_id: params[:time_category_id]
          )

          render json: serialize_action_response(result), status: :created
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message, code: kiosk_error_code(e) }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/clock_out
        def clock_out
          result = AireKioskService.clock_out(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s,
            corrected_end_time: params[:corrected_end_time]
          )
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message, code: kiosk_error_code(e) }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/start_break
        def start_break
          result = AireKioskService.start_break(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s
          )
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message, code: kiosk_error_code(e) }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/end_break
        def end_break
          result = AireKioskService.end_break(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s
          )
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message, code: kiosk_error_code(e) }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/switch_category
        def switch_category
          result = AireKioskService.switch_category(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s,
            time_category_id: params[:time_category_id]
          )
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message, code: kiosk_error_code(e) }, status: :unprocessable_entity
        end

        private

        def kiosk_error_code(error)
          return "kiosk_device_revoked" if error.is_a?(AireKioskService::DeviceRevoked)
          return "kiosk_employee_session_refused" if error.is_a?(AireKioskService::EmployeeSessionRefused)

          "kiosk_error"
        end

        def serialize_action_response(result)
          {
            employee: serialize_user(result[:user]),
            time_entry: serialize_entry(result[:entry]),
            current_status: serialize_status(result[:current_status]),
            available_categories: serialize_categories_for(result[:user], result[:available_categories])
          }
        end

        def serialize_user(user)
          {
            id: user.id,
            display_name: user.display_name,
            full_name: user.full_name
          }
        end

        def serialize_categories_for(_user, categories)
          categories.map do |category|
            {
              id: category.id,
              key: category.key,
              name: category.name,
              description: category.description
            }
          end
        end

        def serialize_status(status)
          entry = status[:entry_id] ? TimeEntry.includes(:time_category).find_by(id: status[:entry_id]) : nil

          tc = entry&.time_category
          status.merge(
            schedule: status[:schedule],
            breaks: status[:breaks],
            time_category: tc ? { id: tc.id, key: tc.key, name: tc.name } : nil,
            clock_source: entry&.clock_source
          )
        end

        def serialize_entry(entry)
          entry = TimeEntry.includes(:time_category).find(entry.id) unless entry.association(:time_category).loaded?
          tc = entry.time_category
          {
            id: entry.id,
            work_date: entry.work_date.iso8601,
            status: entry.status,
            clock_source: entry.clock_source,
            clock_in_at: entry.clock_in_at&.iso8601,
            clock_out_at: entry.clock_out_at&.iso8601,
            break_minutes: entry.break_minutes,
            hours: entry.hours.to_f,
            time_category: tc ? { id: tc.id, key: tc.key, name: tc.name } : nil
          }
        end
      end
    end
  end
end
