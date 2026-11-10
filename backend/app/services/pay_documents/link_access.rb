# frozen_string_literal: true

module PayDocuments
  # What a recipient can do with a secure link: see the employer, the worker's
  # first name and the pay dates, and download each PDF a limited number of
  # times. Every PDF is fetched live from Cornerstone after re-checking that
  # the statement is still the worker's own and not voided.
  #
  # A download is reserved under a row lock before Cornerstone is called and
  # refunded if the fetch fails, so concurrent clicks can't pass the cap.
  class LinkAccess
    UNAVAILABLE_STATES = {
      "revoked" => "This link was turned off by AIRE. Ask the office to send a new one.",
      "expired" => "This link has expired. Ask the office to send a new one.",
      "used_up" => "This link has reached its download limit. Ask the office to send a new one.",
      "failed" => "This link isn't active. Ask the office to send a new one."
    }.freeze

    def initialize(token:, client: Payroll::WorkerStatementsClient.new, now: Time.current)
      @token = token.to_s
      @client = client
      @now = now
    end

    def delivery
      @delivery ||= PayDocumentDelivery.includes(:user, :pay_document_items).find_by_token(token)
    end

    def summary
      found!
      state = delivery.state(now)
      {
        state: state,
        message: UNAVAILABLE_STATES[state],
        employer: EMPLOYER_NAME,
        first_name: delivery.user.display_name,
        expires_at: delivery.expires_at.iso8601,
        downloads_per_document: delivery.max_downloads_per_document,
        documents: state == "active" ? delivery.pay_document_items.map { |item| document_json(item) } : []
      }
    end

    def download!(item_id)
      found!
      items = reserve! { |delivery_items| [ delivery_items.find { |item| item.id.to_s == item_id.to_s } || not_found! ] }
      body = fetch_all(items, bundled: false).first
      { body: body, filename: filename_for(items.first) }
    end

    # Every document with downloads left, as one PDF.
    def download_all!
      found!
      items = reserve! { |delivery_items| delivery_items.select { |item| item.downloads_left.positive? } }
      bodies = fetch_all(items, bundled: true)
      combined = CombinePDF.new
      bodies.each { |body| combined << CombinePDF.parse(body) }
      years = items.filter_map { |item| item.document_date&.year }.uniq
      { body: combined.to_pdf, filename: years.one? ? "AIRE-pay-stubs-#{years.first}.pdf" : "AIRE-pay-stubs.pdf" }
    end

    private

    attr_reader :token, :client, :now

    def found!
      return if delivery

      deny!("unknown_link")
      raise Error.new("This link isn't valid. Check that you opened the whole link from your email.", code: "link_not_found", status: :not_found)
    end

    def not_found!
      raise Error.new("That pay stub isn't part of this link.", code: "document_not_found", status: :not_found)
    end

    # Denials are audited after the transaction, so the audit row survives.
    def reserve!
      denial = nil
      items = PayDocumentDelivery.transaction do
        delivery.lock!
        state = delivery.state(now)
        next denial = [ state, Error.new(UNAVAILABLE_STATES.fetch(state), code: "link_#{state}", status: :gone) ] unless state == "active"

        selected = yield(delivery.pay_document_items.lock.to_a)
        if selected.empty? || selected.any? { |item| item.download_count >= delivery.max_downloads_per_document }
          next denial = [ "download_limit", Error.new("This pay stub has been downloaded the maximum number of times. Ask the office to send a new link.", code: "download_limit", status: :gone) ]
        end

        selected.each { |item| item.update!(download_count: item.download_count + 1) }
        selected
      end
      return items unless denial

      deny!(denial.first)
      raise denial.last
    end

    def refund!(items)
      PayDocumentItem.transaction do
        items.each do |item|
          item.lock!
          item.update!(download_count: item.download_count - 1) if item.download_count.positive?
        end
      end
    end

    def fetch_all(items, bundled:)
      bodies = begin
        catalog = StatementCatalog.new(worker: delivery.user, client: client)
        PayDocuments.with_payroll do
          items.map do |item|
            entry = catalog.find(item.reference)
            raise Error.new("This pay stub is no longer available. Ask the office for help.", code: "document_unavailable", status: :gone) if entry.nil? || entry.voided

            client.statement_pdf(delivery.user.payroll_integration_uuid, item.reference)
          end
        end
      rescue StandardError => e
        refund!(items)
        deny!(e.is_a?(Error) ? e.code : "download_failed", item_ids: items.map(&:id))
        raise
      end
      record_downloads!(items, bundled: bundled)
      bodies
    end

    def record_downloads!(items, bundled:)
      items.each do |item|
        PayDocumentDownload.create!(pay_document_delivery: delivery, pay_document_item: item, bundled: bundled,
          ip_address: Current.ip_address, user_agent: Current.user_agent.to_s.first(1_000).presence)
        audit!("pay_documents.link_downloaded", item_id: item.id, statement_id: item.reference, pay_date: item.document_date&.iso8601,
          bundled: bundled, downloads_used: item.download_count, max_downloads_per_document: delivery.max_downloads_per_document)
      end
    end

    def deny!(reason, **metadata)
      if delivery
        audit!("pay_documents.link_download_denied", outcome: "denied", reason: reason, **metadata)
      else
        AuditLog.record!(action: "pay_documents.link_download_denied", subject_type: "PayDocumentDelivery", subject_id: 0,
          subject_name: "Unknown pay stub link", actor: nil, actor_kind: "system", source: "web", event_category: "security",
          outcome: "denied", metadata: { reason: reason }, mark_domain_recorded: false)
      end
    rescue StandardError => e
      Rails.logger.error("[PayDocuments] Failed to audit a denied link access: #{e.class}")
      Rails.error.report(e, handled: true, severity: :error, context: { operation: "pay_document_link_audit" })
    end

    # The link holder is not an AIRE user, so the actor is recorded as the
    # link recipient; the audit row keeps the request's IP and user agent.
    def audit!(action, outcome: "succeeded", **metadata)
      AuditLog.record!(
        action: action,
        auditable: delivery,
        actor: nil,
        actor_kind: "system",
        source: "web",
        subject_name: delivery.user.full_name,
        event_category: "payroll",
        outcome: outcome,
        metadata: { accessed_by: "link_recipient", delivery_id: delivery.id, target_user_id: delivery.user_id, **metadata }.compact
      )
    end

    def document_json(item)
      {
        id: item.id,
        kind: item.kind,
        pay_date: item.document_date&.iso8601,
        period_start: item.period_start&.iso8601,
        period_end: item.period_end&.iso8601,
        downloads_left: item.downloads_left
      }
    end

    def filename_for(item)
      "AIRE-pay-stub-#{item.document_date&.iso8601 || item.reference}.pdf"
    end
  end
end
