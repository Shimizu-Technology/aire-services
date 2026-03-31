# Be sure to restart your server when you modify this file.

# Avoid CORS issues when API is called from the frontend app.
# Handle Cross-Origin Resource Sharing (CORS) in order to accept cross-origin Ajax requests.

# Read more: https://github.com/cyu/rack-cors

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    # CST-15: Only allow configured origins; fail-safe in production
    frontend_url = ENV["FRONTEND_URL"]

    if frontend_url.blank? && !(Rails.env.development? || Rails.env.test?)
      raise "FRONTEND_URL must be set in non-development environments"
    end

    allowed_origins = [frontend_url || "http://localhost:5173"].compact

    # Only include dev origins in development/test
    if Rails.env.development? || Rails.env.test?
      allowed_origins += ["http://localhost:5173", "http://127.0.0.1:5173"]
    end

    allowed_origins.uniq!

    origins(*allowed_origins)

    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      credentials: true
  end
end
