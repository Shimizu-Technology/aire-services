# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class ManualReviewsController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "settlement_case_management"

          before_action :authenticate_payroll_actor!, only: :show

          def show
            review = ::Payroll::BatchBuilder.new(
              start_date: params[:start_date],
              end_date: params[:end_date],
              cutoff_at: Time.current,
              batch_reference: "MANUAL-REVIEW"
            ).call.fetch(:payload)

            payload = review.slice(
              :start_date,
              :end_date,
              :generated_at,
              :employees,
              :exclusions,
              :issues,
              :summary
            )
            allocations = PayrollManualAllocation
              .includes(:user)
              .where(work_date: Date.iso8601(params[:start_date])..Date.iso8601(params[:end_date]))
            if params[:external_pay_period_id].present?
              allocations = allocations.or(
                PayrollManualAllocation.includes(:user).where(external_pay_period_id: params[:external_pay_period_id].to_s)
              )
            end
            payload[:manual_allocations] = allocations.order(:work_date, :id).map do |allocation|
              {
                id: allocation.id.to_s,
                source_time_entry_id: allocation.time_entry_id.to_s,
                source_user_uuid: allocation.source_user_uuid,
                display_name: allocation.user.full_name,
                original_work_date: allocation.work_date.iso8601,
                regular_hours: allocation.regular_hours.to_f,
                overtime_hours: allocation.overtime_hours.to_f,
                status: allocation.status,
                external_pay_period_id: allocation.external_pay_period_id,
                external_payroll_item_id: allocation.external_payroll_item_id,
                payment_reference: allocation.payment_reference,
                payment_effective_on: allocation.payment_effective_on&.iso8601
              }.compact
            end

            attestations = PayrollPaymentAttestation.pending_evidence
              .includes(:user, :time_entry)
              .where(work_date: Date.iso8601(params[:start_date])..Date.iso8601(params[:end_date]))
              .order(:work_date, :id)
            payload[:payment_attestations] = attestations.map do |attestation|
              {
                id: attestation.id.to_s,
                source_time_entry_id: attestation.time_entry_id.to_s,
                source_user_uuid: attestation.source_user_uuid,
                display_name: attestation.user.full_name,
                original_work_date: attestation.work_date.iso8601,
                hours: attestation.hours.to_f,
                status: attestation.status,
                attested_at: attestation.attested_at.iso8601,
                source_changed: attestation.source_changed?,
                evidence_needed: "Match the actual Cornerstone payroll item, check number, amount, and delivery date before marking paid"
              }
            end

            render json: payload
          rescue ArgumentError => e
            render json: { error: e.message }, status: :unprocessable_entity
          end
        end
      end
    end
  end
end
