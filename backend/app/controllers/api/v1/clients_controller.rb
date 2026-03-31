# frozen_string_literal: true

module Api
  module V1
    class ClientsController < BaseController
      # Require authentication for all actions except intake endpoints
      before_action :authenticate_user!, except: []
      before_action :require_staff!, except: []

      # GET /api/v1/clients
      def index
        clients = Client.includes(:tax_returns, :service_types, :client_contacts, :user, tax_returns: [:workflow_stage, :assigned_to])
                        .order(created_at: :desc)

        # Search
        if params[:search].present?
          search_term = "%#{params[:search].downcase}%"
          clients = clients.where(
            "LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(business_name) LIKE ?",
            search_term, search_term, search_term, search_term
          )
        end

        # Filter by workflow stage
        if params[:stage].present?
          clients = clients.joins(tax_returns: :workflow_stage)
                           .where(workflow_stages: { slug: params[:stage] })
        end

        # Filter by service type
        if params[:service_type_id].present?
          clients = clients.joins(:service_types)
                           .where(service_types: { id: params[:service_type_id] })
                           .distinct
        end

        # Filter by client type (individual/business)
        if params[:client_type].present?
          clients = clients.where(client_type: params[:client_type])
        end

        # Filter by service-only clients (has_tax_returns = false means service-only)
        # Only filter when service_only=true; service_only=false means "show all" (no filter)
        if params[:service_only] == 'true'
          clients = clients.where(has_tax_returns: false)
        end
        
        # Also support has_tax_returns param directly
        if params[:has_tax_returns].present?
          clients = clients.where(has_tax_returns: params[:has_tax_returns] == 'true')
        end

        # Filter archived clients (default: show only active)
        if params[:show_archived] == 'true'
          clients = clients.archived
        elsif params[:show_archived] != 'all'
          clients = clients.active
        end

        # Pagination
        page = (params[:page] || 1).to_i
        per_page = (params[:per_page] || 20).to_i.clamp(1, 100)
        total_count = clients.count(:all)
        total_count = total_count.values.sum if total_count.is_a?(Hash)
        clients = clients.offset((page - 1) * per_page).limit(per_page)

        render json: {
          clients: clients.map { |client| client_summary(client) },
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: (total_count.to_f / per_page).ceil
          }
        }
      end

      # GET /api/v1/clients/:id
      def show
        client = Client.includes(
          :dependents,
          :service_types,
          :client_contacts,
          :user,
          tax_returns: [:workflow_stage, :income_sources, :workflow_events, :assigned_to]
        ).find(params[:id])

        render json: { client: client_detail(client) }
      end

      # POST /api/v1/clients (Quick Create)
      def create
        client = Client.new(quick_create_client_params)

        ActiveRecord::Base.transaction do
          if client.save
            # Assign service types if provided
            if params.dig(:client, :service_type_ids).present?
              service_type_ids = params[:client][:service_type_ids].map(&:to_i)
              service_type_ids.each do |st_id|
                client.client_service_types.create!(service_type_id: st_id)
              end
            end

            create_contacts_for_client(client)

            # Only create a tax return if client has tax returns
            if client.has_tax_returns
              initial_stage = WorkflowStage.find_by(slug: "intake_received") ||
                              WorkflowStage.active.ordered.first
              tax_year = (params.dig(:client, :tax_year) || Date.current.year).to_i
              
              tax_return = client.tax_returns.create!(
                tax_year: tax_year,
                workflow_stage: initial_stage
              )

              # Log workflow event
              tax_return.workflow_events.create!(
                event_type: "status_changed",
                new_value: initial_stage&.name,
                description: "Client created via quick create"
              )
            end

            render json: { 
              message: "Client created successfully",
              client: client_summary(client.reload) 
            }, status: :created
          else
            render json: { errors: client.errors.full_messages }, status: :unprocessable_entity
          end
        end
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: [e.message] }, status: :unprocessable_entity
      end

      # PATCH /api/v1/clients/:id
      def update
        client = Client.includes(:service_types).find(params[:id])

        # Safe attributes to track for audit (excludes encrypted bank fields)
        safe_audit_attrs = %w[
          first_name last_name date_of_birth email phone mailing_address
          filing_status is_new_client has_prior_year_return changes_from_prior_year
          spouse_name spouse_dob denied_eic_actc denied_eic_actc_year
          has_crypto_transactions wants_direct_deposit client_type business_name has_tax_returns
        ]

        # Get only the safe attributes that are being updated
        attrs_to_track = client_params.keys.map(&:to_s) & safe_audit_attrs
        
        # Capture old values before update (only safe attributes)
        old_values = {}
        attrs_to_track.each do |attr|
          old_values[attr] = client.send(attr) rescue nil
        end

        # Capture old service type ids for audit
        old_service_type_ids = client.service_types.pluck(:id)

        ActiveRecord::Base.transaction do
          if client.update(client_params)
            create_contacts_for_client(client) if client.client_type == "business" && client.client_contacts.empty?

            # Update service types if provided (atomic via Rails association setter)
            if params[:client].key?(:service_type_ids)
              new_service_type_ids = (params[:client][:service_type_ids] || []).map(&:to_i)
              client.service_type_ids = new_service_type_ids
            end

            # Calculate what actually changed
            changes = {}
            attrs_to_track.each do |attr|
              old_val = old_values[attr]
              new_val = client.send(attr) rescue nil
              changes[attr] = { from: old_val, to: new_val } if old_val != new_val
            end

            # Track service type changes
            if params[:client].key?(:service_type_ids)
              new_service_type_ids = (params[:client][:service_type_ids] || []).map(&:to_i)
              if old_service_type_ids.sort != new_service_type_ids.sort
                old_names = ServiceType.where(id: old_service_type_ids).pluck(:name)
                new_names = ServiceType.where(id: new_service_type_ids).pluck(:name)
                changes['service_types'] = { from: old_names.join(', '), to: new_names.join(', ') }
              end
            end

            # Log audit event if there were changes
            if changes.any?
              AuditLog.log(
                auditable: client,
                action: "updated",
                user: current_user,
                changes_made: changes,
                metadata: "Updated #{changes.keys.join(', ')}"
              )
            end

            render json: { client: client_detail(client.reload) }
          else
            render json: { errors: client.errors.full_messages }, status: :unprocessable_entity
          end
        end
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: [e.message] }, status: :unprocessable_entity
      end

      # POST /api/v1/clients/:id/archive
      def archive
        client = Client.find(params[:id])
        client.archive!

        AuditLog.create!(
          user: current_user,
          action: 'archived',
          auditable: client,
          details: { client_name: client.full_name }
        )

        render json: { client: client_detail(client.reload) }
      end

      # POST /api/v1/clients/:id/unarchive
      def unarchive
        client = Client.find(params[:id])
        client.unarchive!

        AuditLog.create!(
          user: current_user,
          action: 'unarchived',
          auditable: client,
          details: { client_name: client.full_name }
        )

        render json: { client: client_detail(client.reload) }
      end

      private

      def client_params
        permitted = params.require(:client).permit(
          :first_name, :last_name, :date_of_birth, :email, :phone, :mailing_address,
          :filing_status, :is_new_client, :has_prior_year_return, :changes_from_prior_year,
          :spouse_name, :spouse_dob, :denied_eic_actc, :denied_eic_actc_year,
          :has_crypto_transactions, :wants_direct_deposit, :bank_routing_number,
          :bank_account_number, :bank_account_type, :client_type, :business_name,
          :has_tax_returns, :notification_preference
        )
        # Map legacy is_service_only param to has_tax_returns (inverted logic)
        # Read from raw params since we don't permit the renamed field
        if params[:client]&.key?(:is_service_only) && !permitted.key?(:has_tax_returns)
          permitted[:has_tax_returns] = !ActiveModel::Type::Boolean.new.cast(params[:client][:is_service_only])
        end
        permitted
      end

      def quick_create_client_params
        permitted = params.require(:client).permit(
          :first_name, :last_name, :date_of_birth, :email, :phone,
          :filing_status, :is_new_client, :client_type, :business_name, 
          :has_tax_returns
        )
        # Map legacy is_service_only param to has_tax_returns (inverted logic)
        # Read from raw params since we don't permit the renamed field
        if params[:client]&.key?(:is_service_only) && !permitted.key?(:has_tax_returns)
          permitted[:has_tax_returns] = !ActiveModel::Type::Boolean.new.cast(params[:client][:is_service_only])
        end
        permitted.tap do |p|
          # Set defaults for quick create
          p[:is_new_client] = true if p[:is_new_client].nil?
          p[:client_type] ||= 'individual'
          p[:has_tax_returns] = true if p[:has_tax_returns].nil?  # Default to tax client
        end
      end

      def client_summary(client)
        latest_return = client.tax_returns.max_by(&:created_at)

        {
          id: client.id,
          first_name: client.first_name,
          last_name: client.last_name,
          full_name: client.full_name,
          email: client.email,
          phone: client.phone,
          is_new_client: client.is_new_client,
          client_type: client.client_type,
          business_name: client.business_name,
          has_tax_returns: client.has_tax_returns,
          is_service_only: !client.has_tax_returns,  # Backward compatibility
          archived_at: client.archived_at,
          created_at: client.created_at,
          service_types: client.service_types.map do |st|
            { id: st.id, name: st.name, color: st.color }
          end,
          contacts: client.client_contacts.order(is_primary: :desc, created_at: :asc).map { |contact| contact_summary(contact) },
          tax_return: latest_return ? {
            id: latest_return.id,
            tax_year: latest_return.tax_year,
            status: latest_return.workflow_stage&.name || "Unknown",
            status_slug: latest_return.workflow_stage&.slug || "unknown",
            status_color: latest_return.workflow_stage&.color,
            assigned_to: latest_return.assigned_to&.full_name
          } : nil
        }
      end

      def client_detail(client)
        {
          id: client.id,
          first_name: client.first_name,
          last_name: client.last_name,
          full_name: client.full_name,
          date_of_birth: client.date_of_birth,
          email: client.email,
          phone: client.phone,
          mailing_address: client.mailing_address,
          filing_status: client.filing_status,
          is_new_client: client.is_new_client,
          has_prior_year_return: client.has_prior_year_return,
          changes_from_prior_year: client.changes_from_prior_year,
          spouse_name: client.spouse_name,
          spouse_dob: client.spouse_dob,
          denied_eic_actc: client.denied_eic_actc,
          denied_eic_actc_year: client.denied_eic_actc_year,
          has_crypto_transactions: client.has_crypto_transactions,
          wants_direct_deposit: client.wants_direct_deposit,
          client_type: client.client_type,
          business_name: client.business_name,
          has_tax_returns: client.has_tax_returns,
          is_service_only: !client.has_tax_returns,  # Backward compatibility
          archived_at: client.archived_at,
          notification_preference: client.notification_preference,
          has_portal_access: client.user&.portal_active? || false,
          portal_invite_pending: client.user&.portal_invite_pending? || false,
          service_types: client.service_types.map do |st|
            { id: st.id, name: st.name, color: st.color, description: st.description }
          end,
          contacts: client.client_contacts.order(is_primary: :desc, created_at: :asc).map { |contact| contact_summary(contact) },
          created_at: client.created_at,
          updated_at: client.updated_at,
          dependents: client.dependents.map do |dep|
            {
              id: dep.id,
              name: dep.name,
              date_of_birth: dep.date_of_birth,
              relationship: dep.relationship,
              months_lived_with_client: dep.months_lived_with_client,
              is_student: dep.is_student,
              is_disabled: dep.is_disabled
            }
          end,
          tax_returns: client.tax_returns.order(created_at: :desc).map do |tr|
            {
              id: tr.id,
              tax_year: tr.tax_year,
              notes: tr.notes,
              status: tr.workflow_stage&.name,
              status_slug: tr.workflow_stage&.slug,
              status_color: tr.workflow_stage&.color,
              assigned_to: tr.assigned_to ? {
                id: tr.assigned_to.id,
                name: tr.assigned_to.full_name
              } : nil,
              created_at: tr.created_at,
              income_sources: tr.income_sources.map do |src|
                { id: src.id, source_type: src.source_type, payer_name: src.payer_name }
              end,
              workflow_events: tr.workflow_events.recent.limit(10).map do |event|
                {
                  id: event.id,
                  event_type: event.event_type,
                  old_value: event.old_value,
                  new_value: event.new_value,
                  description: event.description,
                  actor: event.actor_name,
                  created_at: event.created_at
                }
              end
            }
          end
        }
      end

      def create_contacts_for_client(client)
        return unless client.client_type == "business"

        contacts = contacts_payload
        if contacts.any?
          contacts.each_with_index do |contact, index|
            contact[:is_primary] = true if index.zero? && contacts.none? { |c| c[:is_primary] }
            client.client_contacts.create!(contact)
          end
        else
          client.client_contacts.create!(
            first_name: client.first_name,
            last_name: client.last_name,
            email: client.email,
            phone: client.phone,
            role: "Primary",
            is_primary: true
          )
        end
      end

      def contacts_payload
        raw = params.dig(:client, :contacts)
        return [] unless raw.is_a?(Array)

        raw.map do |contact|
          permitted = if contact.is_a?(ActionController::Parameters)
            contact.permit(:first_name, :last_name, :email, :phone, :role, :is_primary)
          else
            ActionController::Parameters
              .new(contact)
              .permit(:first_name, :last_name, :email, :phone, :role, :is_primary)
          end

          permitted.to_h
        end
      end

      def contact_summary(contact)
        {
          id: contact.id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          full_name: contact.full_name,
          email: contact.email,
          phone: contact.phone,
          role: contact.role,
          is_primary: contact.is_primary
        }
      end
    end
  end
end
