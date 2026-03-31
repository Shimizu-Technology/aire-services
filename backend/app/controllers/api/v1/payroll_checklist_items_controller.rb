# frozen_string_literal: true

module Api
  module V1
    class PayrollChecklistItemsController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_item
      before_action :authorize_item_update!

      # PATCH /api/v1/payroll_checklists/items/:id/toggle
      def toggle
        done = ActiveModel::Type::Boolean.new.cast(params[:done])

        attrs = if done
          {
            status: "done",
            completed_at: (@item.completed_at || Time.current),
            completed_by_id: (@item.completed_by_id || current_user.id)
          }
        else
          {
            status: "not_started",
            completed_at: nil,
            completed_by_id: nil
          }
        end

        unless @item.update(attrs)
          return render json: { error: @item.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end

        AuditLog.log(
          auditable: @item,
          action: "updated",
          user: current_user,
          metadata: done ? "Checklist step marked done" : "Checklist step reopened"
        )

        render json: { item: serialize_item(@item.reload) }
      end

      # PATCH /api/v1/payroll_checklists/items/:id
      def update
        unless @item.update(item_params)
          return render json: { error: @item.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end

        AuditLog.log(
          auditable: @item,
          action: "updated",
          user: current_user,
          metadata: "Checklist step note/proof updated"
        )
        render json: { item: serialize_item(@item) }
      end

      private

      def set_item
        @item = OperationTask
          .includes(:completed_by, operation_cycle: :operation_template)
          .joins(operation_cycle: :operation_template)
          .where(operation_templates: { category: "payroll" })
          .find(params[:id])
      end

      def authorize_item_update!
        return if current_user.admin?
        return if @item.assigned_to_id.blank? && current_user.staff?
        return if @item.assigned_to_id.present? && @item.assigned_to_id == current_user.id

        render json: { error: "Only admins or assigned staff can update this checklist item" }, status: :forbidden
      end

      def item_params
        params.permit(:note, :proof_url).to_h.transform_keys do |key|
          key == "note" ? "notes" : key
        end
      end

      def serialize_item(item)
        {
          id: item.id,
          done: item.status == "done",
          completed_at: item.completed_at&.iso8601,
          completed_by: item.completed_by ? { id: item.completed_by.id, name: item.completed_by.full_name } : nil,
          note: item.notes,
          proof_url: item.proof_url
        }
      end
    end
  end
end
