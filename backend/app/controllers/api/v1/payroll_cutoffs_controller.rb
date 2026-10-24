# frozen_string_literal: true

module Api
  module V1
    class PayrollCutoffsController < BaseController
      before_action :authenticate_user!, :require_staff!, only: [ :show, :acknowledge ]
      before_action :authenticate_kiosk!, only: [ :kiosk, :kiosk_acknowledge ]
      before_action :prevent_caching

      def show
        render_cutoff(current_user)
      end

      def kiosk
        render_cutoff(@kiosk_user)
      end

      def acknowledge
        save_acknowledgement(current_user)
      end

      def kiosk_acknowledge
        return render json: { error: "Employee PIN session required" }, status: :unauthorized unless @kiosk_user

        save_acknowledgement(@kiosk_user)
      end

      private

      def prevent_caching
        response.headers["Cache-Control"] = "no-store"
      end

      def authenticate_kiosk!
        unless AireKioskAccessToken.admin_from_token(params[:kiosk_access_token].to_s)
          return render json: { error: "Kiosk access session required" }, status: :unauthorized
        end
        return if params[:kiosk_token].blank?

        @kiosk_user = AireKioskToken.user_from_token(params[:kiosk_token].to_s)
        unless @kiosk_user&.kiosk_access_enabled?
          render json: { error: "Employee kiosk session expired" }, status: :unauthorized
        end
      end

      def render_cutoff(user)
        cutoff = ::Payroll::CutoffPresenter.call
        payload = { cutoff: cutoff }
        payload[:acknowledged] = PayrollCutoffAcknowledgement.exists?(PayrollCutoffAcknowledgement.identity(user, cutoff)) if user
        render json: payload
      end

      def save_acknowledgement(user)
        period = ::Payroll::CutoffPresenter.period(now: Time.current)
        return stale_publication unless period

        period.with_lock do
          cutoff = ::Payroll::CutoffPresenter.call(period: period)
          matches = params[:period_id].to_s == period.id.to_s && params[:publication_id] == cutoff[:publication_id] &&
                    params[:version].to_s == cutoff[:version].to_s && params[:stage] == cutoff[:stage] && %w[24h 4h].include?(cutoff[:stage])
          return stale_publication unless matches

          PayrollCutoffAcknowledgement.create_or_find_by!(PayrollCutoffAcknowledgement.identity(user, cutoff))
        end
        render json: { acknowledged: true }
      end

      def stale_publication
        render json: { error: "The published cutoff has changed. Refresh the notice." }, status: :conflict
      end
    end
  end
end
