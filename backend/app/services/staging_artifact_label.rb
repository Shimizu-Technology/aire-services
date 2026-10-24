# frozen_string_literal: true

require "stringio"

class StagingArtifactLabel
  def self.mark(bytes, filename:, type: "")
    return bytes unless StagingOutboundPolicy.staging?
    extension = File.extname(filename.to_s).downcase
    return bytes if extension == ".pdf" || type.to_s.include?("pdf") # Prawn serialization applies the watermark.
    return "#{StagingOutboundPolicy::LABEL}\n#{bytes}" if extension == ".csv" || type.to_s.include?("csv")

    # Machine-submittable bank/filing formats and unmarkable archives are held.
    raise StagingOutboundPolicy::Blocked, "#{StagingOutboundPolicy::LABEL}: this export format is disabled in staging"
  end
end
