# frozen_string_literal: true

class StagingCloneContainment
  QUEUE_TABLES = %w[solid_queue_ready_executions solid_queue_scheduled_executions solid_queue_claimed_executions solid_queue_blocked_executions solid_queue_failed_executions solid_queue_recurring_executions solid_queue_recurring_tasks solid_queue_pauses solid_queue_semaphores solid_queue_processes].freeze
  DISPATCH = { "payroll_outbox_events" => "delivery_status IN ('pending', 'failed')", "payroll_calendar_periods" => "status IN ('scheduled', 'failed')", "payroll_integration_grants" => "active = TRUE", "payroll_account_links" => "active = TRUE" }.freeze
  LEGACY_SECRET_SETTINGS = %w[time_tracking_export_secret payroll_shared_secret].freeze
  TOKEN_TABLES = %w[payroll_account_link_sessions].freeze

  def self.queue_schema_complete?(connection: ActiveRecord::Base.connection)
    ([ "solid_queue_jobs" ] + QUEUE_TABLES).all? { |table| connection.data_source_exists?(table) }
  end

  def initialize(env: ENV, connection: ActiveRecord::Base.connection)
    @env = env
    @connection = connection
  end

  # Default is a read-only plan. APPLY=true is deliberately explicit.
  def quarantine(apply: false)
    guard!
    return counts if !apply || StagingQuarantine.suppressed?("__quarantine_complete__", 0)

    connection.transaction do
      connection.execute("SELECT pg_advisory_xact_lock(782041024)")
      create_manifest!
      return counts if marker?("__quarantine_complete__")
      capture("solid_queue_jobs", "finished_at IS NULL") if table?("solid_queue_jobs")
      QUEUE_TABLES.each do |table|
        next unless table?(table)
        capture(table)
        relation(table).delete_all
      end
      connection.execute("UPDATE solid_queue_jobs SET finished_at = CURRENT_TIMESTAMP WHERE finished_at IS NULL") if table?("solid_queue_jobs")
      DISPATCH.each { |table, predicate| capture(table, predicate) if table?(table) }
      TOKEN_TABLES.each do |table|
        next unless table?(table)
        capture(table)
        relation(table).delete_all
      end
      # Preserve frozen evidence, and hold copied schedules without inventing
      # finalization/delivery success or altering their immutable policy fields.
      connection.execute("UPDATE payroll_calendar_periods SET status = 'failed', next_finalization_attempt_at = NULL, last_finalization_error = 'STAGING clone quarantine' WHERE status IN ('scheduled', 'failed')")
      connection.execute("UPDATE payroll_integration_grants SET active = FALSE WHERE active = TRUE")
      connection.execute("UPDATE payroll_account_links SET active = FALSE, revoked_at = CURRENT_TIMESTAMP WHERE active = TRUE")
      mark!("__quarantine_complete__")
    end
    counts
  end

  def configure(apply: false)
    guard!
    StagingOutboundPolicy.validate_shared_secret!(env: env)
    if marker?("__containment_complete__")
      invalidate_legacy_secrets! if apply
      return counts
    end
    verified_testers = StagingTesterIdentity.verify!(env: env)
    testers = verified_testers.to_h { |tester| [ tester.fetch("email"), tester.fetch("clerk_subject") ] }
    return counts unless apply
    raise StagingOutboundPolicy::ConfigurationError, "Run staging:clone:quarantine with APPLY=true first" unless marker?("__quarantine_complete__")
    connection.transaction do
      invalidate_legacy_secrets!
      Setting.where(key: "contact_email").update_all(value: testers.keys.first)
      # Non-null Clerk IDs remain inert placeholders. Payroll employee UUIDs,
      # local user IDs, roles, time entries and immutable frozen evidence stay intact.
      connection.execute("UPDATE users SET clerk_id = 'staging_quarantined_' || id::text, personal_access_enabled = FALSE, kiosk_pin_digest = NULL, kiosk_pin_lookup_hash = NULL")
      testers.each do |email, clerk_id|
        User.unscoped.where("lower(email) = ?", email).update_all(clerk_id: clerk_id, personal_access_enabled: true)
      end
      mark!("__containment_complete__")
    end
    counts
  end

  def counts
    guard!
    result = {}
    ([ "solid_queue_jobs" ] + QUEUE_TABLES + DISPATCH.keys + TOKEN_TABLES).uniq.each do |table|
      next unless table?(table)
      predicate = DISPATCH[table] || (table == "solid_queue_jobs" ? "finished_at IS NULL" : "TRUE")
      count = relation(table).where(predicate).count
      suppressed = table?(StagingQuarantine::TABLE) ? StagingQuarantine.records.where(source_table: table).count : 0
      result[table] = { candidates: count, quarantined: suppressed }
    end
    result["containment_complete"] = marker?("__containment_complete__") ? 1 : 0
    result
  end

  private

  attr_reader :env, :connection

  def guard!
    StagingOutboundPolicy.validate_database!(env: env)
    unless self.class.queue_schema_complete?(connection: connection)
      raise StagingOutboundPolicy::ConfigurationError, "Staging requires the complete Solid Queue schema before containment"
    end
    StagingDatabasePolicy.validate_parameters!(connection.pool.db_config.configuration_hash, env: env)
    StagingDatabasePolicy.validate_live!(connection.raw_connection, env: env)
    true
  end

  # These legacy settings never provide staging authentication authority.
  def invalidate_legacy_secrets!
    Setting.where(key: LEGACY_SECRET_SETTINGS).delete_all
  end

  def table?(table)
    connection.data_source_exists?(table)
  end

  def relation(table)
    @relations ||= {}
    @relations[table] ||= Class.new(ActiveRecord::Base) do
      self.table_name = table
      self.inheritance_column = "_disabled_type"
    end.unscoped
  end

  def create_manifest!
    connection.execute(<<~SQL)
      CREATE TABLE IF NOT EXISTS staging_quarantines (
        source_table text NOT NULL,
        source_id bigint NOT NULL,
        original_state text,
        quarantined_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source_table, source_id)
      )
    SQL
    StagingQuarantine::Record.reset_column_information
  end

  def capture(table, predicate = "TRUE")
    columns = connection.columns(table).map(&:name)
    state = if columns.include?("delivery_status") then :delivery_status
    elsif columns.include?("verification_status") then :verification_status
    elsif columns.include?("status") then :status
    end
    relation(table).where(predicate).in_batches(of: 1_000) do |batch|
      rows = state ? batch.pluck(:id, state) : batch.pluck(:id).map { |id| [ id, nil ] }
      manifest = rows.map { |id, old_state| { source_table: table, source_id: id, original_state: old_state } }
      StagingQuarantine.records.insert_all(manifest, unique_by: %i[source_table source_id]) unless manifest.empty?
    end
  end

  def marker?(name)
    table?(StagingQuarantine::TABLE) && StagingQuarantine.records.where(source_table: name, source_id: 0).exists?
  end

  def mark!(name)
    StagingQuarantine.records.insert_all([ { source_table: name, source_id: 0 } ], unique_by: %i[source_table source_id])
  end
end
