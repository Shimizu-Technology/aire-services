# frozen_string_literal: true

module CableRuntime
  SUPPORTED_ADAPTERS = %w[async solid_cable].freeze

  module_function

  def adapter(env = ENV)
    value = env.fetch("ACTION_CABLE_ADAPTER", "async").to_s.strip.downcase

    return value if SUPPORTED_ADAPTERS.include?(value)

    raise ArgumentError,
      "Unsupported ACTION_CABLE_ADAPTER=#{value.inspect}; expected one of #{SUPPORTED_ADAPTERS.join(', ')}"
  end

  def solid_cable?(env = ENV)
    adapter(env) == "solid_cable"
  end
end
