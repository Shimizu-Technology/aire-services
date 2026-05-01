# frozen_string_literal: true

module Api
  module V1
    class TimeEntriesController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_time_entry, only: [ :show, :update, :destroy, :approve, :deny, :approve_overtime, :deny_overtime ]
      before_action :require_admin!, only: [ :approve, :deny, :approve_overtime, :deny_overtime, :bulk_approve ]

      # GET /api/v1/time_entries
      def index
        @time_entries = current_user.admin? ? TimeEntry.all : TimeEntry.for_user(current_user)
        @time_entries = @time_entries.eager_load(:user, :time_category, :schedule, :approved_by, :overtime_approved_by, :time_entry_breaks)

        if params[:user_id].present? && current_user.admin?
          @time_entries = @time_entries.where(user_id: params[:user_id])
        end

        if params[:date].present?
          @time_entries = @time_entries.for_date(Date.parse(params[:date]))
        elsif params[:week].present?
          week_start = Date.parse(params[:week])
          week_end = week_start + 6.days
          @time_entries = @time_entries.where(work_date: week_start..week_end)
        elsif params[:start_date].present? && params[:end_date].present?
          @time_entries = @time_entries.where(work_date: Date.parse(params[:start_date])..Date.parse(params[:end_date]))
        end

        if params[:time_category_id].present?
          @time_entries = @time_entries.where(time_category_id: params[:time_category_id])
        end

        if params[:approval_status].present?
          @time_entries = @time_entries.where(approval_status: params[:approval_status])
        end

        if params[:exclude_approval_statuses].present?
          statuses = Array(params[:exclude_approval_statuses])
          @time_entries = @time_entries.where("approval_status IS NULL OR approval_status NOT IN (?)", statuses)
        end

        @time_entries = @time_entries.order(work_date: :desc, created_at: :desc)

        summary = calculate_summary(@time_entries)

        page = (params[:page] || 1).to_i
        per_page = (params[:per_page] || 50).to_i.clamp(1, 500)
        total_count = summary[:entry_count]
        @time_entries = @time_entries.offset((page - 1) * per_page).limit(per_page)

        render json: {
          time_entries: @time_entries.map { |entry| serialize_time_entry(entry) },
          pagination: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: (total_count.to_f / per_page).ceil,
            truncated: total_count > per_page
          },
          summary: summary
        }
      end

      # GET /api/v1/time_entries/:id
      def show
        render json: { time_entry: serialize_time_entry(@time_entry) }
      end

      # POST /api/v1/time_entries
      def create
        if period_locked_for_date?(time_entry_params[:work_date])
          return render json: { error: "This time period is locked and cannot be modified" }, status: :forbidden
        end

        entry_owner = resolve_entry_owner
        return unless entry_owner

        @time_entry = entry_owner.time_entries.build(time_entry_params.except(:user_id))
        @time_entry.entry_method = "manual"

        if current_user.admin?
          @time_entry.admin_override = true if entry_owner.id != current_user.id
          @time_entry.approval_status = "approved"
        else
          @time_entry.approval_status = "pending"
        end

        if @time_entry.save
          AuditLog.log(
            auditable: @time_entry,
            action: "created",
            user: current_user,
            metadata: "#{@time_entry.hours}h on #{@time_entry.work_date} (manual, #{@time_entry.approval_status})"
          )

          render json: { time_entry: serialize_time_entry(@time_entry) }, status: :created
        else
          render json: { error: @time_entry.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/time_entries/:id
      def update
        target_work_date = time_entry_params[:work_date].presence || @time_entry.work_date
        if period_locked_for_date?(target_work_date) || period_locked_for_date?(@time_entry.work_date)
          return render json: { error: "This time period is locked and cannot be modified" }, status: :forbidden
        end

        unless @time_entry.editable_by?(current_user)
          message = @time_entry.locked? ? "This time entry is locked and cannot be edited" : "You can only edit your own time entries"
          return render json: { error: message }, status: :forbidden
        end

        old_values = {
          hours: @time_entry.hours.to_f,
          work_date: @time_entry.work_date.iso8601,
          description: @time_entry.description,
          time_category_id: @time_entry.time_category_id,
          overtime_status: @time_entry.overtime_status,
          start_time: @time_entry.formatted_start_time,
          end_time: @time_entry.formatted_end_time
        }

        update_params = time_entry_params.except(:user_id).to_h.symbolize_keys
        raw_clock_params = raw_time_entry_params.slice(:work_date, :start_time, :end_time)
        normalize_clock_entry_time_update(@time_entry, update_params, raw_clock_params)
        return if performed?

        unless current_user.admin?
          update_params[:approval_status] = "pending"
          update_params[:approved_by] = nil
          update_params[:approved_at] = nil
          update_params[:approval_note] = append_review_note(@time_entry.approval_note)
        end

        if @time_entry.update(update_params)
          if @time_entry.status == "completed" &&
             (old_values[:hours] != @time_entry.hours.to_f || old_values[:work_date] != @time_entry.work_date.iso8601)
            new_overtime = TimeClockService.check_overtime_status(@time_entry.user, @time_entry, include_entry_hours: false)
            overtime_attrs = { overtime_status: new_overtime }

            if !current_user.admin? || old_values[:overtime_status].in?([ "approved", "denied" ])
              overtime_attrs[:overtime_approved_by] = nil
              overtime_attrs[:overtime_approved_at] = nil
              overtime_attrs[:overtime_note] = nil
            end

            @time_entry.update!(overtime_attrs)
          end

          new_values = {
            hours: @time_entry.hours.to_f,
            work_date: @time_entry.work_date.iso8601,
            description: @time_entry.description,
            time_category_id: @time_entry.time_category_id,
            overtime_status: @time_entry.overtime_status,
            start_time: @time_entry.formatted_start_time,
            end_time: @time_entry.formatted_end_time
          }

          changes = old_values.each_with_object({}) do |(key, old_val), hash|
            new_val = new_values[key]
            hash[key] = { from: old_val, to: new_val } if old_val != new_val
          end

          AuditLog.log(
            auditable: @time_entry,
            action: "updated",
            user: current_user,
            changes_made: changes.presence,
            metadata: "#{@time_entry.hours}h on #{@time_entry.work_date}"
          )

          render json: { time_entry: serialize_time_entry(@time_entry) }
        else
          render json: { error: @time_entry.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/time_entries/:id
      def destroy
        if period_locked_for_date?(@time_entry.work_date)
          return render json: { error: "This time period is locked and cannot be modified" }, status: :forbidden
        end

        unless @time_entry.deletable_by?(current_user)
          message = @time_entry.locked? ? "This time entry is locked and cannot be deleted" : "You can only delete your own time entries"
          return render json: { error: message }, status: :forbidden
        end

        entry_info = "#{@time_entry.hours}h on #{@time_entry.work_date}"
        entry_id = @time_entry.id

        @time_entry.destroy

        AuditLog.create!(
          auditable_type: "TimeEntry",
          auditable_id: entry_id,
          action: "deleted",
          user: current_user,
          metadata: entry_info
        )

        head :no_content
      end

      # ── Clock Actions ──

      # POST /api/v1/time_entries/clock_in
      def clock_in
        if current_user.admin? && params[:user_id].present?
          admin_override = current_user
          target_user = User.staff.find(params[:user_id])
        elsif current_user.admin? && params[:admin_override].present?
          admin_override = current_user
          target_user = current_user
        else
          admin_override = nil
          target_user = current_user
        end

        source = resolved_clock_source(target_user: target_user, admin_override: admin_override)
        entry = TimeClockService.clock_in(
          user: target_user,
          admin_override_by: admin_override,
          time_category_id: params[:time_category_id],
          clock_source: source,
          location: clock_location_params
        )
        render json: { time_entry: serialize_time_entry(eager_reload(entry)) }, status: :created
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/time_entries/clock_out
      def clock_out
        target_user = resolve_clock_target_user
        admin_override = (current_user.admin? && target_user.id != current_user.id) ? current_user : nil
        permitted = params.permit(:corrected_end_time, :description)
        entry = TimeClockService.clock_out(
          user: target_user,
          admin_override_by: admin_override,
          corrected_end_time: permitted[:corrected_end_time],
          description: permitted[:description]
        )
        render json: { time_entry: serialize_time_entry(eager_reload(entry)) }
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/time_entries/start_break
      def start_break
        target_user = resolve_clock_target_user
        admin_override = (current_user.admin? && target_user.id != current_user.id) ? current_user : nil
        entry = TimeClockService.start_break(user: target_user, admin_override_by: admin_override)
        render json: { time_entry: serialize_time_entry(eager_reload(entry)) }
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/time_entries/end_break
      def end_break
        target_user = resolve_clock_target_user
        admin_override = (current_user.admin? && target_user.id != current_user.id) ? current_user : nil
        entry = TimeClockService.end_break(user: target_user, admin_override_by: admin_override)
        render json: { time_entry: serialize_time_entry(eager_reload(entry)) }
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/time_entries/switch_category
      def switch_category
        target_user = resolve_clock_target_user
        admin_override = (current_user.admin? && target_user.id != current_user.id) ? current_user : nil
        source = resolved_clock_source(target_user: target_user, admin_override: admin_override)
        entry = TimeClockService.switch_category(
          user: target_user,
          time_category_id: params[:time_category_id],
          admin_override_by: admin_override,
          clock_source: source
        )
        render json: { time_entry: serialize_time_entry(eager_reload(entry)) }
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # GET /api/v1/time_entries/current_status
      def current_status
        render json: TimeClockService.current_status(user: current_user)
      end

      # ── Approval Actions ──

      # GET /api/v1/time_entries/pending_approvals
      def pending_approvals
        return render json: { error: "Admin access required" }, status: :forbidden unless current_user.admin?

        entries = pending_approval_entries_scope.order(created_at: :desc)

        render json: {
          pending_entries: entries.map { |e| serialize_time_entry(e) },
          count: entries.length
        }
      end

      # POST /api/v1/time_entries/:id/approve
      def approve
        entry = TimeClockService.approve_entry(entry: @time_entry, approved_by: current_user, note: params[:note])
        render json: { time_entry: serialize_time_entry(entry) }
      rescue TimeClockService::AuthorizationError => e
        render json: { error: e.message }, status: :forbidden
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/time_entries/:id/deny
      def deny
        entry = TimeClockService.deny_entry(entry: @time_entry, denied_by: current_user, note: params[:note])
        render json: { time_entry: serialize_time_entry(entry) }
      rescue TimeClockService::AuthorizationError => e
        render json: { error: e.message }, status: :forbidden
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/time_entries/:id/approve_overtime
      def approve_overtime
        entry = TimeClockService.approve_overtime(entry: @time_entry, approved_by: current_user, note: params[:note])
        render json: { time_entry: serialize_time_entry(entry) }
      rescue TimeClockService::AuthorizationError => e
        render json: { error: e.message }, status: :forbidden
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/time_entries/:id/deny_overtime
      def deny_overtime
        entry = TimeClockService.deny_overtime(entry: @time_entry, denied_by: current_user, note: params[:note])
        render json: { time_entry: serialize_time_entry(entry) }
      rescue TimeClockService::AuthorizationError => e
        render json: { error: e.message }, status: :forbidden
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/time_entries/bulk_approve
      def bulk_approve
        entry_ids = Array(params[:entry_ids]).filter_map do |value|
          integer_id = value.to_i
          integer_id if integer_id.positive?
        end.uniq
        if entry_ids.empty?
          return render json: { error: "Select at least one pending entry to approve" }, status: :unprocessable_entity
        end
        if entry_ids.length > 100
          return render json: { error: "Approve at most 100 entries at a time" }, status: :unprocessable_entity
        end

        note = params[:note].presence

        updated_entries = []
        error_message = nil
        ActiveRecord::Base.transaction do
          entries_by_id = TimeEntry.where(id: entry_ids).lock.index_by(&:id)
          missing_ids = entry_ids - entries_by_id.keys
          if missing_ids.any?
            error_message = "One or more selected entries could not be found"
            raise ActiveRecord::Rollback
          end

          entry_ids.each do |entry_id|
            entry = entries_by_id.fetch(entry_id)
            unless entry.approval_status == "pending" || entry.overtime_status == "pending"
              error_message = "One or more selected entries are no longer pending approval"
              raise ActiveRecord::Rollback
            end

            entry = TimeClockService.approve_entry(entry: entry, approved_by: current_user, note: note) if entry.approval_status == "pending"
            entry = TimeClockService.approve_overtime(entry: entry, approved_by: current_user, note: note) if entry.overtime_status == "pending"

            updated_entries << eager_reload(entry)
          end
        end

        if error_message
          return render json: { error: error_message }, status: :unprocessable_entity
        end

        render json: {
          time_entries: updated_entries.map { |entry| serialize_time_entry(entry) },
          count: updated_entries.length
        }
      rescue TimeClockService::AuthorizationError => e
        render json: { error: e.message }, status: :forbidden
      rescue TimeClockService::ClockError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # GET /api/v1/time_entries/whos_working
      def whos_working
        return render json: { error: "Admin access required" }, status: :forbidden unless current_user.admin?

        render json: { workers: WhosWorkingQuery.call }
      end

      private

      def eager_reload(entry)
        TimeEntry.eager_load(:user, :time_category, :schedule, :approved_by,
                             :overtime_approved_by, :time_entry_breaks).find(entry.id)
      end

      def resolve_clock_target_user
        if current_user.admin? && params[:user_id].present?
          User.staff.find(params[:user_id])
        else
          current_user
        end
      end

      def resolved_clock_source(target_user:, admin_override:)
        return "admin" if admin_override.present? && target_user.id != current_user.id

        "mobile"
      end

      def set_time_entry
        scope = current_user.admin? ? TimeEntry : current_user.time_entries
        @time_entry = scope.find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Time entry not found" }, status: :not_found
      end

      def time_entry_params
        permitted = params.require(:time_entry).permit(
          :work_date,
          :start_time,
          :end_time,
          :hours,
          :description,
          :time_category_id,
          :break_minutes,
          :user_id
        )
        normalize_manual_time(permitted, :start_time)
        normalize_manual_time(permitted, :end_time)
        permitted
      end

      def normalize_manual_time(params_hash, field)
        val = params_hash[field]
        return unless val.present? && val.is_a?(String) && val.match?(/\A\d{1,2}:\d{2}\z/)

        h, m = val.split(":").map(&:to_i)
        return unless h.between?(0, 23) && m.between?(0, 59)

        tz = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
        params_hash[field] = tz.local(2000, 1, 1, h, m, 0)
      end

      def normalize_clock_entry_time_update(entry, params_hash, raw_params = {})
        return unless entry.clock_entry?

        target_work_date = raw_params[:work_date].presence || params_hash[:work_date].presence || entry.work_date
        start_value = raw_params[:start_time].presence || params_hash[:start_time]
        corrected_start = clock_time_on_work_date(start_value, target_work_date) if start_value.present?

        if corrected_start
          if entry.active? && corrected_start > Time.current
            return render json: { error: "Clock-in time cannot be in the future for an active entry" }, status: :unprocessable_entity
          end

          first_break = entry.time_entry_breaks.order(:start_time).first
          if first_break && corrected_start >= first_break.start_time
            return render json: { error: "Clock-in time must be before the first break" }, status: :unprocessable_entity
          end

          params_hash[:start_time] = corrected_start
          params_hash[:clock_in_at] = corrected_start
        end

        if entry.active?
          params_hash.delete(:end_time)
          params_hash.delete(:hours)
        else
          end_value = raw_params[:end_time].presence || params_hash[:end_time]
          return unless end_value.present?

          start_reference = corrected_start || entry.start_time
          corrected_end = clock_time_on_work_date(end_value, target_work_date, after: start_reference)

          if corrected_end > Time.current
            return render json: { error: "Clock-out time cannot be in the future" }, status: :unprocessable_entity
          end

          params_hash[:end_time] = corrected_end
          params_hash[:clock_out_at] = corrected_end
        end
      end

      def clock_time_on_work_date(value, work_date, after: nil)
        local_time = value.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)
        date = Date.parse(work_date.to_s)
        tz = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
        corrected = tz.local(date.year, date.month, date.day, local_time.hour, local_time.min, 0)
        corrected += 1.day if after.present? && corrected <= after
        corrected
      end

      def raw_time_entry_params
        params.require(:time_entry).permit(:work_date, :start_time, :end_time).to_h.symbolize_keys
      end

      def resolve_entry_owner
        requested_user_id = time_entry_params[:user_id]
        return current_user if requested_user_id.blank?

        unless current_user.admin?
          render json: { error: "Only admins can create entries for other users" }, status: :forbidden
          return nil
        end

        user = User.staff.find_by(id: requested_user_id)
        unless user
          render json: { error: "Selected user is invalid" }, status: :unprocessable_entity
          return nil
        end

        user
      end

      def period_locked_for_date?(date)
        return false if date.blank?

        TimePeriodLock.locked_for_date?(Date.parse(date.to_s))
      rescue Date::Error
        false
      end

      def serialize_time_entry(entry)
        tz = TimeClockService::BUSINESS_TIMEZONE
        {
          id: entry.id,
          work_date: entry.work_date.iso8601,
          start_time: entry.start_time&.in_time_zone(tz)&.strftime("%H:%M"),
          end_time: entry.end_time&.in_time_zone(tz)&.strftime("%H:%M"),
          formatted_start_time: entry.formatted_start_time,
          formatted_end_time: entry.formatted_end_time,
          hours: entry.hours.to_f,
          break_minutes: entry.break_minutes,
          description: entry.description,
          entry_method: entry.entry_method,
          clock_source: entry.clock_source,
          status: entry.status,
          admin_override: entry.admin_override,
          attendance_status: entry.attendance_status,
          approval_status: entry.approval_status,
          overtime_status: entry.overtime_status,
          clock_in_at: entry.clock_in_at&.iso8601,
          clock_out_at: entry.clock_out_at&.iso8601,
          approved_by: entry.approved_by ? {
            id: entry.approved_by.id,
            full_name: entry.approved_by.full_name
          } : nil,
          approved_at: entry.approved_at&.iso8601,
          approval_note: entry.approval_note,
          overtime_approved_by: entry.overtime_approved_by ? {
            id: entry.overtime_approved_by.id,
            full_name: entry.overtime_approved_by.full_name
          } : nil,
          overtime_approved_at: entry.overtime_approved_at&.iso8601,
          overtime_note: entry.overtime_note,
          schedule: entry.schedule ? {
            id: entry.schedule.id,
            start_time: entry.schedule.formatted_start_time,
            end_time: entry.schedule.formatted_end_time
          } : nil,
          breaks: entry.time_entry_breaks.sort_by(&:start_time).map { |b|
            {
              id: b.id,
              start_time: b.start_time.iso8601,
              end_time: b.end_time&.iso8601,
              duration_minutes: b.duration_minutes,
              active: b.active?
            }
          },
          user: {
            id: entry.user.id,
            email: entry.user.email,
            display_name: entry.user.display_name,
            full_name: entry.user.full_name,
            approval_group: entry.user.approval_group,
            approval_group_label: entry.user.approval_group_label
          },
          time_category: entry.time_category ? {
            id: entry.time_category.id,
            key: entry.time_category.key,
            name: entry.time_category.name
          }.merge(current_user.admin? ? { hourly_rate_cents: entry.time_category.hourly_rate_cents, hourly_rate: entry.time_category.hourly_rate } : {}) : nil,
          effective_rate_cents: current_user.admin? ? entry.effective_rate_cents : nil,
          effective_rate: current_user.admin? ? entry.effective_rate : nil,
          locked_at: entry.locked_at&.iso8601,
          created_at: entry.created_at.iso8601,
          updated_at: entry.updated_at.iso8601
        }
      end

      def calculate_summary(entries)
        # Drop ordering and eager-loads; pick() runs a single aggregate SELECT.
        row = entries.reorder(nil).unscope(:includes).pick(
          Arel.sql("COALESCE(SUM(hours), 0)"),
          Arel.sql("COALESCE(SUM(break_minutes), 0)"),
          Arel.sql("COUNT(*)")
        )
        total_hours, total_break_minutes, entry_count = row || [ 0, 0, 0 ]
        {
          total_hours: total_hours.to_f,
          total_break_hours: (total_break_minutes.to_i / 60.0).round(2),
          entry_count: entry_count.to_i
        }
      end

      def pending_approval_entries_scope
        base_scope = TimeEntry.eager_load(:user, :schedule, :approved_by, :overtime_approved_by, :time_entry_breaks, :time_category)
        entries = base_scope.where(approval_status: "pending").or(base_scope.where(overtime_status: "pending"))

        approval_group = params[:approval_group].to_s
        return entries if approval_group.blank?

        case approval_group
        when "unassigned"
          entries.where(users: { approval_group: nil })
        when *Setting.approval_group_keys
          entries.where(users: { approval_group: approval_group })
        else
          entries
        end
      end

      def clock_location_params
        location = params[:location]
        return {} unless location.respond_to?(:permit)

        location.permit(:latitude, :longitude, :accuracy_meters).to_h.symbolize_keys
      end

      def append_review_note(existing_note)
        review_note = "Employee edited time entry — awaiting admin review"
        return review_note if existing_note.blank?
        return existing_note if existing_note.include?(review_note)

        "#{existing_note}\n\n#{review_note}"
      end
    end
  end
end
