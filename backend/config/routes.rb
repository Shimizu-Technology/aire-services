Rails.application.routes.draw do
  mount ActionCable.server => "/cable"

  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      # Auth
      get "auth/me", to: "auth#me"
      post "auth/me", to: "auth#me"
      post "auth/kiosk_pin", to: "auth#update_kiosk_pin"

      # Public marketing/contact
      post "contact", to: "contact#create"
      resource :contact_settings, only: [ :show ]
      resources :team_members, only: [ :index ]

      # Public kiosk endpoints
      namespace :aire do
        post "kiosk/verify", to: "kiosk#verify"
        post "kiosk/clock_in", to: "kiosk#clock_in"
        post "kiosk/clock_out", to: "kiosk#clock_out"
        post "kiosk/start_break", to: "kiosk#start_break"
        post "kiosk/end_break", to: "kiosk#end_break"
        post "kiosk/switch_category", to: "kiosk#switch_category"
      end

      # Staff/admin routes
      resources :users, only: [ :index ]
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
      resources :time_period_locks, only: [ :index ]
      resources :schedule_time_presets, only: [ :index ]
      resources :schedules, only: [ :index, :show, :create, :update, :destroy ] do
        collection do
          get :my_schedule
          post :bulk_create
          delete :clear_week
        end
      end

      namespace :admin do
        resource :settings, only: [ :show, :update ]
        resources :users, only: [ :index, :show, :create, :update, :destroy ] do
          member do
            post :resend_invite
            post :reset_kiosk_pin
          end
        end
        resource :contact_settings, only: [ :show, :update ], controller: "contact_settings"
        get "settings", to: "settings#index"
        patch "settings", to: "settings#update"
        resources :time_categories, only: [ :index, :show, :create, :update, :destroy ]
        resources :time_period_locks, only: [ :create, :destroy ]
        resources :employee_pay_rates, only: [ :index, :create, :update, :destroy ] do
          collection do
            get "for_user/:user_id", action: :for_user, as: :for_user
          end
        end
      end
    end
  end
end
