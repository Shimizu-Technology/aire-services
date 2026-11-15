# frozen_string_literal: true

module Api
  module V1
    module Admin
      class PayrollBatchesController < BaseController
        before_action -> { require_capability!(:manage_payroll) }
        before_action :require_connected_payroll!, only: :create
        before_action :find_batch, only: %i[show export]

        def index
          total_count = PayrollBatch.count
          batches = PayrollBatch
            .includes(
              :finalized_by,
              :payroll_calendar_period,
              :payroll_batch_processing_events,
              :payroll_batch_entries,
              :payroll_entry_processing_events
            )
            .order(finalized_at: :desc)
            .limit(100)
            .to_a
          render json: {
            connected_payroll: ConnectedPayrollMode.capability,
            payroll_batches: batches.map { |batch| serialize_summary(batch) },
            total_count: total_count,
            truncated: total_count > batches.length
          }
        end

        def show
          render json: serialize_detail(@payroll_batch)
        end

        def preview
          cutoff_at = parse_preview_cutoff
          result = ::Payroll::BatchBuilder.new(
            start_date: params[:start_date],
            end_date: params[:end_date],
            cutoff_at: cutoff_at || Time.current,
            manual_processing: ActiveModel::Type::Boolean.new.cast(params[:manual_processing])
          ).call
          add_period_waiting_hours(result) unless cutoff_at || ActiveModel::Type::Boolean.new.cast(params[:manual_processing])
          periods = PayrollCalendarPeriod.overlapping(result.fetch(:start_date), result.fetch(:end_date))
            .includes(:payroll_batch).order(:start_date, :id).to_a
          rollout = PayrollLockRollout.find_by(id: 1) if periods.any?
          legacy_blocked = ::Payroll::LegacyPaidHistoryGuard.blocked?
          render json: result.fetch(:payload).merge(
            preview: true,
            connected_payroll: ConnectedPayrollMode.capability,
            can_finalize: ConnectedPayrollMode.enabled? && periods.empty? && !legacy_blocked && result.dig(:issues, :missing_category_count).zero?,
            published_calendar_periods: periods.map { |period| period.as_contract_json(rollout: rollout, next_scheduled_cutoff_at: nil).slice(
              :external_pay_period_id, :start_date, :end_date, :cutoff_at, :status, :payroll_batch_id
            ) },
            finalization_blocked_reason: if !ConnectedPayrollMode.enabled?
              ConnectedPayrollMode::MESSAGE
                                         elsif periods.any?
              "This range overlaps a published payroll calendar. Use its Lock action in Cornerstone Payroll or view its finalized batch."
                                         elsif legacy_blocked
              ::Payroll::LegacyPaidHistoryGuard::MESSAGE
                                         end,
            requires_negative_adjustment_acknowledgement: result.dig(:issues, :negative_adjustment_count).positive?
          )
        rescue ArgumentError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        def carryovers
          render json: ::Payroll::CarryoverQueue.new.call
        end

        def create
          batch = ::Payroll::BatchFinalizer.new(
            start_date: params[:start_date],
            end_date: params[:end_date],
            actor: current_user,
            acknowledge_negative_adjustments: params[:acknowledge_negative_adjustments],
            negative_adjustment_note: params[:negative_adjustment_note],
            manual_processing: params[:manual_processing],
            cutoff_at: params[:cutoff_at],
            processed_at: params[:processed_at],
            external_pay_period_id: params[:external_pay_period_id],
            processing_note: params[:processing_note],
            acknowledge_missing_categories: params[:acknowledge_missing_categories]
          ).call
          Current.domain_audit_recorded = true
          render json: serialize_detail(batch), status: :created
        rescue ArgumentError, ::Payroll::BatchFinalizer::FinalizationError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        def export
          csv = Reports::PayrollBatchCsv.render(@payroll_batch)
          AuditLog.record!(
            action: "payroll_batch.exported",
            actor: current_user,
            auditable: @payroll_batch,
            event_category: "payroll",
            metadata: { format: "csv", checksum: @payroll_batch.checksum }
          )
          send_data csv,
                    filename: "#{@payroll_batch.public_id}.csv",
                    type: "text/csv; charset=utf-8",
                    disposition: "attachment"
        end

        private

        # Preview display follows Today's payable dates; held source evidence stays intact.
        def add_period_waiting_hours(result)
          waiting = result.fetch(:payload).fetch(:exclusions).select { |row| row[:reason].in?(%w[pending_approval pending_overtime]) }
          entries = TimeEntry.where(id: waiting.map { |row| row[:source_time_entry_id] }).includes(:time_entry_breaks).to_a
          approval = ::Payroll::ApprovalHours.for_entries(entries)
          hours = entries.to_h do |entry|
            segments = approval.segments_for(entry).select do |segment|
              Date.iso8601(segment[:work_date]).between?(result.fetch(:start_date), result.fetch(:end_date))
            end
            [ entry.id.to_s, segments.empty? ? nil : ::Payroll::ApprovalHours.sum(segments) ]
          end
          waiting.each do |row|
            quantities = hours[row[:source_time_entry_id].to_s]
            next unless quantities

            row[:waiting_hours_in_period] = if row[:reason] == "pending_overtime"
              quantities.fetch(:overtime_waiting_hours)
            else
              (quantities.fetch(:time_waiting_hours).to_d + quantities.fetch(:overtime_waiting_hours).to_d).round(2).to_f
            end
          end
        end

        def require_connected_payroll!
          return if ConnectedPayrollMode.enabled?

          # Availability refusal is not a domain action; leave all ledgers and
          # the generic mutation audit untouched, like the integration guard.
          Current.domain_audit_recorded = true
          response.headers["Retry-After"] = "60"
          render json: { error: ConnectedPayrollMode::MESSAGE, connected_payroll: ConnectedPayrollMode.capability }, status: :service_unavailable
        end

        def parse_preview_cutoff
          return if params[:cutoff_at].blank?

          cutoff = begin
            Time.iso8601(params[:cutoff_at].to_s)
          rescue ArgumentError
            raise ArgumentError, "cutoff_at must be a valid ISO 8601 timestamp"
          end
          raise ArgumentError, "cutoff_at cannot be in the future" if cutoff > Time.current

          cutoff
        end

        def find_batch
          @payroll_batch = PayrollBatch.find_by!(public_id: params[:id])
        end

        def serialize_summary(batch)
          {
            id: batch.public_id,
            pay_period_start: batch.payroll_calendar_period&.start_date&.iso8601,
            purpose: batch.payload["purpose"] || "regular",
            start_date: batch.start_date.iso8601,
            end_date: batch.end_date.iso8601,
            cutoff_at: batch.cutoff_at.iso8601,
            finalized_at: batch.finalized_at.iso8601,
            finalized_by: batch.finalized_by && { id: batch.finalized_by.id, name: batch.finalized_by.full_name },
            checksum: batch.checksum,
            processing: batch.processing_summary,
            summary: batch.summary,
            issues: batch.issues
          }
        end

        def serialize_detail(batch)
          serialize_summary(batch).merge(payload: batch.export_payload)
        end
      end
    end
  end
end
