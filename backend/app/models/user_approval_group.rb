# frozen_string_literal: true

class UserApprovalGroup < ApplicationRecord
  belongs_to :user

  validates :approval_group, presence: true
  validate :approval_group_must_be_configured

  private

  def approval_group_must_be_configured
    return if approval_group.blank?
    return if Setting.approval_group_keys.include?(approval_group)

    errors.add(:approval_group, "must match a configured approval group")
  end
end
