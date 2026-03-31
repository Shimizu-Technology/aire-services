# frozen_string_literal: true

class ClientServiceType < ApplicationRecord
  belongs_to :client
  belongs_to :service_type

  validates :service_type_id, uniqueness: { scope: :client_id }
end
