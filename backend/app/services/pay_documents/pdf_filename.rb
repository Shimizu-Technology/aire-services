# frozen_string_literal: true

module PayDocuments
  module PdfFilename
    def self.for(worker:, date:)
      name = worker.full_name.to_s.parameterize(separator: "-", preserve_case: true).first(100).delete_suffix("-")
      name = "Person-#{worker.id}" if name.blank?
      "AIRE-pay-stub-#{name}-#{date.to_s.parameterize}.pdf"
    end
  end
end
