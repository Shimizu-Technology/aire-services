class ApplicationController < ActionController::API
  around_action :with_request_context

  private

  def with_request_context
    Current.request_id = request.request_id
    Current.ip_address = request.remote_ip
    Current.user_agent = request.user_agent.to_s.first(1_000)
    yield
  ensure
    Current.reset
  end
end
