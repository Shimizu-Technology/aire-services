class ClientContact < ApplicationRecord
  belongs_to :client

  validates :first_name, presence: true
  validates :last_name, presence: true

  scope :primary_first, -> { order(is_primary: :desc, created_at: :asc) }

  def full_name
    "#{first_name} #{last_name}".strip
  end
end
