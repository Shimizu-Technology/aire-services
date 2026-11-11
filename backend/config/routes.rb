Rails.application.routes.draw do
  mount ActionCable.server => "/cable"

  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      # Auth
      get "auth/me", to: "auth#me"
      post "auth/me", to: "auth#me"
      post "auth/kiosk_pin", to: "auth#update_kiosk_pin"
      # What each role can do, for the Roles & access page
      resource :access_guide, only: [ :show ]

      resources :staging_images, only: [ :show ], path: "staging-images"

      # Public marketing/contact
      post "contact", to: "contact#create"
      resource :contact_settings, only: [ :show ]
      resources :team_members, only: [ :index ]
      resources :site_media, only: [ :index ], path: "site-media"

      # Read-only My Pay preview for owners and admins (the preview_pay capability)
      scope "my_pay/preview", controller: :my_pay_previews, as: :my_pay_preview, format: false do
        get "workers", action: :workers, as: :workers
        get "workers/:user_id", action: :worker, as: :worker
        get "workers/:user_id/statements", action: :index, as: :statements
        get "workers/:user_id/statements/:id", action: :show, as: :statement
        get "workers/:user_id/statements/:id/pdf", action: :pdf, as: :statement_pdf
      end

      # The signed-in worker's own pay statements (proxied from Cornerstone)
      resources :my_pay, only: [ :index, :show ], controller: :my_pay, format: false do
        get :pdf, on: :member
      end
      # "Email me this stub": a secure link to one of the worker's own stubs
      post "my_pay/:id/email", to: "my_pay_emails#create", as: :my_pay_email, format: false

      # Senders' pay stub tools (send_pay_statements: owners, admins, managers)
      namespace :pay_stubs do
        resources :workers, only: [ :index, :show ] do
          get :statements, on: :member
        end
        resources :requests, only: [ :index ] do
          post :dismiss, on: :member
        end
        resources :links, only: [ :index, :create ] do
          post :revoke, on: :member
        end
        resource :notification_emails, only: [ :show, :update ]
      end

      # Public secure-link page; the token is sent in the request body
      post "pay_stub_links/lookup", to: "pay_stub_links#lookup"
      post "pay_stub_links/download", to: "pay_stub_links#download"
      post "pay_stub_links/download_all", to: "pay_stub_links#download_all"

      get "payroll_cutoff", to: "payroll_cutoffs#show"
      post "payroll_cutoff/acknowledge", to: "payroll_cutoffs#acknowledge"
      post "payroll_cutoff/lock_time", to: "payroll_cutoffs#change_lock_time"
      post "aire/kiosk/cutoff", to: "payroll_cutoffs#kiosk"
      post "aire/kiosk/cutoff/acknowledge", to: "payroll_cutoffs#kiosk_acknowledge"

      # Public kiosk endpoints
      namespace :aire do
        post "kiosk/verify", to: "kiosk#verify"
        post "kiosk/clock_in", to: "kiosk#clock_in"
        post "kiosk/clock_out", to: "kiosk#clock_out"
        post "kiosk/start_break", to: "kiosk#start_break"
        post "kiosk/end_break", to: "kiosk#end_break"
        post "kiosk/switch_category", to: "kiosk#switch_category"
        post "kiosk/pay_stubs/choices", to: "kiosk_pay_stubs#choices"
        post "kiosk/pay_stubs", to: "kiosk_pay_stubs#create"
      end

      namespace :payroll do
        resource :time_summary, only: [ :show ], controller: :time_summaries
        resources :account_link_sessions, only: [ :create, :show ], param: :token do
          post :authorize, on: :member
        end
        resources :account_links, only: [ :show, :destroy ], param: :external_actor_id
        resources :calendar_periods, only: [ :index, :show, :update ], param: :id
        resources :batches, only: [ :index, :show ] do
          member do
            post :processing_events
            post :obligation_events
          end
        end

        namespace :cockpit do
          resources :employees, only: [ :index, :show ] do
            resources :periods, only: [ :index, :show ], controller: :employee_periods
          end
          resources :history_entries, only: [ :index ]
          resources :manual_allocations, only: [ :index, :create ] do
            member do
              post :issue
              post :cancel_payment
              post :void
            end
          end
          resources :payment_attestations, only: [ :index, :create ] do
            post :retract, on: :member
            post :resolve, on: :member
          end

          resources :exceptions, only: [ :index ]
          resource :manual_review, only: [ :show ]
          resources :time_entries, only: [ :index, :show ] do
            member do
              post :approval
              post :overtime_approval
            end
            resource :correction, only: [ :create ], controller: :time_entry_corrections
          end
          resources :settlement_cases, only: [ :index ], param: :id do
            member do
              post :route, action: :route_case
              post :acknowledge
            end
          end
          resources :periods, only: [ :show ], param: :id do
            post "late_hours/:source_command_id/recover", to: "late_hours#recover"
            post "late_hours/:source_command_id/cancel", to: "late_hours#cancel"
            resource :late_hours, only: [ :show, :create ], controller: :late_hours
            member do
              post :finalize
            end
          end
        end
      end

      # Staff/admin routes
      resources :users, only: [ :index ]
      resources :leave_requests, only: [ :index, :show, :create ] do
        member do
          post :approve
          post :decline
          post :cancel
        end
      end
      resources :time_entries, only: [ :index, :show, :create, :update, :destroy ] do
        collection do
          post :clock_in
          post :clock_out
          post :start_break
          post :end_break
          post :switch_category
          post :bulk_approve
          get :current_status
          get :pending_approvals
          get :whos_working
        end
        member do
          post :approve
          post :deny
          post :approve_overtime
          post :deny_overtime
        end
      end
      resources :time_categories, only: [ :index ]
      resources :schedule_time_presets, only: [ :index ]
      resources :schedules, only: [ :index, :show, :create, :update, :destroy ] do
        collection do
          get :my_schedule
          post :bulk_create
          delete :clear_week
        end
      end

      namespace :admin do
        resources :audit_logs, only: [ :index, :show ] do
          collection do
            get :export
          end
        end
        resources :payroll_batches, only: [ :index, :show, :create ] do
          collection do
            post :preview
            get :carryovers
          end
          member do
            get :export
          end
        end
        resource :kiosk_session, only: [ :create ]
        get "settings/geocode", to: "settings#geocode"
        get "settings/place_autocomplete", to: "settings#place_autocomplete"
        get "settings/place_details", to: "settings#place_details"
        resource :settings, only: [ :show, :update ]
        resources :users, only: [ :index, :show, :create, :update, :destroy ] do
          resources :periods, only: [ :index, :show ], controller: :employee_periods
          member do
            post :resend_invite
            post :reset_kiosk_pin
            post :terminate
            post :reactivate
            post :public_team_photo
            delete :public_team_photo, action: :destroy_public_team_photo
          end
        end
        resource :my_pay_access, only: [ :show, :update ], controller: "my_pay_access"
        patch "users/:user_id/my_pay", to: "my_pay_access#update_user", as: :user_my_pay
        resource :contact_settings, only: [ :show, :update ], controller: "contact_settings"
        resources :site_media, path: "site-media"
        get "settings", to: "settings#index"
        patch "settings", to: "settings#update"
        resources :time_categories, only: [ :index, :show, :create, :update, :destroy ]
        resource :hours_report, only: [ :show ], controller: "hours_reports" do
          get :pdf
          get :timesheet_pdf
          get :detailed_csv
          get :summary_csv
        end
      end
    end
  end
end
