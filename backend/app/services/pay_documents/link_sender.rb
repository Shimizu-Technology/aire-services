# frozen_string_literal: true

module PayDocuments
  # Creates a secure link to some of a worker's pay stubs and emails it.
  #
  # origin "sender": an active owner, admin or manager (send_pay_statements)
  # sends a link, optionally fulfilling a worker's request. Managers send only
  # to the worker's email on file. Owners and admins (preview_pay) may also
  # type an address twice, and only they can fulfil a request made to a typed
  # address; that address always comes from the saved request, never from
  # the client. origin "self": a worker with My Pay on, while "Workers can
  # email themselves stubs" is on, emails one of their own stubs to the
  # address on file.
  #
  # Every statement must be the worker's own, unvoided check in Cornerstone's
  # current list. The link is saved as "pending" before the email goes out
  # and only works once the email is recorded as sent. If the email fails,
  # or recording it fails, the link is marked failed and can never be used.
  class LinkSender
    Result = Struct.new(:delivery, :email_status, keyword_init: true)

    def self.send!(...)
      new(...).send!
    end

    def initialize(worker:, actor:, statement_ids:, origin: "sender", email: nil, email_confirmation: nil, request: nil,
                   catalog: nil, now: Time.current)
      @worker = worker
      @actor = actor
      @statement_ids = Array(statement_ids).map(&:to_s).uniq
      @origin = origin
      @email = email
      @email_confirmation = email_confirmation
      @request = request
      @catalog = catalog || StatementCatalog.new(worker: worker)
      @now = now
    end

    def send!
      authorize!
      validate_request!
      recipient_kind, address = resolve_recipient!
      entries = selected_entries

      token = PayDocumentDelivery.generate_token
      delivery = PayDocumentDelivery.transaction do
        worker.lock!
        check_rate_limits!
        create_delivery!(token, entries, recipient_kind, address)
      end

      deliver_email!(delivery, token)
    end

    private

    attr_reader :worker, :actor, :statement_ids, :origin, :email, :email_confirmation, :request, :catalog, :now

    def authorize!
      permitted =
        case origin
        when "sender" then actor&.is_active? && actor.can_send_pay_statements?
        when "self" then actor && actor.id == worker.id && Setting.my_pay_enabled_for?(worker) && PayDocuments.self_email_enabled?
        end
      raise Error.new("You can't send pay stubs.", code: "not_permitted", status: :forbidden) unless permitted
      raise Error.new("Pay stubs can only be sent to active team members.", code: "worker_not_found", status: :not_found) unless PayDocuments.sendable_workers.exists?(id: worker.id)
    end

    def validate_request!
      return unless request
      raise Error.new("That request isn't for this person.", code: "request_mismatch") unless request.user_id == worker.id
      raise Error.new("That request was already handled.", code: "request_closed", status: :conflict) unless request.open?
    end

    def resolve_recipient!
      return PayDocuments.resolve_recipient!(worker: worker, email: nil, email_confirmation: nil) if origin == "self"

      if request&.recipient_kind == "typed"
        unless PayDocuments.can_choose_recipient?(actor)
          deny!("typed_request_needs_admin")
          raise Error.new("This person asked for a different email address. An owner or admin needs to send this one.",
            code: "typed_request_needs_admin", status: :forbidden)
        end
        address = request.recipient_email.to_s.strip.downcase
        raise Error.new("The email on this request doesn't look right. Dismiss it and ask them again.", code: "invalid_email") unless PayDocuments.valid_email?(address)

        return [ "typed", address ]
      end

      if email.present? && !PayDocuments.can_choose_recipient?(actor)
        deny!("typed_email_not_allowed")
        raise Error.new("Pay stubs can only go to the email on file. An owner or admin can send to a different address.",
          code: "typed_email_not_allowed", status: :forbidden)
      end

      PayDocuments.resolve_recipient!(worker: worker, email: email, email_confirmation: email_confirmation)
    end

    def selected_entries
      raise Error.new("Choose at least one pay stub to send.", code: "no_documents") if statement_ids.empty?
      raise Error.new("Send at most #{MAX_DOCUMENTS_PER_LINK} pay stubs in one link.", code: "too_many_documents") if statement_ids.size > MAX_DOCUMENTS_PER_LINK
      raise Error.new("That pay stub isn't available.", code: "statement_not_found", status: :not_found) unless statement_ids.all? { |id| Payroll::WorkerStatementsClient.valid_statement_id?(id) }
      raise Error.new("Email one pay stub at a time.", code: "too_many_documents") if origin == "self" && statement_ids.size > 1

      PayDocuments.with_payroll do
        statement_ids.map do |id|
          entry = catalog.find(id)
          raise Error.new("One of those pay stubs isn't available anymore. Refresh and try again.", code: "statement_not_found", status: :not_found) unless entry
          raise Error.new("Voided checks can't be sent.", code: "statement_voided") if entry.voided

          entry
        end
      end
    end

    def check_rate_limits!
      if origin == "self"
        RateLimit.check!(:self_sends, worker: worker, now: now)
      else
        RateLimit.check!(:sends_by_sender, sender: actor, now: now)
        RateLimit.check!(:sends_to_worker, worker: worker, now: now)
      end
    end

    def create_delivery!(token, entries, recipient_kind, address)
      request&.lock!
      validate_request!
      delivery = PayDocumentDelivery.create!(
        user: worker,
        sent_by: actor,
        pay_document_request: request,
        origin: origin,
        recipient_email: address,
        recipient_kind: recipient_kind,
        token_digest: PayDocumentDelivery.digest(token),
        expires_at: now + LINK_TTL,
        max_downloads_per_document: DOWNLOADS_PER_DOCUMENT
      )
      entries.each_with_index do |entry, index|
        delivery.pay_document_items.create!(
          kind: "pay_statement", reference: entry.id, document_date: entry.pay_date,
          period_start: entry.period_start, period_end: entry.period_end, position: index
        )
      end
      delivery
    end

    # A link stays "pending", and unusable, until this records the email as
    # sent. If the email or that bookkeeping fails, the link is marked failed,
    # so a retry after an error never leaves two working links.
    def deliver_email!(delivery, token)
      response = begin
        PayDocumentMailer.deliver_link(delivery: delivery, token: token)
      rescue StandardError => e
        email_failed!(delivery, e, message: "The email couldn't be sent, so the link was cancelled. Please try again.")
      end

      status = response.is_a?(Hash) && response["staging_captured"] ? "captured" : "sent"
      begin
        PayDocumentDelivery.transaction do
          delivery.update!(email_status: status, emailed_at: Time.current)
          if request
            request.lock!
            request.update!(status: "fulfilled", resolved_by: actor, resolved_at: Time.current) if request.open?
          end
          audit!(delivery, "pay_documents.link_sent", email_status: status)
        end
      rescue StandardError => e
        email_failed!(delivery, e, message: "Something went wrong after the email was sent, so that link was cancelled. Please send it again.")
      end
      Result.new(delivery: delivery, email_status: status)
    end

    def email_failed!(delivery, error, message:)
      Rails.logger.warn("[PayDocuments] Link email failed for delivery #{delivery.id}: #{error.class}")
      Rails.error.report(error, handled: true, severity: :error, context: { operation: "pay_document_link_email", delivery_id: delivery.id })
      # update_columns: this must stick even when the record or a callback is what failed.
      delivery.update_columns(email_status: "failed", updated_at: Time.current)
      begin
        audit!(delivery, "pay_documents.link_sent", outcome: "failed", email_status: "failed", error_class: error.class.name)
      rescue StandardError => audit_error
        Rails.error.report(audit_error, handled: true, severity: :error, context: { operation: "pay_document_link_audit", delivery_id: delivery.id })
      end
      raise Error.new(message, code: "email_failed", status: :bad_gateway)
    end

    # A refused send, recorded against the worker since no link exists.
    def deny!(reason)
      AuditLog.record!(
        action: "pay_documents.link_sent",
        auditable: worker,
        actor: actor,
        subject_name: worker.full_name,
        event_category: "payroll",
        outcome: "denied",
        metadata: { target_user_id: worker.id, request_id: request&.id, origin: origin, reason: reason }.compact
      )
    end

    def audit!(delivery, action, outcome: "succeeded", **extra)
      AuditLog.record!(
        action: action,
        auditable: delivery,
        actor: actor,
        subject_name: worker.full_name,
        event_category: "payroll",
        outcome: outcome,
        metadata: {
          delivery_id: delivery.id,
          target_user_id: worker.id,
          request_id: request&.id,
          origin: origin,
          recipient_kind: delivery.recipient_kind,
          recipient_email: delivery.recipient_email,
          statement_ids: delivery.pay_document_items.map(&:reference),
          pay_dates: delivery.pay_document_items.filter_map { |item| item.document_date&.iso8601 },
          expires_at: delivery.expires_at.iso8601,
          max_downloads_per_document: delivery.max_downloads_per_document,
          **extra
        }.compact
      )
    end
  end
end
