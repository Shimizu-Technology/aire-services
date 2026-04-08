# frozen_string_literal: true

module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = find_verified_user
    end

    private

    def find_verified_user
      token = request.params[:token]
      reject_unauthorized_connection unless token.present?

      decoded = ClerkAuth.verify(token)
      reject_unauthorized_connection unless decoded

      clerk_id = decoded["sub"]
      user = User.find_by(clerk_id: clerk_id)
      reject_unauthorized_connection unless user&.admin?

      user
    end
  end
end
