# frozen_string_literal: true

module Reports
  module PdfTypography
    FONT_FAMILY = "AireSans"
    FONT_DIRECTORY = Rails.root.join("app/assets/fonts/inter")

    module_function

    def apply(pdf)
      pdf.font_families.update(
        FONT_FAMILY => {
          normal: FONT_DIRECTORY.join("regular.ttf").to_s,
          bold: FONT_DIRECTORY.join("bold.ttf").to_s
        }
      )
      pdf.font FONT_FAMILY
    end
  end
end
