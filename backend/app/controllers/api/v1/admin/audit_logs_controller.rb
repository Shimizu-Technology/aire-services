# frozen_string_literal: true

require "csv"

module Api
  module V1
    module Admin
      class AuditLogsController < BaseController
        EXPORT_BATCH_SIZE = 1_000

        before_action :require_admin!

        def index
          scope = filtered_scope
          page = [ params.fetch(:page, 1).to_i, 1 ].max
          per_page = params.fetch(:per_page, 50).to_i.clamp(1, 100)
          total = scope.count
          records = ordered(scope).offset((page - 1) * per_page).limit(per_page)

          render json: {
            audit_logs: records.map { |record| serialize(record) },
            pagination: { page: page, per_page: per_page, total: total, total_pages: (total.to_f / per_page).ceil },
            filters: { event_categories: AuditLog::EVENT_CATEGORIES, sources: AuditLog::SOURCES, outcomes: AuditLog::OUTCOMES }
          }
        end

        def export
          export_scope = filtered_scope.where("audit_logs.occurred_at <= ?", Time.current)
          filename = "aire-activity-history-#{Time.zone.today}.csv"
          csv = csv_for(export_scope)
          AuditLog.record!(
            action: "audit_history.exported",
            actor: current_user,
            auditable: current_user,
            event_category: "reports",
            metadata: { filters: safe_filter_metadata, format: "csv" }
          )

          send_data csv, filename: filename, type: "text/csv; charset=utf-8"
        end

        private

        def filtered_scope
          scope = AuditLog.all
          scope = scope.where(user_id: numeric_filter(:actor_id)) if params[:actor_id].present?
          scope = scope.where(event_category: params[:event_category]) if params[:event_category].present?
          scope = scope.where(source: params[:source]) if params[:source].present?
          scope = scope.where(outcome: params[:outcome]) if params[:outcome].present?
          scope = scope.where(auditable_type: params[:subject_type]) if params[:subject_type].present?
          scope = scope.where(auditable_id: numeric_filter(:subject_id, allow_zero: true)) if params[:subject_id].present?
          scope = scope.where(action: params[:event_action]) if params[:event_action].present?
          scope = scope.where("occurred_at >= ?", parsed_time(params[:from], beginning: true)) if params[:from].present?
          scope = scope.where("occurred_at <= ?", parsed_time(params[:to], beginning: false)) if params[:to].present?
          apply_search(scope)
        end

        def apply_search(scope)
          return scope if params[:search].blank?

          search = params[:search].to_s.strip.first(200)
          term = "%#{ActiveRecord::Base.sanitize_sql_like(search)}%"
          action_term = "%#{ActiveRecord::Base.sanitize_sql_like(search.tr(" -", "__"))}%"
          compact_term = "%#{ActiveRecord::Base.sanitize_sql_like(search.gsub(/[\s_-]/, ""))}%"
          scope.where(
            <<~SQL.squish,
              actor_name ILIKE :term OR actor_email ILIKE :term OR subject_name ILIKE :term OR
              action ILIKE :term OR action ILIKE :action_term OR event_category ILIKE :action_term OR
              auditable_type ILIKE :term OR LOWER(REPLACE(REPLACE(auditable_type, '_', ''), ' ', '')) LIKE LOWER(:compact_term)
            SQL
            term: term,
            action_term: action_term,
            compact_term: compact_term
          )
        end

        def parsed_time(value, beginning:)
          parsed = Time.zone.parse(value.to_s)
          raise ArgumentError if parsed.nil?

          beginning ? parsed.beginning_of_day : parsed.end_of_day
        rescue ArgumentError
          raise ActionController::BadRequest, "Invalid date filter"
        end

        def ordered(scope)
          scope.order(occurred_at: :desc, id: :desc)
        end

        def serialize(record)
          presenter = AuditLogPresenter.new(record)
          {
            id: record.id,
            action: record.action,
            event_category: record.event_category,
            occurred_at: record.occurred_at.iso8601,
            outcome: record.outcome,
            source: record.source,
            summary: presenter.summary,
            actor: {
              id: record.user_id,
              name: record.actor_name,
              email: record.actor_email,
              role: record.actor_role,
              kind: record.actor_kind
            },
            subject: {
              type: record.auditable_type,
              id: record.auditable_id,
              name: record.subject_name
            },
            changes: record.changes_made || {},
            details: record.metadata || {},
            request: {
              id: record.request_id,
              ip_address: record.ip_address,
              user_agent: record.user_agent,
              correlation_id: record.correlation_id
            }
          }
        end

        def csv_for(scope)
          CSV.generate do |csv|
            csv << [ "Occurred at", "Actor", "Actor email", "Action", "Category", "Outcome", "Source", "Subject type", "Subject", "Summary", "Changed fields", "Request ID" ]
            each_export_record(scope) do |record|
              presenter = AuditLogPresenter.new(record)
              csv << [
                record.occurred_at.iso8601,
                csv_safe(record.actor_name),
                csv_safe(record.actor_email),
                csv_safe(record.action),
                record.event_category,
                record.outcome,
                record.source,
                record.auditable_type,
                csv_safe(record.subject_name),
                csv_safe(presenter.summary),
                csv_safe(changed_fields_for(record).join(", ")),
                csv_safe(record.request_id)
              ]
            end
          end
        end

        def each_export_record(scope)
          cursor = nil
          loop do
            batch = ordered(export_page(scope, cursor)).limit(EXPORT_BATCH_SIZE).to_a
            break if batch.empty?

            batch.each { |record| yield record }
            last = batch.last
            cursor = [ last.occurred_at, last.id ]
          end
        end

        def export_page(scope, cursor)
          return scope unless cursor

          occurred_at, id = cursor
          scope.where("occurred_at < :occurred_at OR (occurred_at = :occurred_at AND id < :id)", occurred_at: occurred_at, id: id)
        end

        def csv_safe(value)
          string = value.to_s
          string.match?(/\A[=+\-@]/) ? "'#{string}" : string
        end

        def changed_fields_for(record)
          metadata_fields = Array((record.metadata || {})["changed_fields"])
          (record.changes_made.to_h.keys + metadata_fields).uniq.sort
        end

        def numeric_filter(key, allow_zero: false)
          value = Integer(params[key], 10)
          valid = allow_zero ? value >= 0 : value.positive?
          raise ArgumentError unless valid

          value
        rescue ArgumentError, TypeError
          raise ActionController::BadRequest, "Invalid #{key.to_s.humanize.downcase} filter"
        end

        def safe_filter_metadata
          params.permit(:actor_id, :event_category, :source, :outcome, :subject_type, :subject_id, :event_action, :search, :from, :to).to_h
        end
      end
    end
  end
end
