# frozen_string_literal: true

module Api
  module V1
    module Portal
      class NotesController < BaseController
        # GET /api/v1/portal/notes
        def index
          notes = current_client.client_notes.active.recent_first
          render json: { notes: notes.map { |n| serialize_note(n) } }
        end

        # POST /api/v1/portal/notes
        def create
          note = current_client.client_notes.build(note_params)
          if note.save
            render json: { note: serialize_note(note) }, status: :created
          else
            render json: { errors: note.errors.full_messages }, status: :unprocessable_entity
          end
        end

        # DELETE /api/v1/portal/notes/:id
        def destroy
          note = current_client.client_notes.active.find_by(id: params[:id])
          return render json: { error: "Note not found" }, status: :not_found unless note

          note.soft_delete!
          head :no_content
        end

        private

        def note_params
          params.require(:note).permit(:content, :category)
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
