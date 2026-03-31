# frozen_string_literal: true

module Api
  module V1
    module Portal
      class DocumentsController < BaseController
        include DocumentValidatable

        before_action :set_tax_return
        before_action :set_document, only: [:download]

        # GET /api/v1/portal/tax_returns/:tax_return_id/documents
        def index
          documents = @tax_return.documents.order(created_at: :desc)
          render json: {
            documents: documents.map { |doc| serialize_document(doc) }
          }
        end

        # POST /api/v1/portal/tax_returns/:tax_return_id/documents/presign
        def presign
          unless S3Service.configured?
            return render json: { error: "File uploads are not available at this time" }, status: :service_unavailable
          end

          filename = params[:filename]
          content_type = params[:content_type]
          file_size = params[:file_size].to_i

          if filename.blank?
            return render json: { error: "Filename is required" }, status: :unprocessable_entity
          end

          if content_type.blank?
            return render json: { error: "Content type is required" }, status: :unprocessable_entity
          end

          if file_size <= 0
            return render json: { error: "File size is required" }, status: :unprocessable_entity
          end

          if file_size > MAX_FILE_SIZE
            return render json: { error: "File size exceeds maximum of 50MB" }, status: :unprocessable_entity
          end

          unless ALLOWED_CONTENT_TYPES.include?(content_type)
            return render json: { error: "Only PDF, JPEG, and PNG files are accepted" }, status: :unprocessable_entity
          end

          unless content_type_matches_extension?(content_type, filename)
            return render json: { error: "File extension does not match the declared content type" }, status: :unprocessable_entity
          end

          begin
            result = S3Service.presign_upload(
              filename: filename,
              content_type: content_type,
              tax_return_id: @tax_return.id
            )
          rescue StandardError => e
            Rails.logger.error "S3 presign failed for tax return #{@tax_return.id}: #{e.message}"
            return render json: { error: "File upload service is temporarily unavailable. Please try again." }, status: :service_unavailable
          end

          render json: {
            upload_url: result[:url],
            s3_key: result[:s3_key],
            expires_in: 3600
          }
        end

        # POST /api/v1/portal/tax_returns/:tax_return_id/documents
        def create
          s3_key = document_params[:s3_key]
          expected_prefix = "tax_returns/#{@tax_return.id}/"
          unless s3_key.present? && s3_key.start_with?(expected_prefix)
            return render json: { error: "Invalid S3 key" }, status: :unprocessable_entity
          end

          content_type = document_params[:content_type]
          filename = document_params[:filename]
          file_size = document_params[:file_size].to_i

          unless content_type.present? && ALLOWED_CONTENT_TYPES.include?(content_type)
            return render json: { error: "Invalid content type" }, status: :unprocessable_entity
          end
          unless content_type_matches_extension?(content_type, filename.to_s)
            return render json: { error: "Content type does not match file extension" }, status: :unprocessable_entity
          end
          if file_size <= 0 || file_size > MAX_FILE_SIZE
            return render json: { error: "File size must be between 1 byte and 50MB" }, status: :unprocessable_entity
          end

          doc_type = document_params[:document_type]
          if doc_type.present? && !Document::DOCUMENT_TYPES.include?(doc_type)
            return render json: { error: "Invalid document type. Allowed: #{Document::DOCUMENT_TYPES.join(', ')}" }, status: :unprocessable_entity
          end

          document = @tax_return.documents.build(document_params)
          document.uploaded_by = current_user

          if document.save
            DocumentUploadNotificationJob.perform_later(document.id, @tax_return.id)
            render json: { document: serialize_document(document) }, status: :created
          else
            render json: { errors: document.errors.full_messages }, status: :unprocessable_entity
          end
        end

        # GET /api/v1/portal/tax_returns/:tax_return_id/documents/:id/download
        def download
          unless S3Service.configured?
            return render json: { error: "File downloads are not available at this time" }, status: :service_unavailable
          end

          begin
            download_url = S3Service.presign_download(
              s3_key: @document.s3_key,
              filename: @document.filename,
              expires_in: 3600
            )
          rescue StandardError => e
            Rails.logger.error "S3 presign download failed for document #{@document.id}: #{e.message}"
            return render json: { error: "File download service is temporarily unavailable. Please try again." }, status: :service_unavailable
          end

          render json: { download_url: download_url, expires_in: 3600 }
        end

        private

        def set_tax_return
          @tax_return = current_client.tax_returns.find(params[:tax_return_id])
        end

        def set_document
          @document = @tax_return.documents.find(params[:id])
        end

        def document_params
          params.require(:document).permit(:filename, :s3_key, :content_type, :file_size, :document_type)
        end

        def serialize_document(doc)
          {
            id: doc.id,
            filename: doc.filename,
            document_type: doc.document_type,
            content_type: doc.content_type,
            file_size: doc.file_size,
            uploaded_by: doc.uploaded_by&.full_name,
            created_at: doc.created_at
          }
        end
      end
    end
  end
end
