# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollImportBatch, type: :model do
  describe "validations" do
    subject { build(:payroll_import_batch) }

    it { is_expected.to be_valid }

    it "requires idempotency_key" do
      subject.idempotency_key = nil
      expect(subject).not_to be_valid
      expect(subject.errors[:idempotency_key]).to include("can't be blank")
    end

    it "requires source_payroll_run_id" do
      subject.source_payroll_run_id = nil
      expect(subject).not_to be_valid
      expect(subject.errors[:source_payroll_run_id]).to include("can't be blank")
    end

    it "requires payload" do
      subject.payload = nil
      expect(subject).not_to be_valid
    end

    it "enforces unique idempotency_key" do
      create(:payroll_import_batch, idempotency_key: "dup-key")
      dup = build(:payroll_import_batch, idempotency_key: "dup-key")
      expect(dup).not_to be_valid
      expect(dup.errors[:idempotency_key]).to include("has already been taken")
    end

    it "validates status inclusion" do
      subject.status = "invalid"
      expect(subject).not_to be_valid
      expect(subject.errors[:status]).to be_present
    end

    it "rejects negative totals" do
      subject.total_gross = -1
      expect(subject).not_to be_valid
    end
  end

  describe "scopes" do
    it ".recent_first orders by created_at desc" do
      old = create(:payroll_import_batch)
      recent = create(:payroll_import_batch)
      expect(PayrollImportBatch.recent_first.pluck(:id)).to eq([recent.id, old.id])
    end

    it ".by_status filters by status" do
      reconciled = create(:payroll_import_batch, :reconciled)
      _failed = create(:payroll_import_batch, :failed)
      expect(PayrollImportBatch.by_status("reconciled").pluck(:id)).to eq([reconciled.id])
    end
  end
end
