# frozen_string_literal: true

namespace :users do
  desc "Populate first names for existing Cornerstone staff"
  task populate_names: :environment do
    puts "Populating user first names..."

    # Map of emails to first names (Cornerstone staff)
    staff_names = {
      "shimizutechnology@gmail.com" => "Leon",
      "lmshimizu@gmail.com" => "Leon",
      "dmshimizucpa@gmail.com" => "Dafne",
      "audreana.lett@gmail.com" => "Audreana",
      "kamisirenacruz99@gmail.com" => "Kami",
      "kyleiahmoana@gmail.com" => "Ky",
      "lannikcru@gmail.com" => "Alanna"
    }

    updated = 0
    not_found = []

    staff_names.each do |email, first_name|
      user = User.find_by("LOWER(email) = ?", email.downcase)
      
      if user
        if user.first_name.blank?
          user.update!(first_name: first_name)
          puts "  ✓ Updated #{email} → #{first_name}"
          updated += 1
        else
          puts "  - Skipped #{email} (already has name: #{user.first_name})"
        end
      else
        puts "  ✗ Not found: #{email}"
        not_found << email
      end
    end

    puts ""
    puts "✅ Done!"
    puts "   Updated: #{updated} users"
    puts "   Not found: #{not_found.count} users" if not_found.any?
  end
end
