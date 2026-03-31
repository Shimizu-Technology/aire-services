# frozen_string_literal: true

# Service for handling S3 operations (presigned URLs for upload/download)
class S3Service
  class << self
    def client
      @client ||= Aws::S3::Client.new(
        region: region,
        access_key_id: ENV.fetch("AWS_ACCESS_KEY_ID", nil),
        secret_access_key: ENV.fetch("AWS_SECRET_ACCESS_KEY", nil)
      )
    end

    def presigner
      @presigner ||= Aws::S3::Presigner.new(client: client)
    end

    def bucket
      ENV.fetch("AWS_S3_BUCKET", "cornerstone-accounting-documents")
    end

    def region
      ENV.fetch("AWS_REGION", "ap-southeast-2")
    end

    # Generate a presigned URL for uploading a file
    # Returns the presigned URL and the S3 key
    def presign_upload(filename:, content_type:, tax_return_id:)
      # Generate a unique key with folder structure
      timestamp = Time.current.strftime("%Y%m%d%H%M%S")
      safe_filename = filename.gsub(/[^a-zA-Z0-9._-]/, "_")
      s3_key = "tax_returns/#{tax_return_id}/#{timestamp}_#{safe_filename}"

      url = presigner.presigned_url(
        :put_object,
        bucket: bucket,
        key: s3_key,
        content_type: content_type,
        expires_in: 3600 # 1 hour
      )

      { url: url, s3_key: s3_key }
    end

    # Generate a presigned URL for downloading a file
    def presign_download(s3_key:, filename: nil, expires_in: 3600)
      options = {
        bucket: bucket,
        key: s3_key,
        expires_in: expires_in
      }

      # Set content disposition to trigger download with original filename
      if filename
        options[:response_content_disposition] = "attachment; filename=\"#{filename}\""
      end

      presigner.presigned_url(:get_object, options)
    end

    # Delete a file from S3
    def delete_object(s3_key:)
      client.delete_object(bucket: bucket, key: s3_key)
      true
    rescue Aws::S3::Errors::ServiceError => e
      Rails.logger.error("S3 delete error: #{e.message}")
      false
    end

    # Check if S3 is configured
    def configured?
      ENV["AWS_ACCESS_KEY_ID"].present? && ENV["AWS_SECRET_ACCESS_KEY"].present?
    end
  end
end
