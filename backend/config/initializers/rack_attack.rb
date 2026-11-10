# frozen_string_literal: true

class Rack::Attack
  Rack::Attack.cache.store = Rails.cache

  # Limit contact form submissions to 10 per hour per IP
  throttle("contact/ip", limit: 10, period: 1.hour) do |req|
    if req.path == "/api/v1/contact" && req.post?
      req.ip
    end
  end

  # Kiosk PIN verification is public — keep it tight
  throttle("aire_kiosk_verify/ip", limit: 20, period: 5.minutes) do |req|
    if req.path == "/api/v1/aire/kiosk/verify" && req.post?
      req.ip
    end
  end

  # Public pay stub links carry their own expiry and per-document download
  # cap; this bounds token guessing and the audit rows a bad client can cause.
  throttle("pay_stub_links/ip", limit: 60, period: 5.minutes) do |req|
    req.ip if req.post? && req.path.start_with?("/api/v1/pay_stub_links/")
  end

  # Kiosk pay stub requests also have per-worker daily limits in the app.
  throttle("aire_kiosk_pay_stubs/ip", limit: 30, period: 5.minutes) do |req|
    req.ip if req.post? && req.path.start_with?("/api/v1/aire/kiosk/pay_stubs")
  end

  # The cockpit records failed authentication attempts. Bound request volume so
  # a bad client cannot turn those security records into an unbounded write
  # stream while leaving ample room for normal polling and operator actions.
  throttle("payroll_cockpit/ip", limit: 300, period: 1.minute) do |req|
    req.ip if req.path.start_with?("/api/v1/payroll/cockpit/")
  end

  self.throttled_responder = lambda do |request|
    match_data = request.env["rack.attack.match_data"]
    now = match_data[:epoch_time]

    headers = {
      "Content-Type" => "application/json",
      "Retry-After" => (match_data[:period] - (now % match_data[:period])).to_s
    }

    body = {
      error: "Rate limit exceeded. Please try again later.",
      retry_after: headers["Retry-After"].to_i
    }.to_json

    [ 429, headers, [ body ] ]
  end
end
