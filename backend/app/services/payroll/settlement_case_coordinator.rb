# frozen_string_literal: true

module Payroll
  class SettlementCaseCoordinator
    AUTO_ROUTE_REASONS = (PayrollBatchExclusion::CARRYOVER_REASONS + %w[changed_after_cutoff deleted_after_cutoff]).freeze

    class << self
      def prepare_for_period!(period)
        route_open_cases_to_period!(period)
      end

      def sync_finalized_periods!
        PayrollCalendarPeriod.where(status: "finalized").includes(:payroll_batch).find_each do |period|
          record_missing_exclusion_cases!(period)
          record_post_cutoff_entries!(period)
        end
      end

      def finalize_period!(period:, batch:, actor:)
        targeted = PayrollSettlementCase.active.where(target_payroll_calendar_period: period).lock.to_a
        included_ids = batch.payroll_batch_entries.distinct.pluck(:source_time_entry_id)
        excluded_ids = batch.payroll_batch_exclusions.distinct.pluck(:source_time_entry_id)

        targeted.each do |settlement_case|
          if included_ids.include?(settlement_case.source_time_entry_id)
            transition!(
              settlement_case,
              status: "in_payroll",
              included_payroll_batch: batch,
              event_type: "included",
              actor: actor,
              metadata: { payroll_batch_id: batch.public_id }
            )
          elsif excluded_ids.include?(settlement_case.source_time_entry_id)
            transition!(
              settlement_case,
              status: "superseded",
              resolved_at: Time.current,
              event_type: "superseded",
              actor: actor,
              metadata: { payroll_batch_id: batch.public_id, reason: "held_again_at_target_cutoff" }
            )
          else
            transition!(
              settlement_case,
              status: "open",
              destination_kind: "unassigned",
              target_payroll_calendar_period: nil,
              target_external_pay_period_id: nil,
              action_due_on: period.pay_date,
              event_type: "rerouted",
              actor: actor,
              metadata: { payroll_batch_id: batch.public_id, reason: "no_settlement_delta_at_target_cutoff" }
            )
          end
        end

        batch.payroll_batch_exclusions.order(:id).each do |exclusion|
          superseded = targeted.find { |settlement_case| settlement_case.source_time_entry_id == exclusion.source_time_entry_id }
          create_for_exclusion!(period: period, batch: batch, exclusion: exclusion, actor: actor, supersedes_case: superseded)
        end
      end

      def route_open_cases_to_period!(period)
        return if period.status == "finalized"

        PayrollSettlementCase
          .where(status: "open", destination_kind: "unassigned", origin_reason: AUTO_ROUTE_REASONS)
          .joins(:origin_payroll_batch)
          .where("payroll_batches.end_date < ?", period.start_date)
          .lock
          .find_each do |settlement_case|
            route_to_period!(settlement_case, period: period, actor: nil, reason: "Next published regular payroll")
          end
      end

      def record_entry!(entry, previous_work_date: nil)
        relevant_periods_for(entry, previous_work_date: previous_work_date).each do |period|
          next unless entry.created_at > period.cutoff_at || entry.updated_at > period.cutoff_at
          next if PayrollSettlementCase.active.exists?(origin_payroll_batch: period.payroll_batch, source_time_entry_id: entry.id)

          represented = period.payroll_batch.payroll_batch_entries.where(source_time_entry_id: entry.id).sum(:total_hours)
          reason = entry.created_at > period.cutoff_at && represented.zero? ? "created_after_cutoff" : "changed_after_cutoff"
          held_hours = if reason == "changed_after_cutoff"
            current_payable_hours = if entry.work_date.in?(period.start_date..period.end_date) && entry.counts_toward_hours?
              entry.hours.to_d
            else
              0.to_d
            end
            (current_payable_hours - represented.to_d).abs
          else
            entry.hours.to_d
          end
          create_case!(
            period: period,
            origin_batch: period.payroll_batch,
            source_time_entry_id: entry.id,
            source_time_entry_version: entry.lock_version,
            source_user_id: entry.user_id,
            source_user_uuid: entry.user&.payroll_integration_uuid,
            reason: reason,
            work_date: entry.work_date,
            held_hours: held_hours,
            source_snapshot: snapshot_for(entry),
            actor: Current.user
          )
        end
      end

      def record_deletion!(entry, actor:)
        relevant_periods_for(entry, previous_work_date: nil).each do |period|
          next unless period.payroll_batch.payroll_batch_entries.exists?(source_time_entry_id: entry.id)

          previous_case = PayrollSettlementCase.active.find_by(
            origin_payroll_batch: period.payroll_batch,
            source_time_entry_id: entry.id
          )
          if previous_case
            transition!(
              previous_case,
              status: "superseded",
              resolved_at: Time.current,
              event_type: "superseded",
              actor: actor,
              metadata: { reason: "source_time_entry_deleted" }
            )
          end
          represented = period.payroll_batch.payroll_batch_entries.where(source_time_entry_id: entry.id).sum(:total_hours).abs
          create_case!(
            period: period,
            origin_batch: period.payroll_batch,
            source_time_entry_id: entry.id,
            source_time_entry_version: entry.lock_version,
            source_user_id: entry.user_id,
            source_user_uuid: entry.user&.payroll_integration_uuid,
            reason: "deleted_after_cutoff",
            work_date: entry.work_date,
            held_hours: represented,
            source_snapshot: snapshot_for(entry),
            actor: actor,
            supersedes_case: previous_case
          )
        end
      end

      def transition!(settlement_case, status:, event_type:, actor:, metadata: {}, occurred_at: Time.current, **attributes)
        from_status = settlement_case.status
        settlement_case.update!(attributes.merge(status: status))
        settlement_case.payroll_settlement_case_events.create!(
          event_id: SecureRandom.uuid,
          actor: actor,
          actor_payroll_integration_uuid: actor&.payroll_integration_uuid,
          event_type: event_type,
          from_status: from_status,
          to_status: settlement_case.status,
          occurred_at: occurred_at,
          metadata: metadata
        )
        settlement_case
      end

      def route_to_period!(settlement_case, period:, actor:, reason:)
        transition!(
          settlement_case,
          status: "scheduled",
          destination_kind: "regular",
          target_payroll_calendar_period: period,
          target_external_pay_period_id: period.external_pay_period_id,
          action_due_on: period.pay_date,
          resolution_note: reason,
          event_type: settlement_case.destination_kind == "unassigned" ? "routed" : "rerouted",
          actor: actor,
          metadata: {
            destination_kind: "regular",
            target_external_pay_period_id: period.external_pay_period_id,
            reason: reason
          }
        )
      end

      private

      def record_missing_exclusion_cases!(period)
        period.payroll_batch.payroll_batch_exclusions.includes(:payroll_batch).find_each do |exclusion|
          create_for_exclusion!(period: period, batch: period.payroll_batch, exclusion: exclusion, actor: nil)
        end
      end

      def record_post_cutoff_entries!(period)
        TimeEntry
          .joins(:user)
          .merge(User.staff)
          .where(work_date: period.start_date..period.end_date)
          .where("time_entries.created_at > :cutoff OR time_entries.updated_at > :cutoff", cutoff: period.cutoff_at)
          .includes(:user, :time_category)
          .find_each { |entry| record_entry!(entry) }
      end

      def create_for_exclusion!(period:, batch:, exclusion:, actor:, supersedes_case: nil)
        existing = PayrollSettlementCase.find_by(origin_payroll_batch_exclusion: exclusion)
        return existing if existing

        snapshot = exclusion.snapshot || {}
        create_case!(
          period: period,
          origin_batch: batch,
          exclusion: exclusion,
          supersedes_case: supersedes_case,
          source_time_entry_id: exclusion.source_time_entry_id,
          source_time_entry_version: TimeEntry.where(id: exclusion.source_time_entry_id).pick(:lock_version).to_i,
          source_user_id: exclusion.source_user_id,
          source_user_uuid: exclusion.source_user_uuid || snapshot["user_uuid"],
          reason: exclusion.reason,
          work_date: snapshot["work_date"] || period.start_date,
          held_hours: exclusion.held_total_hours,
          source_snapshot: snapshot,
          actor: actor
        )
      rescue ActiveRecord::RecordNotUnique
        PayrollSettlementCase.find_by!(origin_payroll_batch_exclusion: exclusion)
      end

      def create_case!(period:, origin_batch:, source_time_entry_id:, source_time_entry_version:, source_user_id:, source_user_uuid:, reason:, work_date:,
                       held_hours:, source_snapshot:, actor:, exclusion: nil, supersedes_case: nil)
        settlement_case = nil
        PayrollSettlementCase.transaction(requires_new: true) do
          settlement_case = PayrollSettlementCase.create!(
            source_time_entry_id: source_time_entry_id,
            source_time_entry_version: source_time_entry_version,
            source_user_id: source_user_id,
            source_user_uuid: source_user_uuid,
            origin_payroll_batch: origin_batch,
            origin_payroll_batch_exclusion: exclusion,
            supersedes_case: supersedes_case,
            origin_reason: reason,
            original_work_date: work_date,
            held_total_hours: held_hours,
            action_due_on: period.pay_date,
            source_snapshot: source_snapshot
          )
          settlement_case.payroll_settlement_case_events.create!(
            event_id: SecureRandom.uuid,
            actor: actor,
            actor_payroll_integration_uuid: actor&.payroll_integration_uuid,
            event_type: "opened",
            to_status: "open",
            occurred_at: Time.current,
            metadata: { origin_reason: reason, origin_payroll_batch_id: origin_batch.public_id }
          )
          next_period = next_regular_period(period)
          route_to_period!(settlement_case, period: next_period, actor: actor, reason: "Next published regular payroll") if next_period && AUTO_ROUTE_REASONS.include?(reason)
        end
        settlement_case
      rescue ActiveRecord::RecordNotUnique
        scope = PayrollSettlementCase.where(
          origin_payroll_batch: origin_batch,
          source_time_entry_id: source_time_entry_id,
          origin_reason: reason
        )
        scope = exclusion ? scope.where(origin_payroll_batch_exclusion: exclusion) : scope.where(source_time_entry_version: source_time_entry_version)
        scope.find_by!
      end

      def next_regular_period(period)
        PayrollCalendarPeriod
          .where.not(status: "finalized")
          .where("start_date > ?", period.end_date)
          .order(:start_date, :id)
          .first
      end

      def relevant_periods_for(entry, previous_work_date:)
        dates = [ entry.work_date, previous_work_date ].compact.uniq
        period_ids = dates.flat_map do |date|
          PayrollCalendarPeriod
            .where(status: "finalized")
            .where("start_date <= ? AND end_date >= ?", date, date)
            .pluck(:id)
        end
        represented_batch_ids = PayrollBatchEntry.where(source_time_entry_id: entry.id).pluck(:payroll_batch_id)
        represented_batch_ids.concat(PayrollBatchExclusion.where(source_time_entry_id: entry.id).pluck(:payroll_batch_id))
        period_ids.concat(PayrollCalendarPeriod.where(status: "finalized", payroll_batch_id: represented_batch_ids).pluck(:id))
        PayrollCalendarPeriod
          .where(id: period_ids.uniq)
          .includes(payroll_batch: [ :payroll_batch_entries, :payroll_batch_exclusions ])
      end

      def snapshot_for(entry)
        {
          "employee_name" => entry.user&.full_name,
          "employee_email" => entry.user&.email,
          "user_uuid" => entry.user&.payroll_integration_uuid,
          "work_date" => entry.work_date.iso8601,
          "hours" => entry.hours.to_f,
          "time_category" => entry.time_category && {
            "id" => entry.time_category.id,
            "key" => entry.time_category.key,
            "name" => entry.time_category.name
          }
        }.compact
      end
    end
  end
end
