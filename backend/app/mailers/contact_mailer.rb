# frozen_string_literal: true

require "cgi"

class ContactMailer < ApplicationMailer
  def contact_form_email(name:, email:, phone:, subject:, message:)
    @name = CGI.escapeHTML(name.to_s)
    @email = CGI.escapeHTML(email.to_s)
    @phone = CGI.escapeHTML(phone.to_s)
    @subject_line = CGI.escapeHTML(subject.to_s)
    @message = CGI.escapeHTML(message.to_s)

    from_email = ENV.fetch("MAILER_FROM_EMAIL", "noreply@example.com")
    to_email = Setting.get("contact_email") || "admin@aireservicesguam.com"

    safe_reply_to = email.to_s.delete("\r\n")
    safe_subject = subject.to_s.delete("\r\n")

    Rails.logger.info "📧 Sending AIRE contact form email to: #{to_email}"

    Resend::Emails.send({
      from: from_email,
      to: to_email,
      reply_to: safe_reply_to,
      subject: "AIRE Website Inquiry: #{safe_subject}",
      html: contact_form_html
    })
  end

  private

  def contact_form_html
    <<~HTML
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New AIRE Website Inquiry</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f8fafc;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 640px; margin: 0 auto; padding: 32px 20px;">
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #020617 0%, #0f172a 100%); border-radius: 16px 16px 0 0; padding: 28px 30px;">
                <tr>
                  <td>
                    <p style="margin: 0; color: #67e8f9; font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;">AIRE Services Guam</p>
                    <h1 style="margin: 10px 0 0 0; color: #ffffff; font-size: 26px; font-weight: 700;">New Website Inquiry</h1>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; padding: 32px 30px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 24px 0; color: #475569; font-size: 15px; line-height: 1.6;">
                      A new inquiry was submitted through the AIRE Services website contact form.
                    </p>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                      #{field_row('Name', @name)}
                      #{field_row('Email', %(<a href="mailto:#{@email}" style="color: #0f766e; text-decoration: none;">#{@email}</a>))}
                      #{phone_row}
                      #{field_row('Subject', @subject_line)}
                    </table>

                    <div style="margin-top: 26px; border-radius: 14px; background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 22px;">
                      <p style="margin: 0 0 10px 0; color: #64748b; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Message</p>
                      <p style="margin: 0; color: #0f172a; font-size: 15px; line-height: 1.7; white-space: pre-wrap;">#{@message}</p>
                    </div>

                    <div style="margin-top: 28px;">
                      <a href="mailto:#{@email}?subject=Re: #{@subject_line}" style="display: inline-block; border-radius: 10px; background-color: #22d3ee; padding: 14px 22px; color: #082f49; font-size: 14px; font-weight: 700; text-decoration: none;">
                        Reply to #{@name}
                      </a>
                    </div>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #e2e8f0; border-radius: 0 0 16px 16px; padding: 18px 30px;">
                <tr>
                  <td align="center">
                    <p style="margin: 0; color: #64748b; font-size: 12px;">
                      Sent from the AIRE Services Guam website contact form.
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

  def field_row(label, value)
    <<~HTML
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
          <p style="margin: 0; color: #64748b; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">#{label}</p>
          <p style="margin: 6px 0 0 0; color: #0f172a; font-size: 15px;">#{value}</p>
        </td>
      </tr>
    HTML
  end

  def phone_row
    return "" if @phone.blank?

    field_row('Phone', %(<a href="tel:#{@phone}" style="color: #0f766e; text-decoration: none;">#{@phone}</a>))
  end
end
