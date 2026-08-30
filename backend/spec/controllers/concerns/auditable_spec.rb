# frozen_string_literal: true

require "rails_helper"

RSpec.describe Auditable do
  it "redacts sensitive parameter segments without hiding ordinary profile fields" do
    controller = Api::V1::BaseController.new
    fields = controller.send(
      :flatten_changed_fields,
      { "profile_source" => "local", "public_profile" => true, "kiosk_pin" => "1234", "profile_photo_url" => "private" }
    )

    expect(fields).to contain_exactly("profile_source", "public_profile")
  end
end
