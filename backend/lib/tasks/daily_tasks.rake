# frozen_string_literal: true

namespace :daily_tasks do
  desc "Seed daily tasks from Cornerstone's actual task list spreadsheet"
  task seed_from_spreadsheet: :environment do
    # Staff mapping (nickname → User record)
    staff_map = {}
    User.staff.each do |u|
      staff_map[u.first_name&.downcase] = u
    end
    # Special mapping: "DMS" = Dafne M Shimizu
    staff_map["dms"] = User.find_by(email: DailyTaskImportService::ADMIN_EMAIL)

    # The admin user who "created" these tasks
    admin_user = User.find_by(email: DailyTaskImportService::ADMIN_EMAIL) || User.admins.first

    # Status mapping from spreadsheet → our model statuses
    status_map = {
      "1 - Not Started" => "not_started",
      "2 - In Progress" => "in_progress",
      "3 - DMS Reviewing" => "dms_reviewing",
      "4 - Ready to collate/prep for filing" => "ready_to_file",
      "5 - Ready for Client Signature" => "ready_for_signature",
      "6 - Completed" => "completed",
      "7 - Completed - Filed with DRT" => "filed_with_drt",
      "8 - Completed - Filed with IRS" => "filed_with_irs",
      "9 - Pending Information" => "pending_info",
      "9 - Other" => "other",
      "10 - Other" => "other",
    }

    resolve_staff = ->(name, smap) do
      return nil if name.blank?
      smap[name.to_s.strip.downcase]
    end

    resolve_status = ->(raw, smap) do
      return "not_started" if raw.blank?
      smap[raw.to_s.strip] || "not_started"
    end

    # ═══════════════════════════════════════════
    # Sheet: 2026.03.19 (most recent, the latest)
    # ═══════════════════════════════════════════
    sheet_date_19 = Date.new(2026, 3, 19)
    tasks_19 = [
      { n: 1,  client: "Quinata, Ben & Ksenia",                    form: "1040SS",                                comments: "Mail with payment to IRS P.O. Box 1303, Charlotte NC 28201-1303", staff: "Leon", reviewed: "Kami", status: "6 - Completed", date: "2026-03-18", extra: "done 3/18/26 Leon/Kami" },
      { n: 2,  client: "Quinata, Ben & Ksenia",                    form: "1040",                                  comments: "File with Payment at DRT (Treasurer of Guam cashier)",             staff: "Leon", reviewed: "Kami", status: "6 - Completed", date: "2026-03-17", extra: "done 3/17/26 Leon/Kami" },
      { n: 3,  client: "Tajalle, Zelayne",                         form: "1040",                                  comments: "DMS reviewing for additional adjustments - DO NOT FILE",           staff: "Leon", reviewed: "Kami", status: "10 - Other",     date: nil,          extra: nil },
      { n: 4,  client: "MoSa's Hot Box Inc.",                      form: "Social Security/Medicare (FICA) - EFTPS", comments: nil,                                                               staff: "DMS",  reviewed: "Kami", status: "6 - Completed", date: "2026-03-18", extra: "done 3/18/26 - Leon/Kami please check the documents I left on your desk" },
      { n: 5,  client: "MoSa's Hot Box Inc.",                      form: "401K",                                  comments: nil,                                                               staff: "DMS",  reviewed: "Kami", status: "6 - Completed", date: "2026-03-18", extra: "done 3/18/26 - Leon/Kami please check the documents I left on your desk" },
      { n: 6,  client: "MoSa's Hot Box Inc.",                      form: "Washington Child Support",               comments: nil,                                                               staff: "DMS",  reviewed: "Kami", status: "6 - Completed", date: "2026-03-18", extra: "done 3/18/26 - Leon/Kami please check the documents I left on your desk" },
      { n: 7,  client: "MoSa's Hot Box Inc.",                      form: "Withholding",                           comments: "done in the prior week - Leon/Kami please confirm",               staff: "Leon", reviewed: "Kami", status: "7 - Completed - Filed with DRT", date: "2026-03-13", extra: "done 3/13/26 Leon/Kami" },
      { n: 8,  client: "MoSa's Hot Box Inc.",                      form: "Guam Child Support",                    comments: "done in the prior week - Leon/Kami please confirm",               staff: "Leon", reviewed: "Kami", status: "7 - Completed - Filed with DRT", date: "2026-03-13", extra: "done 3/13/26 Leon/Kami" },
      { n: 9,  client: "Duk Duk Goose, Inc.",                      form: "Social Security/Medicare (FICA) - EFTPS", comments: nil,                                                               staff: "DMS",  reviewed: "Kami", status: "6 - Completed", date: "2026-03-18", extra: "done 3/18/26 - Leon/Kami please check the documents I left on your desk" },
      { n: 10, client: "Duk Duk Goose, Inc.",                      form: "Withholding",                           comments: "done in the prior week - Leon/Kami please confirm",               staff: "Leon", reviewed: "Kami", status: "7 - Completed - Filed with DRT", date: "2026-03-13", extra: "done 3/13/26 Leon/Kami" },
      { n: 11, client: "Spike Coffee Roasters, LLC",               form: "Social Security/Medicare (FICA) - EFTPS", comments: "DMS to work on this",                                             staff: "DMS",  reviewed: "Kami", status: "1 - Not Started", date: nil,          extra: "please remind me to work on this 3/19/26" },
      { n: 12, client: "Spike Coffee Roasters, LLC",               form: "Withholding",                           comments: "done in the prior week - Leon/Kami please confirm",               staff: "Leon", reviewed: "Kami", status: "7 - Completed - Filed with DRT", date: "2026-03-13", extra: "done 3/13/26 Leon/Kami" },
      { n: 13, client: "Spike Coffee Roasters, LLC",               form: "GRT",                                   comments: "have to work on LECSB worksheet",                                 staff: "DMS",  reviewed: "Kami", status: "1 - Not Started", date: nil,          extra: "DMS to work on this - due date is 3/19/26" },
      { n: 14, client: "Aire Services, LLC",                       form: "Form 7004 Extension",                   comments: "pending being contacted by DRT as these were filed in drop box 3/16/26", staff: "Leon", reviewed: "Kami", status: "10 - Other", date: nil, extra: nil },
      { n: 15, client: "K Perez Insurance",                        form: "Form 7004 Extension",                   comments: "pending being contacted by DRT as these were filed in drop box 3/16/26", staff: "Leon", reviewed: "Kami", status: "10 - Other", date: nil, extra: nil },
      { n: 16, client: "MoSa's Hot Box Inc.",                      form: "Form 7004 Extension",                   comments: "pending being contacted by DRT as these were filed in drop box 3/16/26", staff: "Leon", reviewed: "Kami", status: "10 - Other", date: nil, extra: nil },
      { n: 17, client: "MoSa's Hot Box Inc.",                      form: "401k Census Data for Acensus",          comments: nil,                                                               staff: "DMS",  reviewed: "Kami", status: "10 - Other",     date: "2026-03-18", extra: "pending responses from APFMG" },
      { n: 18, client: "Anderson, Jake & Liannmarie",              form: "Form 1040 2025",                        comments: "Kami/Leon/Ky - please call Patti Cruz to advise that this is ready for signature", staff: "Ky", reviewed: "Kami", status: "5 - Ready for Client Signature", date: nil, extra: nil },
      { n: 19, client: "Doctor, Sara & Dennis",                    form: "Form 1040 2025",                        comments: "pending review by DMS",                                           staff: "DMS",  reviewed: "Kami", status: "3 - DMS Reviewing", date: nil, extra: nil },
      { n: 20, client: "Amani, Monique",                           form: "Form 1040 2025",                        comments: "pending review by DMS",                                           staff: "DMS",  reviewed: "Kami", status: "3 - DMS Reviewing", date: nil, extra: nil },
      { n: 21, client: "Mendiola, Tammy Lane",                     form: "Form 1040 2025",                        comments: "pending review by DMS",                                           staff: "DMS",  reviewed: "Kami", status: "3 - DMS Reviewing", date: nil, extra: nil },
      { n: 22, client: "Pleadwell, Emma",                          form: "Form 1040 2025",                        comments: "pending review by DMS",                                           staff: "DMS",  reviewed: "Kami", status: "3 - DMS Reviewing", date: nil, extra: nil },
      { n: 23, client: "Phillip, Charles",                         form: "Form 1040 2025",                        comments: "pending review by DMS",                                           staff: "DMS",  reviewed: "Kami", status: "3 - DMS Reviewing", date: nil, extra: nil },
      { n: 24, client: "Phillip, Douglas",                         form: "Form 1040 2025",                        comments: "pending review by DMS",                                           staff: "DMS",  reviewed: "Kami", status: "3 - DMS Reviewing", date: nil, extra: nil },
      { n: 25, client: "Narcis, Danzel & Bernadita",               form: "Form 1040 2025",                        comments: "pending review by DMS",                                           staff: "DMS",  reviewed: "Kami", status: "3 - DMS Reviewing", date: nil, extra: nil },
      { n: 26, client: "Narcis, Keoki",                            form: "Form 1040 2025",                        comments: "pending review by DMS",                                           staff: "DMS",  reviewed: "Kami", status: "3 - DMS Reviewing", date: nil, extra: nil },
      { n: 27, client: "Ellen, Deborah",                           form: "Form 1040 2025",                        comments: "Ky - can prepare file and tax return for DMS review",             staff: "Ky",   reviewed: "DMS",  status: "1 - Not Started", date: nil, extra: nil },
      { n: 28, client: "Castro, David & Patti",                    form: "Form 1040 2025",                        comments: "Kami/Leon/Ky - please call Patti Cruz to advise that this is ready for signature", staff: "Ky", reviewed: "Kami", status: "5 - Ready for Client Signature", date: nil, extra: "found by DMS" },
      { n: 29, client: "Castro, David & Patti",                    form: "Form 1040X 2024",                       comments: "Kami/Leon/Ky - please call Patti Cruz to advise that this is ready for signature", staff: "Ky", reviewed: "Kami", status: "5 - Ready for Client Signature", date: nil, extra: nil },
      { n: 30, client: "Robertson, Daniel and Marie Leon Guerrero", form: "Form 1040 2025",                       comments: "Ky - can prepare file and tax return for DMS review",             staff: "Ky",   reviewed: "DMS",  status: "1 - Not Started", date: nil, extra: nil },
      { n: 31, client: "Hechanova, Thelma",                        form: "Form 1040 2025",                        comments: "Ky - can prepare file and tax return for DMS review",             staff: "Ky",   reviewed: "DMS",  status: "1 - Not Started", date: nil, extra: nil },
      { n: 32, client: "MoSa's Hot Box Inc.",                      form: "GRT",                                   comments: "Leon/Kami - please check that this was paid last week",           staff: "Leon", reviewed: "Kami", status: "1 - Not Started", date: nil, extra: nil },
    ]

    created_count = 0

    # Clean existing tasks for these dates to allow re-running
    DailyTask.where(task_date: sheet_date_19).destroy_all

    ActiveRecord::Base.transaction do
      tasks_19.each do |t|
        assigned = resolve_staff.call(t[:staff], staff_map)
        reviewed = resolve_staff.call(t[:reviewed], staff_map)
        status = resolve_status.call(t[:status], status_map)

        full_comments = [t[:comments], t[:extra]].compact.join(" | ").presence

        completed_at = nil
        completed_by = nil
        if DailyTask::DONE_STATUSES.include?(status) && t[:date].present?
          completed_at = Time.parse(t[:date]) rescue nil
          completed_by = admin_user
        end

        DailyTask.create!(
          title: t[:client],
          task_date: sheet_date_19,
          position: t[:n] - 1,
          status: status,
          priority: "normal",
          form_service: t[:form],
          comments: full_comments,
          assigned_to: assigned,
          reviewed_by: reviewed,
          created_by: admin_user,
          status_changed_by: admin_user,
          status_changed_at: Time.current,
          completed_at: completed_at,
          completed_by: completed_by,
        )
        created_count += 1
      end
    end

    puts "✅ Created #{created_count} daily tasks for #{sheet_date_19}"
    puts "   Staff mapped: #{staff_map.keys.join(', ')}"
    puts "   Completed: #{DailyTask.for_date(sheet_date_19).completed.count}"
    puts "   In progress: #{DailyTask.for_date(sheet_date_19).in_progress.count}"
    puts "   Not started: #{DailyTask.for_date(sheet_date_19).pending.count}"
  end
end
