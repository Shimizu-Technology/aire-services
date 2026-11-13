# frozen_string_literal: true

module PayDocuments
  # Records a worker's own pay stub request for the senders' list. The worker
  # is always the PIN-verified kiosk user; no worker ID comes from the client.
  # A short heads-up email goes to the configured recipients, if any. When the
  # request names an address other than the one on file, the worker's own
  # address is also told, in case someone else used their PIN.
  class RequestRecorder
    def self.record!(...)
      new(...).record!
    end

    def initialize(worker:, source:, scope:, statement_id: nil, year: nil, email: nil, email_confirmation: nil,
                   catalog: nil, now: Time.current)
      @worker = worker
      @source = source
      @scope = scope.to_s
      @statement_id = statement_id.to_s.presence
      @year = year
      @email = email
      @email_confirmation = email_confirmation
      @catalog = catalog || StatementCatalog.new(worker: worker)
      @now = now
    end

    def record!
      raise Error.new("Pay stub requests aren't available for this account.", code: "not_permitted", status: :forbidden) unless worker.is_active? && worker.staff?
      raise Error.new("Choose which pay stub you need.", code: "invalid_scope") unless PayDocumentRequest::SCOPES.include?(scope)

      recipient_kind, address = PayDocuments.resolve_recipient!(worker: worker, email: email, email_confirmation: email_confirmation)
      attributes = scope_attributes

      request = PayDocumentRequest.transaction do
        worker.lock_employee!
        RateLimit.check!(:worker_requests, worker: worker, now: now)
        PayDocumentRequest.create!(
          user: worker,
          source: source,
          scope: scope,
          recipient_kind: recipient_kind,
          recipient_email: recipient_kind == "typed" ? address : nil,
          **attributes
        ).tap { |created| audit!(created) }
      end
      notify!(request)
      alert_worker!(request) if request.recipient_kind == "typed"
      request
    end

    private

    attr_reader :worker, :source, :scope, :statement_id, :year, :email, :email_confirmation, :catalog, :now

    def scope_attributes
      case scope
      when "latest"
        {}
      when "year"
        value = Integer(year.to_s, 10)
        raise ArgumentError unless value.between?(2001, now.year)

        { year: value }
      when "pay_date"
        # The chosen date must be one of this worker's own, unvoided checks.
        entry = PayDocuments.with_payroll { catalog.find(statement_id) }
        raise Error.new("That pay date isn't available. Choose another one.", code: "statement_not_found") unless entry
        raise Error.new("That check was voided, so there's no stub to send.", code: "statement_voided") if entry.voided

        { document_reference: entry.id, document_date: entry.pay_date }
      end
    rescue ArgumentError, TypeError
      raise Error.new("Choose a year to request.", code: "invalid_year")
    end

    def audit!(request)
      AuditLog.record!(
        action: "pay_documents.request_created",
        auditable: request,
        actor: worker,
        subject_name: worker.full_name,
        event_category: "payroll",
        source: source == "kiosk" ? "kiosk" : "web",
        metadata: {
          request_id: request.id,
          target_user_id: worker.id,
          scope: request.scope,
          statement_id: request.document_reference,
          pay_date: request.document_date&.iso8601,
          year: request.year,
          recipient_kind: request.recipient_kind
        }.compact
      )
    end

    # A heads-up only; the request is already saved and listed for senders.
    def notify!(request)
      recipients = PayDocuments.request_notice_emails
      return if recipients.empty?

      PayDocumentMailer.deliver_request_notice(request: request, recipients: recipients)
      AuditLog.record!(action: "pay_documents.request_notice_sent", auditable: request, actor: nil, actor_kind: "system", source: "system",
        subject_name: worker.full_name, event_category: "payroll", metadata: { request_id: request.id, recipient_count: recipients.size })
    rescue StandardError => e
      Rails.logger.warn("[PayDocuments] Request notice failed for request #{request.id}: #{e.class}")
      Rails.error.report(e, handled: true, severity: :warning, context: { operation: "pay_document_request_notice", request_id: request.id })
    end

    # No amounts, dates or the typed address: just that it happened.
    def alert_worker!(request)
      address = PayDocuments.on_file_email(worker)
      return unless address

      PayDocumentMailer.deliver_typed_request_alert(request: request, to: address)
      AuditLog.record!(action: "pay_documents.request_worker_alert_sent", auditable: request, actor: nil, actor_kind: "system", source: "system",
        subject_name: worker.full_name, event_category: "payroll", metadata: { request_id: request.id, target_user_id: worker.id })
    rescue StandardError => e
      Rails.logger.warn("[PayDocuments] Worker alert failed for request #{request.id}: #{e.class}")
      Rails.error.report(e, handled: true, severity: :warning, context: { operation: "pay_document_request_worker_alert", request_id: request.id })
    end
  end
end
