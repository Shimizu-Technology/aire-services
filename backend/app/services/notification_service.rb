# frozen_string_literal: true

require "cgi"

class NotificationService
  class << self
    # Called when a tax return's workflow stage changes to a stage with notify_client = true
    def notify_status_change(tax_return:, new_stage:)
      return unless new_stage&.notify_client
      client = tax_return.client
      unless client&.email.present?
        Rails.logger.info "Skipping status notification for tax return #{tax_return.id}: client has no email address"
        return
      end
      return if client.notification_preference == "none"

      unless resend_configured?
        Rails.logger.info "Skipping status notification for tax return #{tax_return.id}: Resend not configured"
        return
      end

      notification = Notification.create(
        client: client,
        tax_return: tax_return,
        notification_type: "email",
        template: "status_changed",
        status: "pending",
        recipient: client.email,
        content: "Status changed to #{new_stage.name} for #{tax_return.tax_year} tax return"
      )

      unless notification.persisted?
        Rails.logger.error "Failed to create status notification for tax return #{tax_return.id}: #{notification.errors.full_messages.join(', ')}"
        return
      end

      send_status_change_email(
        notification: notification,
        client: client,
        tax_return: tax_return,
        new_stage: new_stage
      )
    rescue StandardError => e
      Rails.logger.error "Status change notification failed for tax return #{tax_return.id}: #{e.message}"
    end

    # Called when a client uploads a document — notifies the admin
    def notify_document_uploaded(document:, tax_return:, uploaded_by_client:)
      return unless uploaded_by_client
      notification_email = Setting.get("notification_email")
      return if notification_email.blank?

      unless resend_configured?
        Rails.logger.info "Skipping document upload notification: Resend not configured"
        return
      end

      client = tax_return.client
      return unless client

      notification = Notification.create(
        client: client,
        tax_return: tax_return,
        notification_type: "email",
        template: "document_uploaded_by_client",
        status: "pending",
        recipient: notification_email,
        content: "#{client.full_name} uploaded #{document.filename}"
      )

      unless notification.persisted?
        Rails.logger.error "Failed to create document upload notification: #{notification.errors.full_messages.join(', ')}"
        return
      end

      send_document_upload_email(
        notification: notification,
        client: client,
        tax_return: tax_return,
        document: document,
        admin_email: notification_email
      )
    rescue StandardError => e
      Rails.logger.error "Document upload notification failed: #{e.message}"
    end

    private

    def send_status_change_email(notification:, client:, tax_return:, new_stage:)
      from_email = ENV.fetch("MAILER_FROM_EMAIL", "noreply@example.com")
      portal_url = "#{ENV.fetch('FRONTEND_URL', 'http://localhost:5173')}/portal/returns/#{tax_return.id}"

      subject = status_change_subject(new_stage, tax_return)

      Resend::Emails.send({
        from: from_email,
        to: client.email,
        subject: subject,
        html: status_change_html(
          client: client,
          tax_return: tax_return,
          new_stage: new_stage,
          portal_url: portal_url
        )
      })

      notification.mark_sent!
      Rails.logger.info "Status change notification sent to #{client.email} for tax return #{tax_return.id}"
    rescue StandardError => e
      notification.mark_failed!(e.message) rescue nil
      Rails.logger.error "Failed to send status notification to #{client.email}: #{e.message}"
    end

    def send_document_upload_email(notification:, client:, tax_return:, document:, admin_email:)
      from_email = ENV.fetch("MAILER_FROM_EMAIL", "noreply@example.com")
      admin_url = "#{ENV.fetch('FRONTEND_URL', 'http://localhost:5173')}/admin/returns/#{tax_return.id}"

      Resend::Emails.send({
        from: from_email,
        to: admin_email,
        subject: "New Document Uploaded — #{client.full_name}",
        html: document_upload_html(
          client: client,
          tax_return: tax_return,
          document: document,
          admin_url: admin_url
        )
      })

      notification.mark_sent!
      Rails.logger.info "Document upload notification sent to #{admin_email} for #{client.full_name}"
    rescue StandardError => e
      notification.mark_failed!(e.message) rescue nil
      Rails.logger.error "Failed to send document upload notification: #{e.message}"
    end

    def status_change_subject(stage, tax_return)
      year = tax_return.tax_year
      case stage.slug
      when WorkflowStage::SLUGS[:documents_pending]
        "Action Needed — Documents Required for Your #{year} Tax Return"
      when WorkflowStage::SLUGS[:ready_to_sign]
        "Your #{year} Tax Return is Ready to Sign"
      when WorkflowStage::SLUGS[:ready_for_pickup]
        "Your #{year} Tax Return is Ready for Pickup"
      when WorkflowStage::SLUGS[:complete]
        "Your #{year} Tax Return is Complete"
      else
        "Update on Your #{year} Tax Return — #{stage.name}"
      end
    end

    def resend_configured?
      if ENV["RESEND_API_KEY"].blank?
        Rails.logger.warn "RESEND_API_KEY not configured, skipping notification"
        return false
      end
      true
    end

    def sanitize_css_color(color)
      return "#8b7355" unless color.present?
      color.match?(/\A#[0-9a-fA-F]{3,8}\z/) ? color : "#8b7355"
    end

    def status_change_html(client:, tax_return:, new_stage:, portal_url:)
      stage_name = CGI.escapeHTML(new_stage.name.to_s)
      client_name = CGI.escapeHTML(client.first_name.to_s)
      year = CGI.escapeHTML(tax_return.tax_year.to_s)
      message = status_message(new_stage, tax_return)
      stage_color = sanitize_css_color(new_stage.color)

      <<~HTML
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                      <h2 style="color: #2d2a26; margin: 0 0 20px 0; font-size: 22px;">Update on Your #{year} Tax Return</h2>

                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
                        Hi #{client_name},
                      </p>

                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        #{message}
                      </p>

                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 25px 0; background-color: #f9f8f6; border-radius: 8px; border-left: 4px solid #{stage_color};">
                        <tr>
                          <td style="padding: 16px 20px;">
                            <p style="color: #888888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px 0;">Current Status</p>
                            <p style="color: #2d2a26; font-size: 18px; font-weight: 600; margin: 0;">#{stage_name}</p>
                          </td>
                        </tr>
                      </table>

                      <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 30px auto;">
                        <tr>
                          <td style="background-color: #8b7355; border-radius: 8px;">
                            <a href="#{CGI.escapeHTML(portal_url.to_s)}" target="_blank" style="display: inline-block; padding: 16px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                              View in Your Portal
                            </a>
                          </td>
                        </tr>
                      </table>

                      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">

                      <p style="color: #888888; font-size: 13px; line-height: 1.6; margin: 0;">
                        If you have any questions, please don't hesitate to contact our office.
                      </p>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f3ef; border-radius: 0 0 12px 12px; padding: 20px 30px;">
                  <tr>
                    <td align="center">
                      <p style="color: #888888; font-size: 12px; margin: 0;">
                        Cornerstone Accounting & Business Services<br>
                        Hagatna, Guam · (671) 828-8591
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

    def status_message(stage, tax_return)
      year = CGI.escapeHTML(tax_return.tax_year.to_s)
      case stage.slug
      when WorkflowStage::SLUGS[:documents_pending]
        "We need some additional documents to continue preparing your #{year} tax return. Please log in to your portal to see what's needed and upload them at your convenience."
      when WorkflowStage::SLUGS[:in_preparation]
        "Great news — your #{year} tax return is now being prepared by our team. We'll notify you when there's an update."
      when WorkflowStage::SLUGS[:in_review]
        "Your #{year} tax return is currently under review. We're making sure everything is accurate before the next step."
      when WorkflowStage::SLUGS[:ready_to_sign]
        "Your #{year} tax return is ready for your signature. Please visit our office or log in to your portal for details."
      when WorkflowStage::SLUGS[:filing]
        "Your #{year} tax return has been signed and is now being filed. Almost done!"
      when WorkflowStage::SLUGS[:ready_for_pickup]
        "Your #{year} tax return is ready for pickup at our office. Please bring a valid photo ID."
      when WorkflowStage::SLUGS[:complete]
        "Your #{year} tax return has been completed. Thank you for choosing Cornerstone Accounting!"
      else
        "The status of your #{year} tax return has been updated to <strong>#{CGI.escapeHTML(stage.name)}</strong>."
      end
    end

    def document_upload_html(client:, tax_return:, document:, admin_url:)
      client_name = CGI.escapeHTML(client.full_name.to_s)
      year = CGI.escapeHTML(tax_return.tax_year.to_s)
      filename = CGI.escapeHTML(document.filename.to_s)
      doc_type = CGI.escapeHTML(document.document_type&.titleize || "Other")

      <<~HTML
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                      <h2 style="color: #2d2a26; margin: 0 0 20px 0; font-size: 22px;">New Document Uploaded</h2>

                      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        #{client_name} has uploaded a new document for their #{year} tax return.
                      </p>

                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 25px 0; background-color: #f9f8f6; border-radius: 8px; padding: 16px 20px;">
                        <tr>
                          <td>
                            <p style="color: #888888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px 0;">Document Details</p>
                            <p style="color: #2d2a26; font-size: 15px; margin: 0 0 4px 0;"><strong>File:</strong> #{filename}</p>
                            <p style="color: #2d2a26; font-size: 15px; margin: 0 0 4px 0;"><strong>Type:</strong> #{doc_type}</p>
                            <p style="color: #2d2a26; font-size: 15px; margin: 0;"><strong>Client:</strong> #{client_name}</p>
                          </td>
                        </tr>
                      </table>

                      <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 30px auto;">
                        <tr>
                          <td style="background-color: #8b7355; border-radius: 8px;">
                            <a href="#{CGI.escapeHTML(admin_url.to_s)}" target="_blank" style="display: inline-block; padding: 16px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">
                              View Tax Return
                            </a>
                          </td>
                        </tr>
                      </table>
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
