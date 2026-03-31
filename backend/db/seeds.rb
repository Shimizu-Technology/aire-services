# frozen_string_literal: true

# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).

puts "Seeding database..."

# ============================================
# Workflow Stages (Configurable)
# ============================================
puts "Creating workflow stages..."

workflow_stages = [
  { name: "Intake Received", slug: "intake_received", position: 1, color: "#6B7280", notify_client: false, description: "Client submitted intake form" },
  { name: "Documents Pending", slug: "documents_pending", position: 2, color: "#F59E0B", notify_client: true, description: "Waiting for client documents (W-2s, 1099s, etc.)" },
  { name: "In Preparation", slug: "in_preparation", position: 3, color: "#3B82F6", notify_client: false, description: "Tax preparer is working on the return" },
  { name: "In Review", slug: "in_review", position: 4, color: "#8B5CF6", notify_client: false, description: "Return is being reviewed by supervisor" },
  { name: "Ready to Sign", slug: "ready_to_sign", position: 5, color: "#10B981", notify_client: true, description: "Return is ready for client signature" },
  { name: "Filing", slug: "filing", position: 6, color: "#06B6D4", notify_client: false, description: "Return is being submitted to IRS/Guam DRT" },
  { name: "Ready for Pickup", slug: "ready_for_pickup", position: 7, color: "#22C55E", notify_client: true, description: "Return is complete and ready for client pickup" },
  { name: "Complete", slug: "complete", position: 8, color: "#64748B", notify_client: false, description: "Return has been picked up, case closed" }
]

workflow_stages.each do |attrs|
  stage = WorkflowStage.find_or_initialize_by(slug: attrs[:slug])
  stage.assign_attributes(attrs)
  stage.save!
  puts "  ✓ #{stage.name}"
end

# ============================================
# Time Categories (Configurable)
# ============================================
puts "Creating time categories..."

time_categories = [
  { name: "Tax Preparation", description: "Preparing individual or business tax returns" },
  { name: "Client Consultation", description: "Meetings, calls, and emails with clients" },
  { name: "Document Review", description: "Reviewing client-submitted documents" },
  { name: "Administrative", description: "General office and administrative tasks" },
  { name: "Training", description: "Professional development and training" }
]

time_categories.each do |attrs|
  category = TimeCategory.find_or_initialize_by(name: attrs[:name])
  category.assign_attributes(attrs)
  category.save!
  puts "  ✓ #{category.name}"
end

# ============================================
# Schedule Time Presets (Configurable)
# ============================================
puts "Creating schedule time presets..."

schedule_presets = [
  { label: "8-1", start_time: "08:00", end_time: "13:00", position: 0 },
  { label: "8-5", start_time: "08:00", end_time: "17:00", position: 1 },
  { label: "8:30-5", start_time: "08:30", end_time: "17:00", position: 2 },
  { label: "9-5", start_time: "09:00", end_time: "17:00", position: 3 },
  { label: "12:30-5", start_time: "12:30", end_time: "17:00", position: 4 },
  { label: "1-5", start_time: "13:00", end_time: "17:00", position: 5 }
]

schedule_presets.each do |attrs|
  preset = ScheduleTimePreset.find_or_initialize_by(label: attrs[:label])
  preset.assign_attributes(attrs)
  preset.save!
  puts "  ✓ #{preset.label}"
end

# ============================================
# Service Types (Configurable)
# ============================================
puts "Creating service types..."

