# frozen_string_literal: true

module QueueRuntime
  SUPPORTED_ADAPTERS = %w[inline async solid_queue].freeze
  TRUTHY_VALUES = %w[1 true t yes y on].freeze

  module_function

  def environment(env = ENV)
    rails_environment = env.fetch("RAILS_ENV", "").to_s.strip
    return rails_environment unless rails_environment.empty?

    rack_environment = env.fetch("RACK_ENV", "").to_s.strip
    return rack_environment unless rack_environment.empty?

    "development"
  end

  def production?(env = ENV)
    environment(env) == "production"
  end

  def adapter(env = ENV)
    default = production?(env) ? "solid_queue" : "inline"
    value = env.fetch("ACTIVE_JOB_QUEUE_ADAPTER", default).to_s.strip.downcase

    return value if SUPPORTED_ADAPTERS.include?(value)

    raise ArgumentError,
      "Unsupported ACTIVE_JOB_QUEUE_ADAPTER=#{value.inspect}; expected one of #{SUPPORTED_ADAPTERS.join(', ')}"
  end

  def solid_queue?(env = ENV)
    adapter(env) == "solid_queue"
  end

  def solid_queue_in_puma?(env = ENV)
    # The current production topology has one web process and no separate
    # bin/jobs service, so Puma is the durable worker unless explicitly disabled.
    default = production?(env) ? "true" : "false"
    solid_queue?(env) && TRUTHY_VALUES.include?(env.fetch("SOLID_QUEUE_IN_PUMA", default).to_s.strip.downcase)
  end
end
