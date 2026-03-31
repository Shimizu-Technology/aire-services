# frozen_string_literal: true

module Api
  module V1
    module Clients
      class NotesController < BaseController
        before_action :authenticate_user!
        before_action :require_staff!
        before_action :set_client

        # GET /api/v1/clients/:client_id/notes
        def index
          notes = @client.client_notes.active.recent_first
          render json: { notes: notes.map { |n| serialize_note(n) } }
        end

        # DELETE /api/v1/clients/:client_id/notes/:id
        def destroy
          note = @client.client_notes.active.find_by(id: params[:id])
          return render json: { error: 'Note not found' }, status: :not_found unless note

          note.soft_delete!
          head :no_content
        end

        private

        def set_client
          @client = Client.find(params[:client_id])
        end

        def serialize_note(note)
          {
            id: note.id,
            content: note.content,
            category: note.category,
            created_at: note.created_at,
            updated_at: note.updated_at
          }
        end
      end
    end
  end
end
