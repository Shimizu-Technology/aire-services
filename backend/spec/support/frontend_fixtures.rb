# frozen_string_literal: true

# JSON the frontend tests render from, written by the backend so both sides
# test the same data. A spec compares the checked-in file with what the
# backend produces now; rerun with UPDATE_FRONTEND_FIXTURES=1 to refresh it.
module FrontendFixtures
  DIRECTORY = Rails.root.join("../frontend/src/test/fixtures")

  def expect_frontend_fixture_current(name, data)
    path = DIRECTORY.join(name)
    generated = "#{JSON.pretty_generate(data.as_json)}\n"

    if ENV["UPDATE_FRONTEND_FIXTURES"] == "1"
      FileUtils.mkdir_p(DIRECTORY)
      File.write(path, generated)
    end

    expect(path).to exist, "#{path} is missing. Run: UPDATE_FRONTEND_FIXTURES=1 bundle exec rspec #{RSpec.current_example.file_path}"
    expect(File.read(path)).to eq(generated),
      "#{path} is out of date. Run: UPDATE_FRONTEND_FIXTURES=1 bundle exec rspec #{RSpec.current_example.file_path}"
  end
end
