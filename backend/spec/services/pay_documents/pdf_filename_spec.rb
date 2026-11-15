# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayDocuments::PdfFilename do
  it "keeps a readable name and date while removing path and header characters" do
    worker = build_stubbed(:user, first_name: "ÉtHan /", last_name: "Cruz\r\n.pdf")
    expect(described_class.for(worker: worker, date: "2026-11-17")).to eq("AIRE-pay-stub-EtHan-Cruz-pdf-2026-11-17.pdf")
  end

  it "falls back to the person ID for names without filename characters" do
    worker = build_stubbed(:user, first_name: "///", last_name: "...")
    expect(described_class.for(worker: worker, date: "2026-11-17")).to eq("AIRE-pay-stub-Person-#{worker.id}-2026-11-17.pdf")
  end
end
