# frozen_string_literal: true

module Api
  module V1
    class PayrollCutoffsController < BaseController
      before_action :authenticate_user!, :require_staff!, only: [ :show, :acknowledge ]
      before_action :authenticate_kiosk!, only: [ :kiosk, :kiosk_acknowledge ]
      before_action -> { require_capability!(:manage_payroll) }, only: :change_lock_time
      before_action :prevent_caching

      def show
        render_cutoff(current_user, include_attention: current_user.can_manage_payroll?, include_next_lock: true)
      end

      def kiosk
        render_cutoff(@kiosk_user)
      end

      def acknowledge
        save_acknowledgement(current_user)
      end

      # Owners and admins ask Cornerstone Payroll to lock now, move, or reset the
      # next lock. AIRE applies the result when Cornerstone republishes it.
      def change_lock_time
        return render json: { error: ConnectedPayrollMode::MESSAGE }, status: :service_unavailable unless ConnectedPayrollMode.enabled?

        period = PayrollCalendarPeriod.find_by!(external_pay_period_id: params.require(:external_pay_period_id).to_s)
        request_id = params[:request_id].to_s.downcase
        request_id = SecureRandom.uuid unless request_id.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/)
        change = ::Payroll::LockControl.new(period: period).request!(
          user: current_user,
          action: params[:lock_action].to_s,
          cutoff_at: params[:cutoff_at],
          reason: params[:reason],
          publication_id: params[:publication_id],
          request_id: request_id
        )
        render json: { cutoff_change: change, lock_control: ::Payroll::LockControl.state(period: period.reload) }
      rescue ::Payroll::LockControl::Error => e
        render json: { error: e.message }, status: :unprocessable_entity
      rescue ::Payroll::CutoffChangeClient::Rejected => e
        render json: { error: e.message }, status: e.status == 409 ? :conflict : :unprocessable_entity
      rescue ::Payroll::CutoffChangeClient::Unavailable
        render json: { error: "Cornerstone Payroll could not be reached. Nothing changed; try again in a minute." }, status: :bad_gateway
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

      def render_cutoff(user, include_attention: false, include_next_lock: false)
        cutoff = ::Payroll::CutoffPresenter.call
        payload = { cutoff: cutoff, connected_payroll: ConnectedPayrollMode.capability }
        payload[:next_lock] = ::Payroll::CutoffPresenter.next_lock if include_next_lock
        payload[:acknowledged] = PayrollCutoffAcknowledgement.exists?(PayrollCutoffAcknowledgement.identity(user, cutoff)) if user
        if include_attention
          payload[:attention] = ::Payroll::CutoffPresenter.attention
          payload[:preparation_period] = ::Payroll::CutoffPresenter.preparation_period
          payload[:lock_control] = ::Payroll::LockControl.state
        end
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
