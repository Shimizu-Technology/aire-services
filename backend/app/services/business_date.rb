# frozen_string_literal: true

# Calendar dates for AIRE operations must not inherit the host Rails time zone.
class BusinessDate
  TIME_ZONE = "Pacific/Guam"

  def self.today
    Time.current.in_time_zone(TIME_ZONE).to_date
  end
end
