# frozen_string_literal: true

module Payroll
  # An allowlist projection of Cornerstone statement payloads for the signed-in
  # worker. Unknown keys are dropped so identifiers such as SSNs or full bank
  # numbers cannot pass through even if a future Cornerstone payload adds them.
  class MyPayPresenter
    EMPLOYMENT_TYPES = %w[hourly salary contractor].freeze
    PAYMENT_METHODS = %w[paper_check direct_deposit].freeze
    PAYMENT_STATUSES = %w[pending prepared issued voided].freeze
    EARNING_KINDS = %w[regular overtime holiday pto bonus other].freeze
    SOURCE_KINDS = %w[current carryover correction].freeze
    MONEY = /\A-?\d{1,9}\.\d{2}\z/
    QUANTITY = /\A-?\d{1,6}(?:\.\d{1,4})?\z/
    DATE = /\A\d{4}-\d{2}-\d{2}\z/
    OVERTIME_WORDING = /over\s*-?\s*time|\bOT\b|over\s*40/i
    CONTRACTOR_EARNING_LABEL = "Contract hours"
    # Earning labels can carry the stub's work-date note on a second line.
    LABEL_LIMIT = 240

    def initialize(user:)
      @user = user
    end

    def worker(payload)
      worker = payload.is_a?(Hash) ? payload : {}
      employment_type = EMPLOYMENT_TYPES.include?(worker["employment_type"]) ? worker["employment_type"] : nil
      {
        employment_type: employment_type,
        contractor: worker["contractor"] == true || employment_type == "contractor"
      }
    end

    def list(payload)
      statements = payload.fetch("statements").filter_map { |row| summary(row) }
      { worker: worker(payload["worker"]), statements: statements }
    end

    def summary(row)
      return unless row.is_a?(Hash) && WorkerStatementsClient.valid_statement_id?(row["id"])

      period = row["pay_period"].is_a?(Hash) ? row["pay_period"] : {}
      {
        id: row["id"].to_s,
        pay_date: date(period["pay_date"]) || date(row["check_date"]),
        check_date: date(row["check_date"]),
        period_start: date(period["start_date"]),
        period_end: date(period["end_date"]),
        run_purpose: run_purpose(period["run_purpose"]),
        gross_pay: money(row["gross_pay"]),
        net_pay: money(row["net_pay"]),
        total_hours: quantity(row["total_hours"]),
        payment: payment(row["payment"]),
        has_source_entries: row["has_source_entries"] == true
      }
    end

    def detail(payload, worker:)
      row = payload["statement"].is_a?(Hash) ? payload["statement"] : payload
      base = summary(row)
      return unless base

      contractor = worker.fetch(:contractor)
      ytd = row["ytd"].is_a?(Hash) ? row["ytd"] : {}
      base.merge(
        earnings: earnings(lines(row["earnings"]), contractor: contractor),
        # Contractors are paid without withholding; never render a tax table.
        taxes: contractor ? [] : lines(row["taxes"]).filter_map { |line| withholding(line) },
        deductions: lines(row["deductions"]).filter_map { |line| withholding(line) },
        # Non-taxable additions such as reimbursements; added after taxes and
        # deductions, so net = gross - taxes - deductions + other pay.
        other_pay: lines(row["other_pay"]).filter_map { |line| withholding(line) },
        ytd: { gross: money(ytd["gross"]), net: money(ytd["net"]) },
        hours_on_check: hours_on_check(lines(row["source_entries"]), base, contractor: contractor)
      )
    end

    private

    attr_reader :user

    def payment(value)
      value = {} unless value.is_a?(Hash)
      last4 = value["check_number_last4"].to_s
      {
        method: PAYMENT_METHODS.include?(value["method"]) ? value["method"] : nil,
        status: PAYMENT_STATUSES.include?(value["status"]) ? value["status"] : "pending",
        issued_on: date(value["issued_on"]),
        # Only ever the last four digits of a check number; never account data.
        check_number_last4: last4.match?(/\A\d{1,4}\z/) ? last4 : nil
      }
    end

    def earnings(rows, contractor:)
      lines = rows.filter_map { |line| earning(line) }
      contractor ? contractor_earnings(lines) : lines
    end

    def earning(line)
      return unless line.is_a?(Hash) && (amount = money(line["amount"]))

      kind = EARNING_KINDS.include?(line["kind"]) ? line["kind"] : "other"
      label = text(line["label"], limit: LABEL_LIMIT) || kind.humanize
      { label: label, hours: quantity(line["hours"]), rate: quantity(line["rate"]), amount: amount, kind: kind }
    end

    # Contractors are paid their contract rate for every hour, so their pay is
    # never described as overtime. An older check can still carry a saved
    # "... OT" row. Paid at the same rate as a matching row, it is folded into
    # that row, as current payroll prints it. Paid at a higher rate, it keeps
    # its actual rate and amount and says plainly what that rate was.
    def contractor_earnings(lines)
      flagged, plain = lines.partition { |line| line[:kind] == "overtime" || line[:label].match?(OVERTIME_WORDING) }
      result = plain.map(&:dup)
      contract_rates = plain.filter_map { |line| line[:rate] && BigDecimal(line[:rate]) }.select(&:positive?)
      flagged.each do |line|
        line = line.merge(kind: line[:kind] == "overtime" ? "regular" : line[:kind], label: contractor_label(line[:label]))
        target = result.find { |row| row[:label] == line[:label] && row[:rate] && row[:rate] == line[:rate] && row[:hours] && line[:hours] }
        if target
          target[:hours] = quantity(BigDecimal(target[:hours]) + BigDecimal(line[:hours]))
          target[:amount] = format("%.2f", BigDecimal(target[:amount]) + BigDecimal(line[:amount]))
        else
          note = higher_rate_note(line[:rate], contract_rates)
          result << (note ? line.merge(note: note) : line)
        end
      end
      result
    end

    def contractor_label(label)
      cleaned = label.split("\n").map { |part| part.gsub(OVERTIME_WORDING, " ").squish.sub(/\A[\s·,:\-–]+/, "").sub(/[\s·,:\-–]+\z/, "") }
        .reject(&:blank?).join("\n")
      cleaned.blank? || cleaned.casecmp?("contract") ? CONTRACTOR_EARNING_LABEL : cleaned
    end

    def higher_rate_note(rate, contract_rates)
      return if rate.nil? || contract_rates.empty?

      rate = BigDecimal(rate)
      base = contract_rates.max
      return unless rate > base

      # The saved rate is rounded to cents, so 1.5 x 9.25 is printed as 13.88.
      if (rate - (base * BigDecimal("1.5"))).abs <= BigDecimal("0.01")
        "Paid at 1.5× your contract rate"
      else
        "Paid at a higher rate than your contract rate"
      end
    end

    def withholding(line)
      return unless line.is_a?(Hash) && (amount = money(line["amount"]))

      { label: text(line["label"]) || "Other", amount: amount, ytd: money(line["ytd"]) }
    end

    # Cornerstone's source entries are mapped back to this user's own AIRE
    # time entries only. Another worker's entry ID is never linked.
    def hours_on_check(rows, statement, contractor:)
      rows = rows.select { |row| row.is_a?(Hash) && row["source_time_entry_id"].to_s.match?(/\A[1-9]\d{0,17}\z/) }
      ids = rows.map { |row| row["source_time_entry_id"].to_i }.uniq
      own_entries = ids.empty? ? {} : user.time_entries.includes(:time_category).where(id: ids).index_by(&:id)
      rows.map do |row|
        entry = own_entries[row["source_time_entry_id"].to_i]
        work_date = date(row["work_date"]) || entry&.work_date&.iso8601
        regular = BigDecimal(quantity(row["regular_hours"]) || "0")
        overtime = BigDecimal(quantity(row["overtime_hours"]) || "0")
        total = quantity(row["hours"]) || quantity(regular + overtime)
        source_kind = SOURCE_KINDS.include?(row["source_kind"]) ? row["source_kind"] : "current"
        line = {
          time_entry_id: entry&.id,
          work_date: work_date,
          category: entry&.time_category&.name || text(row["category"]),
          total_hours: format("%.2f", BigDecimal(total))
        }
        # Contractors are paid one flat rate for every hour; AIRE's own
        # regular/over-40 split is not part of their statement.
        line.merge!(regular_hours: format("%.2f", regular), overtime_hours: format("%.2f", overtime)) unless contractor
        line.merge(source_kind: source_kind, prior_period: prior_period?(source_kind, work_date, statement))
      end.sort_by { |row| [ row[:work_date].to_s, row[:time_entry_id].to_i ] }
    end

    def prior_period?(source_kind, work_date, statement)
      return true unless source_kind == "current"
      return false unless work_date && statement[:period_start]

      work_date < statement[:period_start]
    end

    def lines(value)
      value.is_a?(Array) ? value : []
    end

    def money(value)
      string = value.is_a?(Numeric) ? format("%.2f", value) : value.to_s
      string.match?(MONEY) ? string : nil
    end

    def quantity(value)
      return if value.nil? || value == ""

      string = value.is_a?(Numeric) ? BigDecimal(value.to_s).round(4).to_s("F") : value.to_s
      return unless string.match?(QUANTITY)

      # At least two decimals ("8.00", "18.375") without inventing precision.
      whole, fraction = BigDecimal(string).to_s("F").split(".")
      "#{whole}.#{fraction.to_s.ljust(2, '0')}"
    end

    def date(value)
      string = value.to_s
      return unless string.match?(DATE)

      Date.iso8601(string).iso8601
    rescue Date::Error
      nil
    end

    def run_purpose(value)
      string = value.to_s
      string.match?(/\A[a-z_]{1,40}\z/) ? string : nil
    end

    # Keeps single line breaks (the stub's work-date notes) and drops blank
    # lines and stray whitespace.
    def text(value, limit: 120)
      string = value.to_s.split(/\r\n?|\n/).map(&:squish).reject(&:empty?).join("\n")
      string.presence&.slice(0, limit)
    end
  end
end
