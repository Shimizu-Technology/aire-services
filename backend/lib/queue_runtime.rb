# frozen_string_literal: true

module QueueRuntime
  SUPPORTED_ADAPTERS = %w[inline async solid_queue].freeze
  TRUTHY_VALUES = %w[1 true t yes y on].freeze

  module_function

  def adapter(env = ENV)
    value = env.fetch("ACTIVE_JOB_QUEUE_ADAPTER", "inline").to_s.strip.downcase

    return value if SUPPORTED_ADAPTERS.include?(value)

    raise ArgumentError,
      "Unsupported ACTIVE_JOB_QUEUE_ADAPTER=#{value.inspect}; expected one of #{SUPPORTED_ADAPTERS.join(', ')}"
  end

  def solid_queue?(env = ENV)
    adapter(env) == "solid_queue"
  end

  def solid_queue_in_puma?(env = ENV)
    solid_queue?(env) && TRUTHY_VALUES.include?(env.fetch("SOLID_QUEUE_IN_PUMA", "false").to_s.strip.downcase)
  end
end
