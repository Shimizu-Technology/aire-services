# frozen_string_literal: true

require "zlib"

class StatusNotificationJob < ApplicationJob
  queue_as :default

  def perform(tax_return_id, workflow_stage_id)
    tax_return = TaxReturn.find_by(id: tax_return_id)
    return unless tax_return

    stage = WorkflowStage.find_by(id: workflow_stage_id)
    return unless stage

    lock_key = Zlib.crc32("status_notif:#{tax_return_id}:#{workflow_stage_id}")

    ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(#{lock_key})")

    already_sent = Notification.where(
      tax_return_id: tax_return_id,
      template: "status_changed",
      status: "sent"
    ).where("content LIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(stage.name)}%")
     .where("created_at > ?", 5.minutes.ago)
     .exists?

    return if already_sent

    NotificationService.notify_status_change(
      tax_return: tax_return,
      new_stage: stage
    )
  end
end
