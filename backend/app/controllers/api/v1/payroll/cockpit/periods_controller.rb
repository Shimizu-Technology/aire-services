# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class PeriodsController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "payroll_finalization"

          before_action :authenticate_payroll_actor!, only: :finalize

          def show
            period = parse_period!
            entries = period_entries(period)
            lifecycles = ::Payroll::EntryLifecycleResolver.new(entries: entries).call
            snapshot = ::Payroll::CockpitPeriodSnapshot.new(period: period, entries: entries).call
            batch = period.payroll_batch

            render json: {
              payroll_period: period.as_contract_json,
              readiness: snapshot.readiness.merge(
                lifecycle_counts: ::Payroll::EntryLifecycleResolver.summary(lifecycles.values)
              ),
              finalized_batch: batch && serialize_batch(batch),
              processing_history: batch ? serialize_processing_history(batch) : [],
              carryovers: ::Payroll::CarryoverQueue.new.call.fetch(:summary)
            }
          end

          def finalize
            period = parse_period!
            run_command(
              action: "payroll_period.finalize",
              target: period,
              payload: command_params.to_h,
              replay: ->(_current_period, metadata) { serialize_finalization_replay(metadata) },
              status: :accepted
            ) do |locked_period, reason|
              if locked_period.cutoff_at > Time.current
                raise ::Payroll::CockpitCommand::InvalidCommandError,
                      "This payroll period cannot be finalized before its cutoff"
              end

              result = ::Payroll::ScheduledCutoffFinalizer.new(period_id: locked_period.id, now: Time.current).call
              locked_period.reload
              AuditLog.record!(
                action: "payroll_cockpit.finalization_requested",
                actor: payroll_actor,
                source: "integration",
                event_category: "payroll",
                outcome: result.fetch(:status) == "failed" ? "failed" : "succeeded",
                auditable: locked_period,
                correlation_id: command_params[:command_id],
                metadata: {
                  reason: reason,
                  expected_version: command_params[:expected_version],
                  result: result
                }
              )
              [
                { payroll_period: locked_period.as_contract_json, result: result },
                {
                  result_status: result.fetch(:status),
                  result_version: locked_period.lock_version,
                  payroll_batch_id: result[:payroll_batch_id]
                }.compact
              ]
            end
          end

          private

          def period_entries(period)
            payroll_period_entry_scope(period)
              .includes(:user, :time_category, :approved_by, :overtime_approved_by, :time_entry_breaks)
              .to_a
          end

          def serialize_batch(batch)
            {
              id: batch.public_id,
              checksum: batch.checksum,
              schema_version: batch.schema_version,
              finalized_at: batch.finalized_at&.iso8601,
              summary: batch.summary,
              issues: batch.issues,
              processing: batch.processing_status
            }
          end

          def serialize_processing_history(batch)
            batch.payroll_batch_processing_events.order(:occurred_at, :id).map do |event|
              {
                event_id: event.event_id,
                status: event.status,
                occurred_at: event.occurred_at.iso8601,
                external_system: event.external_system,
                external_pay_period_id: event.external_pay_period_id
              }.compact
            end
          end

          def serialize_finalization_replay(metadata)
            {
              result: {
                status: metadata.fetch("result_status"),
                payroll_batch_id: metadata["payroll_batch_id"]
              }.compact,
              command_result: metadata
            }
          end
        end
      end
    end
  end
end
