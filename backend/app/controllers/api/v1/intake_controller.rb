# frozen_string_literal: true

module Api
  module V1
    class IntakeController < BaseController
      # Intake form is public - no authentication required
      skip_before_action :verify_authenticity_token, raise: false

      # POST /api/v1/intake
      # Accepts client intake form data and creates client, dependents, tax return, and income sources
      def create
        result = CreateIntakeService.call(intake_params)

        if result.success?
          render json: {
            message: "Intake form submitted successfully",
            client: client_response(result.client),
            tax_return: tax_return_response(result.tax_return)
          }, status: :created
        else
          render json: {
            error: "Failed to process intake form",
            errors: result.errors
          }, status: :unprocessable_entity
        end
      end

      private

      def intake_params
        params.require(:intake).permit(
          # Client info
          :first_name, :last_name, :date_of_birth, :email, :phone, :mailing_address,
          # Filing info
          :filing_status, :is_new_client, :has_prior_year_return, :changes_from_prior_year,
          # Spouse info
          :spouse_name, :spouse_dob,
          # Special questions
          :denied_eic_actc, :denied_eic_actc_year, :has_crypto_transactions,
          # Bank info
          :wants_direct_deposit, :bank_routing_number, :bank_account_number, :bank_account_type,
          # Authorization
          :signature, :signature_date,
          # Tax return info
          :tax_year,
          # Nested arrays
          dependents: [:name, :date_of_birth, :relationship, :months_lived_with_client,
                       :is_student, :is_disabled, :can_be_claimed_by_other],
          income_sources: [:source_type, :payer_name, :notes]
        )
      end

      def client_response(client)
        {
          id: client.id,
          full_name: client.full_name,
          email: client.email
        }
      end

      def tax_return_response(tax_return)
        {
          id: tax_return.id,
          tax_year: tax_return.tax_year,
          status: tax_return.status_name
        }
      end
    end
  end
end
