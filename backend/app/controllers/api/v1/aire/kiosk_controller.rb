# frozen_string_literal: true

module Api
  module V1
    module Aire
      class KioskController < BaseController
        # POST /api/v1/aire/kiosk/verify
        def verify
          result = AireKioskService.verify_pin(pin: params[:pin].to_s)

          render json: {
            employee: serialize_user(result[:user]),
            kiosk_token: result[:kiosk_token],
            current_status: serialize_status(result[:current_status]),
            available_categories: serialize_categories_for(result[:user], result[:available_categories])
          }
        rescue AireKioskService::KioskError => e
          failed_user = User.find_kiosk_user_by_pin(params[:pin].to_s)
          failed_user&.register_kiosk_failure! if failed_user&.staff? && !failed_user.kiosk_locked?
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/clock_in
        def clock_in
          result = AireKioskService.clock_in(
            kiosk_token: params[:kiosk_token].to_s,
            time_category_id: params[:time_category_id]
          )

          render json: serialize_action_response(result), status: :created
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/clock_out
        def clock_out
          result = AireKioskService.clock_out(kiosk_token: params[:kiosk_token].to_s)
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/start_break
        def start_break
          result = AireKioskService.start_break(kiosk_token: params[:kiosk_token].to_s)
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/end_break
        def end_break
          result = AireKioskService.end_break(kiosk_token: params[:kiosk_token].to_s)
          render json: serialize_action_response(result)
        rescue AireKioskService::KioskError, TimeClockService::ClockError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # POST /api/v1/aire/kiosk/switch_category
        def switch_category
          result = AireKioskService.switch_category(
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

        def serialize_categories_for(user, categories)
          utc_lookup = user.user_time_categories.index_by(&:time_category_id)
          categories.map do |category|
            utc = utc_lookup[category.id]
            effective_cents = utc&.effective_hourly_rate_cents || category.hourly_rate_cents
            {
              id: category.id,
              key: category.key,
              name: category.name,
              description: category.description,
              hourly_rate_cents: effective_cents,
              hourly_rate: effective_cents ? (effective_cents.to_f / 100).round(2) : nil
            }
          end
        end

        def serialize_status(status)
          status.merge(
            schedule: status[:schedule],
            breaks: status[:breaks],
            time_category: active_time_category_from_status(status),
            clock_source: active_clock_source_from_status(status)
          )
        end

        def active_time_category_from_status(status)
          return nil unless status[:entry_id]

          entry = TimeEntry.includes(:time_category).find_by(id: status[:entry_id])
          return nil unless entry&.time_category

          {
            id: entry.time_category.id,
            key: entry.time_category.key,
            name: entry.time_category.name,
            hourly_rate_cents: entry.time_category.hourly_rate_cents,
            hourly_rate: entry.time_category.hourly_rate
          }
        end

        def active_clock_source_from_status(status)
          return nil unless status[:entry_id]

          TimeEntry.find_by(id: status[:entry_id])&.clock_source
        end

        def serialize_entry(entry)
          {
            id: entry.id,
            work_date: entry.work_date.iso8601,
            status: entry.status,
            clock_source: entry.clock_source,
            clock_in_at: entry.clock_in_at&.iso8601,
            clock_out_at: entry.clock_out_at&.iso8601,
            break_minutes: entry.break_minutes,
            hours: entry.hours.to_f,
            time_category: entry.time_category ? {
              id: entry.time_category.id,
              key: entry.time_category.key,
              name: entry.time_category.name,
              hourly_rate_cents: entry.time_category.hourly_rate_cents,
              hourly_rate: entry.time_category.hourly_rate
            } : nil
          }
        end
      end
    end
  end
end