service_types_data = [
  {
    name: "Tax Preparation & Planning",
    description: "Expert tax preparation for individuals and businesses",
    color: "#3B82F6",
    position: 1,
    tasks: [
      "Individual tax returns (Form 1040)",
      "Business tax returns (1120, 1120S, 1065)",
      "Guam and federal tax filing",
      "Tax planning and strategy",
      "Prior year returns and amendments"
    ]
  },
  {
    name: "Accounting & Bookkeeping",
    description: "Comprehensive accounting services for your business",
    color: "#10B981",
    position: 2,
    tasks: [
      "Monthly bookkeeping",
      "Account reconciliation",
      "General ledger maintenance",
      "Chart of accounts setup",
      "Clean-up and catch-up services"
    ]
  },
  {
    name: "Payroll & Compliance",
    description: "Reliable payroll processing and compliance support",
    color: "#F59E0B",
    position: 3,
    tasks: [
      "Payroll processing",
      "Payroll tax filings",
      "W-2 and 1099 preparation",
      "New hire reporting",
      "Compliance monitoring"
    ]
  },
  {
    name: "Financial Statement Preparation",
    description: "Clear, accurate financial statements for your business",
    color: "#8B5CF6",
    position: 4,
    tasks: [
      "Balance sheets",
      "Income statements",
      "Cash flow statements",
      "Custom financial reports",
      "Trend analysis"
    ]
  },
  {
    name: "Business Advisory & Consulting",
    description: "Strategic guidance to help you achieve your business goals",
    color: "#EC4899",
    position: 5,
    tasks: [
      "Business entity selection",
      "Financial planning",
      "Cash flow management",
      "Growth strategy",
      "Exit planning"
    ]
  },
  {
    name: "QuickBooks & Cloud Accounting",
    description: "Expert setup and support for cloud-based accounting",
    color: "#06B6D4",
    position: 6,
    tasks: [
      "QuickBooks setup and training",
      "Data migration",
      "Cloud accounting solutions",
      "Software integration",
      "Ongoing support"
    ]
  },
  {
    name: "General/Administrative",
    description: "Internal work, meetings, and administrative tasks",
    color: "#6B7280",
    position: 7,
    tasks: [
      "Team meeting",
      "Training",
      "Administrative work",
      "Client communication",
      "Other"
    ]
  }
]

service_types_data.each do |st_data|
  service_type = ServiceType.find_or_initialize_by(name: st_data[:name])
  service_type.assign_attributes(
    description: st_data[:description],
    color: st_data[:color],
    position: st_data[:position],
    is_active: true
  )
  service_type.save!
  puts "  ✓ #{service_type.name}"

  # Create tasks for this service type
  st_data[:tasks].each_with_index do |task_name, index|
    task = ServiceTask.find_or_initialize_by(
      service_type: service_type,
      name: task_name
    )
    task.assign_attributes(
      position: index + 1,
      is_active: true
    )
    task.save!
  end
  puts "    └─ #{st_data[:tasks].count} tasks"
end

# ============================================
# Operation Templates (Configurable)
# ============================================
puts "Creating operation templates..."

operation_templates_data = [
  {
    name: "Biweekly Payroll Processing",
    description: "Standard payroll operations cycle for biweekly payroll clients.",
    category: "payroll",
    recurrence_type: "biweekly",
    auto_generate: true,
    tasks: [
      { title: "Receive hours/input from client", evidence_required: false },
      { title: "Validate hours/overtime/adjustments", evidence_required: false },
      { title: "Process payroll", evidence_required: false },
      { title: "Internal review/approval", evidence_required: false },
      { title: "Deliver checks / confirm disbursement", evidence_required: true },
      { title: "Drop FIT and related checks to Treasurer of Guam", evidence_required: true },
      { title: "Confirm filing/payment receipts recorded", evidence_required: true },
      { title: "Send payroll completion update to client", evidence_required: false }
    ]
  },
  {
    name: "Monthly Bookkeeping Close",
    description: "Recurring month-end bookkeeping and reporting checklist.",
    category: "bookkeeping",
    recurrence_type: "monthly",
    auto_generate: true,
    tasks: [
      { title: "Collect missing documents/transactions", evidence_required: false },
      { title: "Reconcile bank and credit card accounts", evidence_required: false },
      { title: "Post adjusting entries", evidence_required: false },
      { title: "Review financial reports internally", evidence_required: false },
      { title: "Deliver monthly summary to client", evidence_required: true }
    ]
  },
  {
    name: "Quarterly Compliance Checklist",
    description: "Quarterly filing and compliance operational checklist.",
    category: "compliance",
    recurrence_type: "quarterly",
    auto_generate: true,
    tasks: [
      { title: "Compile quarterly data package", evidence_required: false },
      { title: "Validate filing/payment obligations", evidence_required: false },
      { title: "Submit required filings", evidence_required: true },
      { title: "Record confirmation numbers/receipts", evidence_required: true },
      { title: "Send compliance update to client", evidence_required: false }
    ]
  }
]

