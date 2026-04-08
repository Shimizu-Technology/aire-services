# frozen_string_literal: true

class TimeClockChannel < ApplicationCable::Channel
  def subscribed
    stream_from "time_clock_updates"
  end

  def unsubscribed
    stop_all_streams
  end
end
