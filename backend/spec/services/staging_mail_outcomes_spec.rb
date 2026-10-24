# frozen_string_literal: true

require "rails_helper"
require "stringio"

RSpec.describe "AIRE staging mail outcomes" do
  around do |example|
    old_env = ENV.to_h
    ENV["DEPLOYMENT_ENV"] = "staging"
    ENV["STAGING_TESTER_BINDINGS"] = '[{"user_id":1,"email":"leon@example.test","clerk_subject":"user_leon"}]'
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

  let(:user) { create(:user, email: "PRIVATE_RECIPIENT@example.test") }

  it "returns a distinct capture outcome for invitations" do
    expect(Resend::Emails).not_to receive(:send)
    expect(EmailService.send_invitation_email(user: user, invited_by: nil)).to eq(:captured)
    expect(@output.string).to include("captured", "user_id=#{user.id}")
    expect(@output.string).not_to include(user.email, "email sent")
  end

  it "logs invitation failures with IDs and class without message, email or backtrace" do
    error = RuntimeError.new("PRIVATE_ERROR #{user.email}")
    error.set_backtrace([ "PRIVATE_TRACE" ])
    allow(StagingMailTransport).to receive(:deliver).and_raise(error)
    expect(EmailService.send_invitation_email(user: user, invited_by: nil)).to be(false)
    expect(@output.string).to include("RuntimeError", "user_id=#{user.id}")
    expect(@output.string).not_to include("PRIVATE_ERROR", user.email, "PRIVATE_TRACE")
  end

  %w[production test].each do |deployment|
    it "preserves invitation send outcomes in #{deployment}" do
      ENV["DEPLOYMENT_ENV"] = deployment
      ENV["RESEND_API_KEY"] = "synthetic"
      expect(Resend::Emails).to receive(:send).with(hash_including(to: user.email, html: a_string_including("You're Invited!"))).and_return({ "id" => "synthetic" })
      expect(EmailService.send_invitation_email(user: user, invited_by: nil)).to be(true)
    end
  end
end
