# frozen_string_literal: true

if Rails.env.production? && Rails.application.config.active_storage.service == :amazon
  missing = %w[AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION].select { |key| ENV[key].blank? }
  missing << "AWS_S3_BUCKET" if ENV["AWS_S3_BUCKET"].blank?

  if missing.any?
    raise "Missing required S3 configuration for Active Storage: #{missing.join(', ')}"
  end
end
