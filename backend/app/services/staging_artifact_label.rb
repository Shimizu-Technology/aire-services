# frozen_string_literal: true

require "stringio"

class StagingArtifactLabel
  def self.mark(bytes, filename:, type: "")
    return bytes unless StagingOutboundPolicy.staging?
    extension = File.extname(filename.to_s).downcase
    return pdf(bytes) if extension == ".pdf" || type.to_s.include?("pdf")
    return StagingOutboundPolicy::LABEL.b + "\n".b + bytes.b if extension == ".csv" || type.to_s.include?("csv")
    if StagingStoragePolicy.shared? && (%w[.png .jpg .jpeg .webp].include?(extension) || %w[image/png image/jpeg image/webp].include?(type.to_s))
      return image(bytes)
    end
    return zip(bytes) if extension == ".zip" || type.to_s.include?("zip")
    # Machine-submittable bank/filing formats and unmarkable archives are held.
    raise StagingOutboundPolicy::Blocked, "#{StagingOutboundPolicy::LABEL}: this export format is disabled in staging"
  end

  def self.pdf(bytes)
    require "combine_pdf"
    source = CombinePDF.parse(bytes)
    raise StagingOutboundPolicy::Blocked, "#{StagingOutboundPolicy::LABEL}: PDF cannot be marked" if source.pages.empty?
    source.pages.each do |page|
      dimensions = page[:CropBox] || page[:MediaBox] || [ 0, 0, 612, 792 ]
      overlay = Prawn::Document.new(page_size: [ dimensions[2] - dimensions[0], dimensions[3] - dimensions[1] ])
      page << CombinePDF.parse(overlay.render).pages.first
    end
    source.to_pdf
  rescue CombinePDF::ParsingError, CombinePDF::EncryptionError
    raise StagingOutboundPolicy::Blocked, "#{StagingOutboundPolicy::LABEL}: PDF cannot be marked"
  end

  # Decode and re-encode raster bytes; never return unmarked source image data.
  def self.image(bytes)
    require "vips"
    source = Vips::Image.new_from_buffer(bytes, "", access: :sequential, fail_on: :error)
    unless %w[pngload_buffer jpegload_buffer webpload_buffer].include?(source.get("vips-loader")) && source.width * source.height <= 40_000_000
      raise StagingOutboundPolicy::Blocked, "#{StagingOutboundPolicy::LABEL}: image format or dimensions are disabled"
    end
    image = source.thumbnail_image(1800, height: 1800, size: :down).colourspace(:srgb)
    image = image.flatten(background: [ 255, 255, 255 ]) if image.has_alpha?
    width = [ image.width, 640 ].max
    image = image.gravity(:centre, width, image.height, extend: :white)
    footer = Vips::Image.black(width, 72, bands: 3).new_from_image([ 255, 240, 190 ]).copy(interpretation: :srgb)
    text = Vips::Image.text(StagingOutboundPolicy::LABEL, font: "DejaVu Sans Bold 22", width: width - 24, align: :centre, rgba: true)
    footer = footer.composite2(text, :over, x: (width - text.width) / 2, y: (72 - text.height) / 2)
    image.join(footer.flatten, :vertical).pngsave_buffer(strip: true)
  rescue Vips::Error
    raise StagingOutboundPolicy::Blocked, "#{StagingOutboundPolicy::LABEL}: image cannot be marked"
  end

  def self.zip(bytes)
    require "zip"
    input = Zip::InputStream.new(StringIO.new(bytes))
    output = Zip::OutputStream.write_buffer do |archive|
      while (entry = input.get_next_entry)
        next if entry.directory?
        archive.put_next_entry("STAGING_#{entry.name}")
        archive.write(mark(input.read, filename: entry.name))
      end
      archive.put_next_entry("STAGING_DO_NOT_ISSUE_OR_FILE.txt")
      archive.write(StagingOutboundPolicy::LABEL)
    end
    output.string
  rescue Zip::Error
    raise StagingOutboundPolicy::Blocked, "#{StagingOutboundPolicy::LABEL}: archive cannot be marked"
  ensure
    input&.close
  end
end
