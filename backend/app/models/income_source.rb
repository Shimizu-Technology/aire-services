# frozen_string_literal: true

class IncomeSource < ApplicationRecord
  belongs_to :tax_return

  # Expanded list of income source types
  VALID_TYPES = %w[
    w2 1099 1099_misc 1099_int 1099_div 1099_nec 1099_r 1099_ssa
    business rental investment retirement social_security other
  ].freeze

  validates :source_type, inclusion: { in: VALID_TYPES }, allow_blank: true
  validates :payer_name, presence: true
end
