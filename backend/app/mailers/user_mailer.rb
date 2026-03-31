# frozen_string_literal: true

class UserMailer < ApplicationMailer
  def invitation_email(user:, invited_by:)
    @user = user
    @invited_by = invited_by
    @sign_up_url = ENV.fetch("FRONTEND_URL", "http://localhost:5173")

    from_email = ENV.fetch("MAILER_FROM_EMAIL", "noreply@example.com")

    Resend::Emails.send({
      from: from_email,
      to: @user.email,
      subject: "You've been invited to AIRE Services",
      html: invitation_html
    })
  end

  private

  def invitation_html
    <<~HTML
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to AIRE Services</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0f4f8;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #1e3a5f; border-radius: 12px 12px 0 0; padding: 30px;">
                <tr>
                  <td align="center">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">AIRE SERVICES</h1>
                    <p style="color: #94b8d6; margin: 5px 0 0 0; font-size: 12px; letter-spacing: 1px;">GUAM</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; padding: 40px 30px;">
                <tr>
                  <td>
                    <h2 style="color: #1e3a5f; margin: 0 0 20px 0; font-size: 22px;">You're Invited!</h2>

                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      #{@invited_by&.email || "An administrator"} has invited you to join the AIRE Services team.
                    </p>

                    <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                      You've been granted <strong>#{@user.role}</strong> access. Click the button below to create your account and get started.
                    </p>

                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 30px auto;">
                      <tr>
                        <td style="background-color: #1e3a5f; border-radius: 8px;">
                          <a href="#{@sign_up_url}" target="_blank" style="display: inline-block; padding: 16px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                            Create Your Account
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="color: #888888; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
                      Or copy and paste this link into your browser:
                    </p>
                    <p style="color: #1e3a5f; font-size: 14px; word-break: break-all; margin: 0 0 30px 0;">
                      #{@sign_up_url}
                    </p>

                    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">

                    <p style="color: #888888; font-size: 14px; line-height: 1.6; margin: 0;">
                      <strong>Important:</strong> Make sure to sign up using this email address (<strong>#{@user.email}</strong>) to gain access.
                    </p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f0f4f8; border-radius: 0 0 12px 12px; padding: 20px 30px;">
                <tr>
                  <td align="center">
                    <p style="color: #888888; font-size: 12px; margin: 0;">
                      AIRE Services<br>
                      Guam
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
