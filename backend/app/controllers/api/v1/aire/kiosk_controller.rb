# frozen_string_literal: true

module Api
  module V1
    module Aire
      class KioskController < BaseController
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
            available_categories: serialize_categories_for(result[:user], result[:available_categories])
          }
        rescue AireKioskService::KioskError => e
          failed_user = User.find_kiosk_user_by_pin(params[:pin].to_s)
          if e.message == AireKioskService::INVALID_PIN_MESSAGE && failed_user&.staff? && !failed_user.kiosk_locked?
            failed_user.register_kiosk_failure!
          end
          AuditLog.record!(
            action: "kiosk.verification_failed",
            actor: failed_user,
            subject_type: "User",
            subject_id: failed_user&.id || 0,
            subject_name: failed_user&.full_name || "Unknown employee",
            event_category: "security",
            actor_kind: failed_user ? "user" : "system",
            source: "kiosk",
            outcome: "failed",
            metadata: { reason: e.message, account_locked: failed_user&.kiosk_locked? }
          )
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/clock_in
        def clock_in
          result = AireKioskService.clock_in(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s,
            time_category_id: params[:time_category_id]
          )

          render json: serialize_action_response(result), status: :created
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/clock_out
        def clock_out
          result = AireKioskService.clock_out(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s
          )
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/start_break
        def start_break
          result = AireKioskService.start_break(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s
          )
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/end_break
        def end_break
          result = AireKioskService.end_break(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s
          )
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message }, status: :unprocessable_entity
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
          render json: { error: e.message }, status: :unprocessable_entity
        end

        private

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
