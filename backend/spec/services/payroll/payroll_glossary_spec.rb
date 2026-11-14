# frozen_string_literal: true

require "rails_helper"

# The plain payroll words live twice: here for the API and in
# frontend/src/lib/payrollTerms.ts for the pages. Chels hasn't confirmed the
# glossary (DESIGN.md §5), so a word will change; this keeps both sides in step.
RSpec.describe "Payroll glossary" do
  terms_file = Rails.root.join("../frontend/src/lib/payrollTerms.ts")

  # `key: 'Label',` lines inside `export const NAME ... = { ... }`.
  def frontend_map(source, name)
    block = source[/export const #{name}\b[^=]*= \{\n(.*?)\n\}/m, 1]
    raise "#{name} not found in payrollTerms.ts" unless block

    block.lines.to_h do |line|
      match = line.match(/\A\s*(\w+): (?:'([^']*)'|"([^"]*)"),?\s*\z/)
      raise "Unreadable line in #{name}: #{line.inspect}" unless match

      [ match[1], match[2] || match[3] ]
    end
  end

  let(:source) { File.read(terms_file) }

  it "labels every shift lifecycle status the resolver can return" do
    statuses = PayrollEntryProcessingEvent::STATUSES +
      %w[awaiting_approval not_payable ready_for_cutoff finalized payment_attested_pending_evidence] +
      Payroll::EntryProcessingSummary::PARTIAL_STATUSES.values + %w[partially_processed partially_allocated]

    expect(Payroll::EntryLifecycleResolver::LABELS.keys).to match_array(statuses.uniq)
    expect(Payroll::EntryLifecycleResolver::LABELS.values).to all(be_present)
  end

  it "uses the same lifecycle words as the frontend" do
    expect(frontend_map(source, "LIFECYCLE_LABELS")).to eq(Payroll::EntryLifecycleResolver::LABELS)
  end

  it "uses the same pay period words as the frontend" do
    expect(frontend_map(source, "HANDOFF_STATE_LABELS")).to eq(Payroll::PeriodHandoffState::LABELS)
  end

  it "uses the same word for payroll done outside the connection" do
    expect(frontend_map(source, "PAYROLL_WORDS").fetch("manualPayroll")).to eq(Payroll::EntryLifecycleResolver::MANUAL_PAYROLL_LABEL)
  end

  it "keeps the internal terms out of the labels" do
    labels = Payroll::EntryLifecycleResolver::LABELS.values + Payroll::PeriodHandoffState::LABELS.values
    expect(labels.grep(/cutoff|eligible|imported|committed|evidence|Cornerstone|Partially/i)).to be_empty
  end
end
