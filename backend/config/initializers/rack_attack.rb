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
