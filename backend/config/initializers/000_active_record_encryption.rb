# frozen_string_literal: true

# Active Record Encryption configuration
# Keys are loaded from environment variables for security
#
# Generate new keys with: bin/rails db:encryption:init
#
# Required environment variables:
#   - ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY
#   - ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY
#   - ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT

if ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"].present?
  Rails.application.config.active_record.encryption.primary_key = ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"]
  Rails.application.config.active_record.encryption.deterministic_key = ENV["ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY"]
  Rails.application.config.active_record.encryption.key_derivation_salt = ENV["ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"]
else
  # In development without keys, encryption is disabled with a warning
  Rails.logger.warn "⚠️  Active Record Encryption keys not configured. Bank data will not be encrypted."
end
