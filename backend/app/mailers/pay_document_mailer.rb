# frozen_string_literal: true

require "cgi"

# Pay stub emails. They carry a link and nothing else about pay: no amounts,
# pay dates, hours, SSNs or bank details. Like the other AIRE mailers they go
# through StagingMailTransport, so staging captures or filters them.
class PayDocumentMailer < ApplicationMailer
  class << self
    def deliver_link(delivery:, token:)
      new.link_email(delivery: delivery, token: token)
    end

    def deliver_request_notice(request:, recipients:)
      new.request_notice_email(request: request, recipients: recipients)
    end

    def deliver_typed_request_alert(request:, to:)
      new.typed_request_alert_email(request: request, to: to)
    end
  end

  def link_email(delivery:, token:)
    @delivery = delivery
    @url = PayDocuments.link_url(token)
    count = delivery.pay_document_items.size
    StagingMailTransport.deliver(
      {
        from: ENV.fetch("MAILER_FROM_EMAIL", "noreply@example.com"),
        to: [ delivery.recipient_email ],
        subject: count == 1 ? "Your AIRE pay stub is ready to download" : "Your AIRE pay stubs are ready to download",
        html: link_html(count),
        text: link_text(count)
      },
      options: { idempotency_key: "pay-document-link-#{delivery.id}" }
    )
  end

  def request_notice_email(request:, recipients:)
    @request = request
    StagingMailTransport.deliver(
      {
        from: ENV.fetch("MAILER_FROM_EMAIL", "noreply@example.com"),
        to: recipients,
        subject: "New pay stub request in AIRE",
        html: notice_html,
        text: notice_text
      },
      options: { idempotency_key: "pay-document-request-#{request.id}" }
    )
  end

  # Sent to the worker's address on file when a kiosk request names another
  # address, so a coworker who used their PIN can't do it unnoticed.
  def typed_request_alert_email(request:, to:)
    @request = request
    StagingMailTransport.deliver(
      {
        from: ENV.fetch("MAILER_FROM_EMAIL", "noreply@example.com"),
        to: [ to ],
        subject: "A pay stub request was made for you at the AIRE kiosk",
        html: alert_html,
        text: alert_text
      },
      options: { idempotency_key: "pay-document-request-alert-#{request.id}" }
    )
  end

  private

  def alert_lines
    [
      "A pay stub request was made at the kiosk to be sent to another address.",
      "If this wasn't you, tell the office."
    ]
  end

  def alert_html
    <<~HTML
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Pay stub request at the kiosk</title></head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f0f4f8;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; margin: 0 auto; padding: 32px 20px;">
          <tr><td style="background-color: #1e3a5f; border-radius: 12px 12px 0 0; padding: 24px 28px;">
            <p style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 600;">#{h(PayDocuments::EMPLOYER_NAME)}</p>
          </td></tr>
          <tr><td style="background-color: #ffffff; padding: 28px;">
            <p style="margin: 0 0 16px 0; color: #1e293b; font-size: 16px;">Hi #{h(@request.user.display_name)},</p>
            <p style="margin: 0 0 16px 0; color: #334155; font-size: 16px; line-height: 1.6;">#{h(alert_lines.first)}</p>
            <p style="margin: 0; color: #334155; font-size: 16px; line-height: 1.6; font-weight: 600;">#{h(alert_lines.last)}</p>
          </td></tr>
        </table>
      </body>
      </html>
    HTML
  end

  def alert_text
    <<~TEXT
      Hi #{@request.user.display_name},

      #{alert_lines.join("\n\n")}
    TEXT
  end

  def link_intro(count)
    what = count == 1 ? "your pay stub" : "#{count} of your pay stubs"
    if @delivery.origin == "self"
      "Here is the secure link you asked for in My Pay to download #{what}."
    else
      "#{@delivery.sent_by.display_name} at #{PayDocuments::EMPLOYER_NAME} sent you a secure link to download #{what}."
    end
  end

  def expires_on
    @delivery.expires_at.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).strftime("%A, %B %-d at %-l:%M %p")
  end

  def link_terms
    "The link works until #{expires_on} (Guam time), and each stub can be downloaded up to " \
      "#{@delivery.max_downloads_per_document} times. Please don't forward this email: anyone with the link can open it until then."
  end

  def link_html(count)
    <<~HTML
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Your AIRE pay stub</title></head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f0f4f8;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; margin: 0 auto; padding: 32px 20px;">
          <tr><td style="background-color: #1e3a5f; border-radius: 12px 12px 0 0; padding: 24px 28px;">
            <p style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 600;">#{h(PayDocuments::EMPLOYER_NAME)}</p>
          </td></tr>
          <tr><td style="background-color: #ffffff; padding: 28px;">
            <p style="margin: 0 0 16px 0; color: #1e293b; font-size: 16px;">Hi #{h(@delivery.user.display_name)},</p>
            <p style="margin: 0 0 24px 0; color: #334155; font-size: 16px; line-height: 1.6;">#{h(link_intro(count))}</p>
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;"><tr>
              <td style="background-color: #1e3a5f; border-radius: 8px;">
                <a href="#{h(@url)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Open my pay #{count == 1 ? 'stub' : 'stubs'}</a>
              </td>
            </tr></table>
            <p style="margin: 0 0 16px 0; color: #475569; font-size: 14px; line-height: 1.6;">#{h(link_terms)}</p>
            <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.6;">If you didn't expect this email, contact #{h(PayDocuments::EMPLOYER_NAME)} and don't open the link.</p>
          </td></tr>
        </table>
      </body>
      </html>
    HTML
  end

  def link_text(count)
    <<~TEXT
      Hi #{@delivery.user.display_name},

      #{link_intro(count)}

      Open it here: #{@url}

      #{link_terms}

      If you didn't expect this email, contact #{PayDocuments::EMPLOYER_NAME} and don't open the link.
    TEXT
  end

  def requested
    case @request.scope
    when "latest" then "their latest pay stub"
    when "year" then "all of their #{@request.year} pay stubs"
    else "the pay stub for one pay date"
    end
  end

  def notice_line
    where = @request.source == "kiosk" ? " at the kiosk" : ""
    typed = @request.recipient_kind == "typed" ? " They asked for it to go to an address that isn't the email on file, so an owner or admin needs to send it." : ""
    "#{@request.user.full_name} asked for #{requested}#{where}.#{typed} Open the pay stub requests list in AIRE to send it or dismiss the request."
  end

  def requests_url
    "#{ENV.fetch('FRONTEND_URL', 'http://localhost:5173').chomp('/')}/admin/pay-stubs"
  end

  def notice_html
    <<~HTML
      <p>#{h(notice_line)}</p>
      <p><a href="#{h(requests_url)}">Open pay stub requests</a></p>
    HTML
  end

  def notice_text
    "#{notice_line}\n\n#{requests_url}\n"
  end

  def h(value)
    CGI.escapeHTML(value.to_s)
  end
end
