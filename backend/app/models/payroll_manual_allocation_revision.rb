# frozen_string_literal: true

class PayrollManualAllocationRevision < ApplicationRecord
  def readonly?
    persisted?
  end
end
