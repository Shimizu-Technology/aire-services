# frozen_string_literal: true

# Pay stub requests and secure download links.
#
# Workers ask for stubs (at the kiosk after their PIN, or "Email me this stub"
# in My Pay). Owners, admins and managers (the send_pay_statements capability)
# send them. The email carries only a link; the link page shows the employer,
# the worker's first name and pay dates, and fetches each PDF live from
# Cornerstone at download time. Nothing here reads, stores or returns pay
# amounts, so a manager can send stubs without seeing what anyone is paid.
module PayDocuments
  EMPLOYER_NAME = "AIRE Services Guam"
  LINK_TTL = 7.days
  # Enough for a phone, a computer and a retry or two; little exposure if forwarded.
  DOWNLOADS_PER_DOCUMENT = 5
  # A full year of biweekly checks plus corrections fits comfortably.
  MAX_DOCUMENTS_PER_LINK = 60
  EMAIL_MAX_LENGTH = 254
  EMAIL_FORMAT = /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/
  REQUEST_NOTICE_SETTING = "pay_stub_request_notification_emails"

  # Failures a caller can show as-is. `code` is stable for the frontend.
  class Error < StandardError
    attr_reader :code, :status

    def initialize(message, code:, status: :unprocessable_entity)
      super(message)
      @code = code
      @status = status
    end
  end

  class << self
    # Where an email goes: the address on file, or one typed twice.
    # Returns [kind, address] or raises Error.
    def resolve_recipient!(worker:, email:, email_confirmation:, allow_typed: true)
      typed = email.to_s.strip.downcase
      if typed.present?
        raise Error.new("Typed email addresses aren't allowed here.", code: "typed_email_not_allowed") unless allow_typed
        raise Error.new("That email address doesn't look right.", code: "invalid_email") unless typed.length <= EMAIL_MAX_LENGTH && EMAIL_FORMAT.match?(typed)
        raise Error.new("The two email addresses don't match.", code: "email_mismatch") unless typed == email_confirmation.to_s.strip.downcase

        return [ "typed", typed ]
      end

      on_file = worker.email.to_s.strip.downcase
      if on_file.blank? || on_file.end_with?("@placeholder.local") || !EMAIL_FORMAT.match?(on_file)
        raise Error.new("There's no email on file. Type an email address instead.", code: "no_email_on_file")
      end

      [ "on_file", on_file ]
    end

    # "m•••@example.com": enough for a worker at a shared kiosk to recognise
    # their own address without showing it to whoever is standing nearby.
    def masked_email(address)
      local, domain = address.to_s.split("@", 2)
      return nil if local.blank? || domain.blank?

      "#{local[0]}•••@#{domain}"
    end

    def on_file_email(worker)
      address = worker.email.to_s.strip.downcase
      return nil if address.blank? || address.end_with?("@placeholder.local") || !EMAIL_FORMAT.match?(address)

      address
    end

    def request_notice_emails
      Setting.normalize_emails(Setting.get(REQUEST_NOTICE_SETTING))
    end

    # Cornerstone failures as messages a person can act on.
    def with_payroll
      yield
    rescue Payroll::WorkerStatementsClient::NotLinked
      raise Error.new("This person isn't connected to payroll yet, so there are no stubs to send.", code: "payroll_not_linked")
    rescue Payroll::WorkerStatementsClient::NotFound
      raise Error.new("That pay stub isn't available.", code: "statement_not_found", status: :not_found)
    rescue Payroll::WorkerStatementsClient::Unavailable
      raise Error.new("Payroll is temporarily unavailable. Please try again in a few minutes.", code: "payroll_unavailable", status: :service_unavailable)
    end

    def sendable_workers
      User.staff.where(is_active: true)
    end

    def link_url(token)
      # The token travels in the URL fragment, which browsers never send to a
      # server, so it stays out of web server logs and Referer headers.
      "#{ENV.fetch('FRONTEND_URL', 'http://localhost:5173').chomp('/')}/stubs#t=#{token}"
    end
  end
end
