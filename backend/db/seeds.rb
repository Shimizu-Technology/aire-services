# frozen_string_literal: true

puts "Seeding AIRE Services database..."

# ============================================
# Time Categories
# ============================================
puts "Creating time categories..."

time_categories = [
  { name: "Flight Instruction", key: "aire_flight_instruction", description: "CFI flight instruction hours" },
  { name: "Ground School", key: "aire_ground_school", description: "Ground instruction and briefings" },
  { name: "Aircraft Maintenance", key: "aire_maintenance", description: "Aircraft maintenance and inspections" },
  { name: "Office / Admin", key: "aire_admin", description: "Office and administrative tasks" },
  { name: "Dispatch / Ops", key: "aire_dispatch", description: "Flight dispatch, scheduling, and operations" },
  { name: "Training", key: "aire_training", description: "Staff training and professional development" }
]

time_categories.each do |attrs|
  category = TimeCategory.find_or_initialize_by(key: attrs[:key])
  category.assign_attributes(attrs)
  category.save!
  puts "  #{category.name}"
end

# ============================================
# Schedule Time Presets
# ============================================
puts "Creating schedule time presets..."

schedule_presets = [
  { label: "6-2", start_time: "06:00", end_time: "14:00", position: 0 },
  { label: "7-3", start_time: "07:00", end_time: "15:00", position: 1 },
  { label: "8-5", start_time: "08:00", end_time: "17:00", position: 2 },
  { label: "9-5", start_time: "09:00", end_time: "17:00", position: 3 },
  { label: "9-1", start_time: "09:00", end_time: "13:00", position: 4 },
  { label: "1-5", start_time: "13:00", end_time: "17:00", position: 5 }
]

schedule_presets.each do |attrs|
  preset = ScheduleTimePreset.find_or_initialize_by(label: attrs[:label])
  preset.assign_attributes(attrs)
  preset.save!
  puts "  #{preset.label}"
end

# ============================================
# Time Clock Settings
# ============================================
puts "Creating time clock settings..."

{
  "overtime_daily_threshold_hours" => { value: "8", desc: "Daily hours before overtime (default: 8)" },
  "overtime_weekly_threshold_hours" => { value: "40", desc: "Weekly hours before overtime (default: 40)" },
  "early_clock_in_buffer_minutes" => { value: "5", desc: "Minutes before scheduled start that clock-in is allowed (default: 5)" }
}.each do |key, attrs|
  setting = Setting.find_or_initialize_by(key: key)
  if setting.new_record?
    setting.update!(value: attrs[:value], description: attrs[:desc])
    puts "  #{key} = #{attrs[:value]}"
  else
    puts "  #{key} already set (#{setting.value})"
  end
end

# ============================================
# Development Staff Users
# ============================================
if Rails.env.development? || Rails.env.test?
  puts "Creating development staff users..."

  staff_users = [
    { email: "shimizutechnology@gmail.com", first_name: "Leon", role: "admin" },
    { email: "lmshimizu@gmail.com", first_name: "Leon", role: "admin" }
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
      puts "  Created #{attrs[:first_name]} (#{attrs[:email]})"
    else
      puts "  Skipped #{attrs[:email]} (already exists)"
    end
  end
end

puts ""
puts "Seeding complete!"
puts "  #{TimeCategory.count} time categories"
puts "  #{ScheduleTimePreset.count} schedule time presets"
puts "  #{Setting.count} settings"
puts "  #{User.count} users" if Rails.env.development? || Rails.env.test?
