# frozen_string_literal: true

module Api
  module V1
    class PayrollIngestController < ApplicationController
      include SharedSecretAuthenticatable

      before_action :authenticate_shared_secret!

      # POST /api/v1/payroll/ingest
      #
      # Idempotent endpoint: re-posting with the same idempotency_key returns
      # the existing batch without modification.
      def create
        normalized = normalized_ingest
        existing = PayrollImportBatch.find_by(idempotency_key: normalized[:idempotency_key])

        if existing
          render json: { payroll_import_batch: serialize(existing), replayed: true }, status: :ok
          return
        end

        batch = PayrollImportBatch.new(
          idempotency_key: normalized[:idempotency_key],
          source_payroll_run_id: normalized[:source_payroll_run_id],
          payload: normalized[:payload],
          total_gross: normalized[:total_gross],
          total_net: normalized[:total_net],
          total_tax: normalized[:total_tax],
          employee_count: normalized[:employee_count],
          status: "pending"
        )

        unless batch.valid?
          render json: { error: "Validation failed", errors: batch.errors.full_messages }, status: :unprocessable_entity
          return
        end

        reconcile(batch)

        begin
          batch.save!
          render json: { payroll_import_batch: serialize(batch), replayed: false }, status: :created
        rescue ActiveRecord::RecordNotUnique
          existing = PayrollImportBatch.find_by!(idempotency_key: normalized[:idempotency_key])
          render json: { payroll_import_batch: serialize(existing), replayed: true }, status: :ok
        end
      end

      private

      def ingest_params
        # Backward compatible: support nested { payroll_import: ... }
        # and flat CPR payload shape.
        if params[:payroll_import].present?
          params.require(:payroll_import).permit(
            :idempotency_key,
            :source_payroll_run_id,
            :total_gross,
            :total_net,
            :total_tax,
            :employee_count,
            payload: {}
          )
        else
          params.permit(
            :idempotency_key,
            :source,
            :version,
            :submitted_at,
            pay_period: {},
            company: {},
            totals: {},
            line_items: [
              :payroll_item_id,
              :employee_id,
              :employee_name,
              :employment_type,
              :gross_pay,
              :net_pay,
              :withholding_tax,
              :social_security_tax,
              :medicare_tax,
              :additional_withholding,
              :employer_social_security_tax,
              :employer_medicare_tax,
              :retirement_payment,
              :roth_retirement_payment,
              :ytd_gross,
              :ytd_social_security_tax,
              :ytd_medicare_tax,
              :ytd_withholding_tax
            ]
          )
        end
      end

      def normalized_ingest
        ip = ingest_params.to_h.deep_symbolize_keys
        if params[:payroll_import].present?
          return {
            idempotency_key: ip[:idempotency_key],
            source_payroll_run_id: ip[:source_payroll_run_id],
            payload: (ip[:payload] || {}),
            total_gross: ip[:total_gross],
            total_net: ip[:total_net],
            total_tax: ip[:total_tax],
            employee_count: ip[:employee_count]
          }
        end

        totals = ip[:totals] || {}
        {
          idempotency_key: ip[:idempotency_key],
          source_payroll_run_id: (ip.dig(:pay_period, :id) || ip[:idempotency_key]).to_s,
          payload: { line_items: (ip[:line_items] || []), pay_period: ip[:pay_period] || {}, company: ip[:company] || {}, source: ip[:source], version: ip[:version], submitted_at: ip[:submitted_at] },
          total_gross: totals[:gross_pay] || totals[:total_gross],
          total_net: totals[:net_pay] || totals[:total_net],
          total_tax: totals[:total_tax_liability] || totals[:total_tax],
          employee_count: totals[:employee_count]
        }
      end

      def reconcile(batch)
        provided_totals = {
          total_gross: batch.total_gross,
          total_net: batch.total_net,
          total_tax: batch.total_tax,
          employee_count: batch.employee_count
        }.compact

        if provided_totals.empty?
          batch.status = "reconciled"
          batch.reconciliation_details = { skipped: true, reason: "No totals provided" }
          return
        end

        result = PayrollReconciliationService.new(
          payload: batch.payload,
          provided_totals: provided_totals
        ).call

        if result.match?
          batch.status = "reconciled"
        else
          batch.status = "failed"
          batch.error_message = "Reconciliation mismatch"
        end
        batch.reconciliation_details = result.details
      end

      def serialize(batch)
        {
          id: batch.id,
          idempotency_key: batch.idempotency_key,
          source_payroll_run_id: batch.source_payroll_run_id,
          status: batch.status,
          total_gross: batch.total_gross&.to_f,
          total_net: batch.total_net&.to_f,
          total_tax: batch.total_tax&.to_f,
          employee_count: batch.employee_count,
          error_message: batch.error_message,
          reconciliation_details: batch.reconciliation_details,
          created_at: batch.created_at,
          updated_at: batch.updated_at
        }
      end
    end
  end
end
