# frozen_string_literal: true

class Current < ActiveSupport::CurrentAttributes
  attribute :user,
            :request_id,
            :ip_address,
            :user_agent,
            :session_fingerprint,
            :domain_audit_recorded
end
