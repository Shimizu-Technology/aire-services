# frozen_string_literal: true

require "rails_helper"
require "stringio"

RSpec.describe "AIRE staging mail responses", type: :request do
  around do |example|
    old_env = ENV.to_h
    ENV["DEPLOYMENT_ENV"] = "staging"
    ENV.delete("STAGING_MAIL_ALLOWLIST")
    ENV.delete("RESEND_API_KEY")
    @output = StringIO.new
    old_logger = Rails.logger
    Rails.logger = ActiveSupport::Logger.new(@output)
    example.run
  ensure
    Rails.logger = old_logger
    ENV.replace(old_env)
  end

  let(:admin) { create(:user, :admin, clerk_id: "user_admin") }
  let(:invitee) { create(:user, clerk_id: "pending_invitee", email: "PRIVATE_RECIPIENT@example.test") }

  before do
    ENV["STAGING_TESTER_BINDINGS"] = [ { user_id: admin.id, email: admin.email, clerk_subject: admin.clerk_id } ].to_json
    allow_any_instance_of(Api::V1::Admin::UsersController).to receive(:current_user).and_return(admin)
  end

  it "reports a captured resend without claiming a send or logging the address" do
    expect(Resend::Emails).not_to receive(:send)
    post "/api/v1/admin/users/#{invitee.id}/resend_invite", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("invitation_email_sent" => false, "invitation_email_captured" => true)
    expect(response.parsed_body["message"]).to include("captured", "no email was sent")
    expect(@output.string).not_to include(invitee.email)
  end

  it "reports contact capture explicitly" do
    expect(Resend::Emails).not_to receive(:send)
    post "/api/v1/contact", params: { name: "Synthetic", email: "sender@example.test", subject: "Test", message: "Test" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("captured" => true, "sent" => false)
    expect(response.parsed_body["message"]).to include("captured", "no email was sent")
  end

  it "logs contact failures without exception content" do
    allow(StagingMailTransport).to receive(:deliver).and_raise(RuntimeError, "PRIVATE_ERROR")
    post "/api/v1/contact", params: { name: "Synthetic", email: "sender@example.test", subject: "Test", message: "Test" }
    expect(response).to have_http_status(:internal_server_error)
    expect(@output.string).to include("RuntimeError")
    expect(@output.string).not_to include("PRIVATE_ERROR")
  end

  %w[production test].each do |deployment|
    it "preserves the ordinary contact mailer path and response in #{deployment}" do
      ENV["DEPLOYMENT_ENV"] = deployment
      expect(ContactMailer).not_to receive(:deliver_contact_form)
      expect(Resend::Emails).to receive(:send).with(hash_including(subject: "AIRE Website Inquiry: Test", html: a_string_including("Synthetic"))).and_return({ "id" => "synthetic" })
      post "/api/v1/contact", params: { name: "Synthetic", email: "sender@example.test", subject: "Test", message: "Test" }
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("success" => true, "message" => "Your message has been sent successfully!")
    end
  end
end
