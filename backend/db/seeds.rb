# frozen_string_literal: true

# This file should ensure the existence of records required to run the application in every environment
# (development, test, production). Keep it idempotent.

puts "Seeding AIRE Services data..."

# ============================================
# Workflow Stages (legacy scaffold, renamed for AIRE)
# Keep the established slugs stable for any code paths that still reference them.
# ============================================
puts "Creating workflow stages..."

workflow_stages = [
  {
    name: "Inquiry Received",
    slug: "intake_received",
    position: 1,
    color: "#64748B",
    notify_client: false,
    description: "A new student, renter, or operations request has been captured."
  },
  {
    name: "Details Needed",
    slug: "documents_pending",
    position: 2,
    color: "#F59E0B",
    notify_client: true,
    description: "Waiting on required onboarding details, scheduling info, or follow-up materials."
  },
  {
    name: "In Progress",
    slug: "in_preparation",
    position: 3,
    color: "#3B82F6",
    notify_client: false,
    description: "The AIRE team is actively working the request or student workflow."
  },
  {
    name: "Internal Review",
    slug: "in_review",
    position: 4,
    color: "#8B5CF6",
    notify_client: false,
    description: "An internal review or approval step is in progress."
  },
  {
    name: "Ready for Confirmation",
    slug: "ready_to_sign",
    position: 5,
    color: "#10B981",
    notify_client: true,
    description: "Ready for student/staff confirmation or next-step acknowledgement."
  },
  {
    name: "Final Processing",
    slug: "filing",
    position: 6,
    color: "#06B6D4",
    notify_client: false,
    description: "The final internal processing step is underway."
  },
  {
    name: "Ready for Next Step",
    slug: "ready_for_pickup",
    position: 7,
    color: "#22C55E",
    notify_client: true,
    description: "The request is ready for the student, renter, or staff member to act on."
  },
  {
    name: "Complete",
    slug: "complete",
    position: 8,
    color: "#475569",
    notify_client: false,
    description: "The workflow is complete."
  }
]

workflow_stages.each do |attrs|
  stage = WorkflowStage.find_or_initialize_by(slug: attrs[:slug])
  stage.assign_attributes(attrs)
  stage.save!
  puts "  ✓ #{stage.name}"
end

# ============================================
# Time Categories
# ============================================
puts "Creating time categories..."

time_categories = [
  { name: "Flight Instruction", description: "Instructor-led flight training time." },
  { name: "Ground School", description: "Classroom, briefing, or academic instruction." },
  { name: "Discovery Flight", description: "Introductory flight experiences for prospective students." },
  { name: "Aircraft Prep", description: "Preflight setup, turnaround, and aircraft readiness work." },
  { name: "Student Support", description: "Student scheduling, check-ins, and support communication." },
  { name: "Administrative", description: "General office and operations administration." },
  { name: "Training", description: "Internal staff training and professional development." }
]

time_categories.each do |attrs|
  category = TimeCategory.find_or_initialize_by(name: attrs[:name])
  category.assign_attributes(attrs)
  category.save!
  puts "  ✓ #{category.name}"
end

# ============================================
# Schedule Time Presets
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
# Service Types
# ============================================
puts "Creating service types..."

service_types_data = [
  {
    name: "Discovery Flights",
    description: "First-flight experiences for prospective pilots.",
    color: "#06B6D4",
    position: 1,
    tasks: [
      "Inquiry follow-up",
      "Flight scheduling",
      "Pre-flight briefing",
      "Discovery flight execution",
      "Post-flight follow-up"
    ]
  },
  {
    name: "Private Pilot Training",
    description: "Core flight and ground instruction for certificate-track students.",
    color: "#3B82F6",
    position: 2,
    tasks: [
      "Ground instruction",
      "Flight lesson",
      "Student progress review",
      "Checkride preparation",
      "Lesson debrief"
    ]
  },
  {
    name: "Aircraft Rental Support",
    description: "Operational support for approved renter activity.",
    color: "#22C55E",
    position: 3,
    tasks: [
      "Checkout coordination",
      "Scheduling and dispatch",
      "Aircraft readiness check",
      "Rental documentation review",
      "Post-flight wrap-up"
    ]
  },
  {
    name: "Student Success & Scheduling",
    description: "Communication, onboarding, and schedule coordination for active students.",
    color: "#8B5CF6",
    position: 4,
    tasks: [
      "New student onboarding",
      "Scheduling updates",
      "Student communications",
      "Attendance follow-up",
      "Progress check-in"
    ]
  },
  {
    name: "Operations & Admin",
    description: "Internal operations, staffing, and admin support.",
    color: "#64748B",
    position: 5,
    tasks: [
      "Team meeting",
      "Administrative work",
      "Operations planning",
      "Internal training",
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
# Operation Templates
# ============================================
puts "Creating operation templates..."

operation_templates_data = [
  {
    name: "Weekly Flight Schedule Review",
    description: "Review instructor coverage, aircraft availability, and student lessons for the upcoming week.",
    category: "general",
    recurrence_type: "weekly",
    auto_generate: true,
    tasks: [
      { title: "Review active student lesson cadence", evidence_required: false },
      { title: "Confirm instructor availability", evidence_required: false },
      { title: "Check aircraft scheduling conflicts", evidence_required: false },
      { title: "Publish schedule updates", evidence_required: true }
    ]
  },
  {
    name: "Discovery Flight Follow-Up",
    description: "Standard follow-up flow after discovery flight inquiries and completed intro flights.",
    category: "general",
    recurrence_type: "custom",
    recurrence_interval: 1,
    auto_generate: false,
    tasks: [
      { title: "Confirm inquiry details", evidence_required: false },
      { title: "Schedule or confirm intro flight", evidence_required: false },
      { title: "Send follow-up message after flight", evidence_required: true },
      { title: "Record next-step interest", evidence_required: false }
    ]
  },
  {
    name: "Monthly Ops Admin Review",
    description: "Recurring monthly admin review for staffing, attendance, and operations housekeeping.",
    category: "general",
    recurrence_type: "monthly",
    auto_generate: true,
    tasks: [
      { title: "Review attendance and time-entry exceptions", evidence_required: false },
      { title: "Review kiosk PIN and staff access changes", evidence_required: false },
      { title: "Confirm schedule preset and staffing needs", evidence_required: false },
      { title: "Document action items for next month", evidence_required: true }
    ]
  }
]

operation_templates_data.each do |template_data|
  template = OperationTemplate.find_or_initialize_by(name: template_data[:name])
  template.assign_attributes(
    description: template_data[:description],
    category: template_data[:category],
    recurrence_type: template_data[:recurrence_type],
    recurrence_interval: template_data[:recurrence_interval],
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
# Staff Users (development / test only)
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
    if user.new_record?
      user.assign_attributes(
        first_name: attrs[:first_name],
        role: attrs[:role],
        clerk_id: "dev_#{SecureRandom.hex(8)}"
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

# ============================================
# Time Clock Settings
# ============================================
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
