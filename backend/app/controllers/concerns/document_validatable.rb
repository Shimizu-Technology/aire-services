# frozen_string_literal: true

module DocumentValidatable
  extend ActiveSupport::Concern

  ALLOWED_CONTENT_TYPES = %w[application/pdf image/jpeg image/png].freeze
  MAX_FILE_SIZE = 50.megabytes
  CONTENT_TYPE_EXTENSIONS = {
    "application/pdf" => %w[.pdf],
    "image/jpeg" => %w[.jpg .jpeg],
    "image/png" => %w[.png]
  }.freeze

  private

  def content_type_matches_extension?(content_type, filename)
    ext = File.extname(filename).downcase
    allowed_exts = CONTENT_TYPE_EXTENSIONS[content_type]
    allowed_exts.present? && allowed_exts.include?(ext)
  end
end
