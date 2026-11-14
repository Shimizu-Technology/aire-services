# frozen_string_literal: true

module Reports
  # Both documents distinguish approval waiting from the included selection's
  # category checks. Category readiness alone never makes a draft payroll-ready.
  class HoursReportDisclosure
    ISSUE_LABELS = {
      pending_count: "pending approval", denied_count: "denied",
      pending_overtime_count: "pending overtime review", denied_overtime_count: "denied overtime",
      open_clock_count: "open clock"
    }.freeze

    APPROVAL_FACTS_NOTE = "Approved and waiting hours are period facts and ignore status filters; worked hours follow the filters."

    def self.filtered_status?(report)
      filters = (report[:filters] || {}).symbolize_keys
      report[:filtered_summary] || (!filters[:approval_status].to_s.in?([ "", "approved_or_standard" ]) || filters[:overtime_status].present?)
    end

    def self.filtered_label(report, label)
      filtered_status?(report) ? "Filtered — #{label}" : label
    end

    def initialize(report:, export:)
      @report = report
      @export = export
    end

    def render(pdf)
      waiting = waiting_description
      warning = waiting.present? || summary[:open_clock_count].to_i.positive? || @export.readiness_status != "complete"
      title = if waiting.present?
        "Draft — #{waiting} Only approved hours are included."
      elsif summary[:open_clock_count].to_i.positive?
        "Draft — open clocks still need review. Only approved hours are included."
      elsif @export.readiness_status != "complete"
        "Draft — category or overnight time review needed. Only approved hours are included."
      else
        "Included hours ready — nothing is waiting for approval."
      end
      if summary[:entries_count].to_i.zero?
        title = warning ? "#{title} No included entries match this selection." : "No included entries match this selection."
      end
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

    def waiting_description
      hours = summary[:payroll_hours] || {}
      parts = []
      if hours[:time_waiting_hours].to_f.positive?
        count = summary[:pending_count].to_i
        parts << (count.positive? ? "#{count} #{count == 1 ? 'shift' : 'shifts'}" : "#{format('%.2f', hours[:time_waiting_hours])}h of time")
      end
      parts << "#{format('%.2f', hours[:overtime_waiting_hours])}h of overtime" if hours[:overtime_waiting_hours].to_f.positive?
      return if parts.empty?

      plural_shifts = hours[:time_waiting_hours].to_f.positive? && summary[:pending_count].to_i > 1
      "#{parts.join(' and ')} #{parts.many? || plural_shifts ? 'are' : 'is'} still waiting for approval."
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
