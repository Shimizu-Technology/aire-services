namespace :operations do
  desc "Auto-generate operation cycles for eligible assignments"
  task auto_generate: :environment do
    run_date = ENV["RUN_DATE"] ? Date.parse(ENV["RUN_DATE"]) : Date.current
    result = AutoGenerateOperationCyclesService.new(run_date: run_date).call

    puts "Operations auto-generation finished"
    puts "  Run date: #{run_date}"
    puts "  Generated cycles: #{result.generated_count}"
    puts "  Skipped: #{result.skipped_count}"
    if result.errors.any?
      puts "  Errors:"
      result.errors.each { |error| puts "    - #{error}" }
      exit(1)
    end
  end
end