operation_templates_data.each do |template_data|
  template = OperationTemplate.find_or_initialize_by(name: template_data[:name])
  template.assign_attributes(
    description: template_data[:description],
    category: template_data[:category],
    recurrence_type: template_data[:recurrence_type],
    auto_generate: template_data[:auto_generate],
    is_active: true
  )
  template.save!
  puts "  ✓ #{template.name}"

  template_data[:tasks].each_with_index do |task_data, index|
    task = OperationTemplateTask.find_or_initialize_by(
      operation_template: template,
      title: task_data[:title]
    )
    task.assign_attributes(
      position: index + 1,
      evidence_required: task_data[:evidence_required],
      is_active: true
    )
    task.save!
  end
  puts "    └─ #{template_data[:tasks].count} tasks"
end

# ============================================
# Staff Users (Development only)
# ============================================
if Rails.env.development? || Rails.env.test?
  puts "Creating staff users for development..."

  staff_users = [
    { email: "shimizutechnology@gmail.com", first_name: "Leon", role: "admin" },
    { email: "lmshimizu@gmail.com", first_name: "Leon", role: "admin" },
    { email: "dmshimizucpa@gmail.com", first_name: "Dafne", role: "admin" },
    { email: "audreana.lett@gmail.com", first_name: "Audreana", role: "employee" },
    { email: "kamisirenacruz99@gmail.com", first_name: "Kami", role: "employee" },
    { email: "kyleiahmoana@gmail.com", first_name: "Ky", role: "employee" },
    { email: "lannikcru@gmail.com", first_name: "Alanna", role: "employee" }
  ]

  staff_users.each do |attrs|
    user = User.find_or_initialize_by(email: attrs[:email])
    # Only update if new record or if first_name is blank
    if user.new_record?
      user.assign_attributes(
        first_name: attrs[:first_name],
        role: attrs[:role],
        clerk_id: "dev_#{SecureRandom.hex(8)}" # Placeholder for dev
      )
      user.save!
      puts "  ✓ Created #{attrs[:first_name]} (#{attrs[:email]})"
    elsif user.first_name.blank?
      user.update!(first_name: attrs[:first_name])
      puts "  ✓ Updated #{attrs[:first_name]} (#{attrs[:email]})"
    else
      puts "  - Skipped #{attrs[:email]} (already exists)"
    end
  end
end

# ── Time Clock Settings ──
puts ""
puts "Creating time clock settings..."
{
  "overtime_daily_threshold_hours" => { value: "8", desc: "Daily hours before overtime (default: 8)" },
  "overtime_weekly_threshold_hours" => { value: "40", desc: "Weekly hours before overtime (default: 40)" },
  "early_clock_in_buffer_minutes" => { value: "5", desc: "Minutes before scheduled start that clock-in is allowed (default: 5)" }
}.each do |key, attrs|
  setting = Setting.find_or_initialize_by(key: key)
  if setting.new_record?
    setting.update!(value: attrs[:value], description: attrs[:desc])
    puts "  ✓ #{key} = #{attrs[:value]}"
  else
    puts "  - #{key} already set (#{setting.value})"
  end
end

puts ""
puts "✅ Seeding complete!"
puts "   - #{WorkflowStage.count} workflow stages"
puts "   - #{TimeCategory.count} time categories"
puts "   - #{ScheduleTimePreset.count} schedule time presets"
puts "   - #{ServiceType.count} service types"
puts "   - #{ServiceTask.count} service tasks"
puts "   - #{OperationTemplate.count} operation templates"
puts "   - #{OperationTemplateTask.count} operation template tasks"
puts "   - #{User.count} users" if Rails.env.development? || Rails.env.test?