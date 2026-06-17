# frozen_string_literal: true

class AddPublicPhoneContactsToSettings < ActiveRecord::Migration[8.0]
  class SettingRow < ActiveRecord::Base
    self.table_name = "settings"
  end

  DEFAULT_PUBLIC_PHONE_CONTACTS = [
    {
      "label" => "Tours, flight training & payments",
      "phone_display" => "(671) 477-4243",
      "phone_e164" => "+16714774243",
      "channel" => "phone"
    },
    {
      "label" => "Admin, management & business operations",
      "phone_display" => "(671) 922-2243",
      "phone_e164" => "+16719222243",
      "channel" => "phone"
    },
    {
      "label" => "WhatsApp contact",
      "phone_display" => "(671) 997-4243",
      "phone_e164" => "+16719974243",
      "channel" => "whatsapp"
    }
  ].freeze

  DEFAULT_PUBLIC_CONTACT_SETTINGS = {
    "phone_display" => "(671) 477-4243",
    "phone_e164" => "+16714774243",
    "email" => "admin@aireservicesguam.com",
    "street_address" => "353 Admiral Sherman Boulevard",
    "address_area_label" => "Tiyan / Barrigada",
    "address_locality" => "Barrigada",
    "address_region" => "Guam",
    "postal_code" => "96913",
    "address_country" => "GU",
    "phone_contacts" => DEFAULT_PUBLIC_PHONE_CONTACTS
  }.freeze

  def up
    setting = SettingRow.find_or_initialize_by(key: "public_contact_settings")
    current_settings = parse_settings(setting.value)

    next_settings = DEFAULT_PUBLIC_CONTACT_SETTINGS.merge(current_settings)
    next_settings["phone_display"] = DEFAULT_PUBLIC_CONTACT_SETTINGS.fetch("phone_display") if next_settings["phone_display"].blank?
    next_settings["phone_e164"] = DEFAULT_PUBLIC_CONTACT_SETTINGS.fetch("phone_e164") if next_settings["phone_e164"].blank?
    next_settings["phone_contacts"] = existing_phone_contacts_or_default(current_settings["phone_contacts"])

    setting.value = JSON.generate(next_settings)
    setting.description = "JSON object of public phone directory, email, and address shown on the marketing website"
    setting.save!
  end

  def down
    setting = SettingRow.find_by(key: "public_contact_settings")
    return unless setting

    current_settings = parse_settings(setting.value)
    current_settings.delete("phone_contacts")
    setting.value = JSON.generate(current_settings)
    setting.save!
  end

  private

  def parse_settings(value)
    return {} if value.blank?

    parsed = JSON.parse(value)
    parsed.is_a?(Hash) ? parsed : {}
  rescue JSON::ParserError
    {}
  end

  def existing_phone_contacts_or_default(value)
    contacts = value.is_a?(Array) ? value : []
    contacts.any? ? contacts : DEFAULT_PUBLIC_PHONE_CONTACTS
  end
end
