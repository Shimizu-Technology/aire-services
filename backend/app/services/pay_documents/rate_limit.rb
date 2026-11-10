# frozen_string_literal: true

module PayDocuments
  # Durable, per-person limits counted from saved rows, so they hold across
  # processes and restarts. Callers check inside a transaction that has locked
  # the worker's row, which serialises concurrent requests for one worker.
  module RateLimit
    LIMITS = {
      # Kiosk and other worker requests, per worker.
      worker_requests: { max: 3, window: 1.day, message: "You've already asked for pay stubs 3 times today. The office will follow up." },
      # "Email me this stub" from My Pay, per worker.
      self_sends: { max: 5, window: 1.day, message: "You've emailed yourself 5 pay stub links today. Please try again tomorrow." },
      # Links any sender sends to one worker.
      sends_to_worker: { max: 10, window: 1.day, message: "10 pay stub links have already been sent to this person today. Please try again tomorrow." },
      # Links one sender sends to anyone.
      sends_by_sender: { max: 30, window: 1.hour, message: "You've sent 30 pay stub links in the last hour. Please wait a few minutes and try again." }
    }.freeze

    module_function

    def check!(kind, now: Time.current, **subject)
      limit = LIMITS.fetch(kind)
      count = relation(kind, **subject).where(created_at: (now - limit[:window])..).count
      return if count < limit[:max]

      raise Error.new(limit[:message], code: "rate_limited", status: :too_many_requests)
    end

    def relation(kind, worker: nil, sender: nil)
      case kind
      when :worker_requests then PayDocumentRequest.where(user: worker)
      when :self_sends then PayDocumentDelivery.where(user: worker, origin: "self")
      when :sends_to_worker then PayDocumentDelivery.where(user: worker, origin: "sender")
      when :sends_by_sender then PayDocumentDelivery.where(sent_by: sender, origin: "sender")
      end
    end
  end
end
