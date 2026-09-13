# frozen_string_literal: true

module Payroll
  class SettlementCaseRouter
    class RoutingError < StandardError; end

    def initialize(settlement_case:, destination_kind:, target_external_pay_period_id:, action_due_on:,
                   assigned_to_id:, reason:, actor:)
      @settlement_case = settlement_case
      @destination_kind = destination_kind.to_s.strip
      @target_external_pay_period_id = target_external_pay_period_id.to_s.strip
      @action_due_on = parse_date(action_due_on)
      @assigned_to_id = assigned_to_id.presence
      @reason = reason.to_s.strip
      @actor = actor
    end

    def call
      raise RoutingError, "This settlement case is already closed" unless settlement_case.status.in?(PayrollSettlementCase::ACTIVE_STATUSES)
      raise RoutingError, "destination_kind must be regular, supplemental, or not_payable" unless destination_kind.in?(%w[regular supplemental not_payable])
      raise RoutingError, "A routing reason is required" if reason.blank?

      attributes, target_period = destination_attributes
      assignee = assigned_to
      previous_destination = settlement_case.destination_kind
      Payroll::SettlementCaseCoordinator.transition!(
        settlement_case,
        **attributes,
        assigned_to: assignee,
        resolution_note: reason,
        event_type: destination_kind == "not_payable" ? "marked_not_payable" : (previous_destination == "unassigned" ? "routed" : "rerouted"),
        actor: actor,
        metadata: {
          previous_destination_kind: previous_destination,
          destination_kind: destination_kind,
          target_external_pay_period_id: target_period&.external_pay_period_id || target_external_pay_period_id.presence,
          assigned_to_user_id: assignee&.id,
          action_due_on: attributes.fetch(:action_due_on).iso8601,
          reason: reason
        }.compact
      )
    end

    private

    attr_reader :settlement_case, :destination_kind, :target_external_pay_period_id,
                :action_due_on, :assigned_to_id, :reason, :actor

    def destination_attributes
      case destination_kind
      when "regular"
        period = PayrollCalendarPeriod.find_by!(external_pay_period_id: target_external_pay_period_id)
        retryable = period.status == "failed" && period.next_finalization_attempt_at.present?
        eligible = period.status == "scheduled" || retryable
        unless eligible && period.start_date > settlement_case.origin_payroll_batch.end_date
          raise RoutingError, "Choose a future, unfinalized regular payroll period"
        end
        [
          {
            status: "scheduled",
            destination_kind: "regular",
            target_payroll_calendar_period: period,
            target_external_pay_period_id: period.external_pay_period_id,
            action_due_on: action_due_on || period.pay_date,
            included_payroll_batch: nil,
            resolved_at: nil
          },
          period
        ]
      when "supplemental"
        raise RoutingError, "Name the Cornerstone supplemental payroll" if target_external_pay_period_id.blank?
        raise RoutingError, "Choose the supplemental payment due date" unless action_due_on

        [
          {
            status: "scheduled",
            destination_kind: "supplemental",
            target_payroll_calendar_period: nil,
            target_external_pay_period_id: target_external_pay_period_id,
            action_due_on: action_due_on,
            included_payroll_batch: nil,
            resolved_at: nil
          },
          nil
        ]
      when "not_payable"
        [
          {
            status: "not_payable",
            destination_kind: "not_payable",
            target_payroll_calendar_period: nil,
            target_external_pay_period_id: nil,
            action_due_on: action_due_on || Date.current,
            included_payroll_batch: nil,
            resolved_at: Time.current
          },
          nil
        ]
      end
    rescue ActiveRecord::RecordNotFound
      raise RoutingError, "The selected regular payroll period was not found"
    end

    def assigned_to
      return settlement_case.assigned_to unless assigned_to_id

      user = User.admins.where(is_active: true, personal_access_enabled: true).find_by(id: assigned_to_id)
      raise RoutingError, "The case owner must be an active AIRE administrator" unless user

      user
    end

    def parse_date(value)
      return if value.blank?

      Date.iso8601(value.to_s)
    rescue Date::Error
      raise RoutingError, "action_due_on must use YYYY-MM-DD"
    end
  end
end
