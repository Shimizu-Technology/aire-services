# frozen_string_literal: true

module Api
  module V1
    class ClientContactsController < BaseController
      before_action :authenticate_user!
      before_action :set_client

      # GET /api/v1/clients/:client_id/contacts
      def index
        contacts = @client.client_contacts.order(is_primary: :desc, created_at: :asc)
        render json: { contacts: contacts.map { |c| serialize_contact(c) } }
      end

      # POST /api/v1/clients/:client_id/contacts
      def create
        contact = @client.client_contacts.new(contact_params)
        if contact.save
          render json: { contact: serialize_contact(contact) }, status: :created
        else
          render json: { error: contact.errors.full_messages.join(", "), errors: contact.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/clients/:client_id/contacts/:id
      def update
        contact = @client.client_contacts.find(params[:id])
        if contact.update(contact_params)
          render json: { contact: serialize_contact(contact) }
        else
          render json: { error: contact.errors.full_messages.join(", "), errors: contact.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/clients/:client_id/contacts/:id
      def destroy
        contact = @client.client_contacts.find(params[:id])
        contact.destroy!
        head :no_content
      end

      private

      def set_client
        @client = Client.find(params[:client_id])
      end

      def contact_params
        params.require(:contact).permit(:first_name, :last_name, :email, :phone, :role, :is_primary)
      end

      def serialize_contact(contact)
        {
          id: contact.id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          full_name: contact.full_name,
          email: contact.email,
          phone: contact.phone,
          role: contact.role,
          is_primary: contact.is_primary,
          created_at: contact.created_at,
          updated_at: contact.updated_at
        }
      end
    end
  end
end
