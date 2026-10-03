# frozen_string_literal: true

class PayrollPaymentAttestationEvent < ApplicationRecord
  belongs_to :payroll_payment_attestation
  belongs_to :actor, class_name: "User"

  validates :event_type, inclusion: { in: %w[attested retracted] }
  validates :occurred_at, :reason, presence: true

  def readonly?
    persisted?
  end
end
