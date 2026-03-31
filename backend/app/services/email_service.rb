# frozen_string_literal: true

require "cgi"

class EmailService
  class << self
    def send_invitation_email(user:, invited_by:)
      return false unless resend_configured?

      sign_up_url = ENV.fetch("FRONTEND_URL", "http://localhost:5173")
      from_email = ENV.fetch("MAILER_FROM_EMAIL", "noreply@example.com")

      template = user.client? ? :portal_invitation : :staff_invitation

      response = Resend::Emails.send({
        from: from_email,
        to: user.email,
        subject: user.client? ? "Access Your Tax Return Portal — Cornerstone Accounting" : "You've been invited to Cornerstone Accounting",
        html: template == :portal_invitation ? portal_invitation_html(user: user, sign_up_url: sign_up_url) : invitation_html(user: user, invited_by: invited_by, sign_up_url: sign_up_url)
      })

      Rails.logger.info "Resend API response for #{CGI.escapeHTML(user.email.to_s)}: #{response.inspect}"
      true
    rescue StandardError => e
      Rails.logger.error "Failed to send invitation email to #{CGI.escapeHTML(user.email.to_s)}: #{e.class} - #{e.message}"
      Rails.logger.error e.backtrace.first(5).join("\n") if e.backtrace
      false
    end

    private

    def resend_configured?
      if ENV["RESEND_API_KEY"].blank?
        Rails.logger.warn "RESEND_API_KEY not configured, skipping email"
        return false
      end
      true
    end

    def invitation_html(user:, invited_by:, sign_up_url:)
      <<~HTML
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to Cornerstone</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f3ef;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <tr>
              <td>
                <!-- Header -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #2d2a26; border-radius: 12px 12px 0 0; padding: 30px;">
                  <tr>
                    <td align="center">
                      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">CORNERSTONE</h1>
                      <p style="color: #d4c4b0; margin: 5px 0 0 0; font-size: 12px; letter-spacing: 1px;">ACCOUNTING & BUSINESS MANAGEMENT</p>
                    </td>
                  </tr>
                </table>

                <!-- Content -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; padding: 40px 30px;">
                  <tr>
                    <td>
                      <h2 style="color: #2d2a26; margin: 0 0 20px 0; font-size: 22px;">You're Invited!</h2>
                      
                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        #{CGI.escapeHTML((invited_by&.email || "An administrator").to_s)} has invited you to join the Cornerstone Accounting team portal.
                      </p>

                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                        You've been granted <strong>#{CGI.escapeHTML(user.role.to_s)}</strong> access. Click the button below to create your account and get started.
                      </p>

                      <!-- CTA Button -->
                      <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 30px auto;">
                        <tr>
                          <td style="background-color: #8b7355; border-radius: 8px;">
                            <a href="#{CGI.escapeHTML(sign_up_url.to_s)}" target="_blank" style="display: inline-block; padding: 16px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                              Create Your Account
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="color: #888888; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
                        Or copy and paste this link into your browser:
                      </p>
                      <p style="color: #8b7355; font-size: 14px; word-break: break-all; margin: 0 0 30px 0;">
                        #{CGI.escapeHTML(sign_up_url.to_s)}
                      </p>

                      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">

                      <p style="color: #888888; font-size: 14px; line-height: 1.6; margin: 0;">
                        <strong>Important:</strong> Make sure to sign up using this email address (<strong>#{CGI.escapeHTML(user.email.to_s)}</strong>) to gain access.
                      </p>
                    </td>
                  </tr>
                </table>

                <!-- Footer -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f3ef; border-radius: 0 0 12px 12px; padding: 20px 30px;">
                  <tr>
                    <td align="center">
                      <p style="color: #888888; font-size: 12px; margin: 0;">
                        Cornerstone Accounting & Business Services<br>
                        Hagatna, Guam
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      HTML
    end

    def portal_invitation_html(user:, sign_up_url:)
      portal_url = "#{sign_up_url}/portal"
      <<~HTML
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your Client Portal Access</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f3ef;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <tr>
              <td>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #2d2a26; border-radius: 12px 12px 0 0; padding: 30px;">
                  <tr>
                    <td align="center">
                      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">CORNERSTONE</h1>
                      <p style="color: #d4c4b0; margin: 5px 0 0 0; font-size: 12px; letter-spacing: 1px;">ACCOUNTING & BUSINESS MANAGEMENT</p>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; padding: 40px 30px;">
                  <tr>
                    <td>
                      <h2 style="color: #2d2a26; margin: 0 0 20px 0; font-size: 22px;">Your Client Portal is Ready</h2>

                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Cornerstone Accounting has set up a client portal for you. Once you create your account, you'll be able to:
                      </p>

                      <ul style="color: #555555; font-size: 16px; line-height: 1.8; margin: 0 0 25px 0; padding-left: 20px;">
                        <li>Track the status of your tax return</li>
                        <li>Upload documents securely</li>
                        <li>See what actions are needed</li>
                      </ul>

                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 20px 0; background-color: #fff8f0; border-radius: 8px; border-left: 4px solid #d97706; padding: 16px 20px;">
                        <tr>
                          <td>
                            <p style="color: #92400e; font-size: 14px; font-weight: 600; margin: 0 0 4px 0;">Important: Use this email address to sign up</p>
                            <p style="color: #92400e; font-size: 14px; margin: 0;">You must create your account using <strong>#{CGI.escapeHTML(user.email.to_s)}</strong> or you won't be able to access your portal.</p>
                          </td>
                        </tr>
                      </table>

                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                        Click the button below to create your account and access your portal:
                      </p>

                      <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 30px auto;">
                        <tr>
                          <td style="background-color: #8b7355; border-radius: 8px;">
                            <a href="#{CGI.escapeHTML(portal_url.to_s)}" target="_blank" style="display: inline-block; padding: 16px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                              Create Account &amp; Access Portal
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="color: #888888; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
                        Or copy and paste this link into your browser:
                      </p>
                      <p style="color: #8b7355; font-size: 14px; word-break: break-all; margin: 0 0 30px 0;">
                        #{CGI.escapeHTML(portal_url.to_s)}
                      </p>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f3ef; border-radius: 0 0 12px 12px; padding: 20px 30px;">
                  <tr>
                    <td align="center">
                      <p style="color: #888888; font-size: 12px; margin: 0;">
                        Cornerstone Accounting & Business Services<br>
                        Hagatna, Guam
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      HTML
    end
  end
end
