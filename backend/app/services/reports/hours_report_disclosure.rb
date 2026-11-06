# frozen_string_literal: true

module Reports
  # Both documents describe the same captured selection. Readiness concerns
  # category review; excluded/unresolved work must remain visible separately.
  class HoursReportDisclosure
    ISSUE_LABELS = {
      pending_count: "pending approval", denied_count: "denied",
      pending_overtime_count: "pending overtime review", denied_overtime_count: "denied overtime",
      open_clock_count: "open clock"
    }.freeze

    def initialize(report:, export:)
      @report = report
      @export = export
    end

    def render(pdf)
      complete = @export.readiness_status == "complete"
      period_review = ISSUE_LABELS.keys.any? { |key| summary[key].to_i.positive? }
      warning = !complete || period_review
      title = complete && period_review ? "Included hours ready - period review remains" :
        (complete ? "Included hours ready - category checks passed" : "Draft - category review needed")
      pdf.table([
        [ title ],
        [ "#{summary[:entries_count].to_i} included entries; #{summary[:excluded_entries_count].to_i} excluded entries in the selected staff/date scope." ],
        [ "Period review: #{issues(summary)}. Excluded work: #{issues(summary[:excluded_issues] || {})}." ]
      ], width: pdf.bounds.width, cell_style: {
        borders: [], padding: [ 5, 12 ], size: 8, text_color: "5F6F78",
        background_color: warning ? "FFFBEB" : "ECFDF5"
      }) do |table|
        table.row(0).font_style = :bold
        table.row(0).size = 10
        table.row(0).text_color = warning ? "92400E" : "047857"
      end
      pdf.move_down 7
      pdf.fill_color "5F6F78"
      pdf.text "Scope and filters: #{filter_description}. Counts refer to the selected staff/date scope. Review counts can overlap; excluded entries are counted once.", size: 7.5, leading: 2
      pdf.move_down 12
    end

    private

    def summary
      @report[:summary] || {}
    end

    def issues(values)
      labels = ISSUE_LABELS.filter_map { |key, label| "#{values[key]} #{label}" if values[key].to_i.positive? }
      labels.presence&.join(", ") || "no pending, denied, or open entries"
    end

    def filter_description
      filters = @report[:filters] || {}
      labels = filters.filter_map do |key, value|
        next if value.blank?

        label = case key.to_sym
        when :user_id then "Employee ID"
        when :time_category_id then "Category ID"
        when :approval_group then "Department"
        else key.to_s.humanize
        end
        "#{label}: #{value.to_s.humanize}"
      end
      labels.presence&.join("; ") || "all staff, all entry filters"
    end
  end
end
