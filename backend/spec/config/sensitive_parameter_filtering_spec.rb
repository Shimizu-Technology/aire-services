# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Sensitive parameter filtering" do
  subject(:filter) { ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters) }

  it "redacts kiosk credentials, authorization data, and bank details" do
    filtered = filter.filter(
      "kiosk_pin" => "4826",
      "Authorization" => "Bearer raw-token",
      "session_id" => "session-secret",
      "bank_account_number" => "123456789",
      "bank_routing_number" => "021000021",
      "display_name" => "Ari Worker"
    )

    expect(filtered).to include(
      "kiosk_pin" => "[FILTERED]",
      "Authorization" => "[FILTERED]",
      "session_id" => "[FILTERED]",
      "bank_account_number" => "[FILTERED]",
      "bank_routing_number" => "[FILTERED]",
      "display_name" => "Ari Worker"
    )
  end
end
