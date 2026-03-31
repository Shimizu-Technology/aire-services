# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Client, type: :model do
  describe 'validations' do
    it 'requires first_name' do
      client = Client.new(last_name: 'Test', email: 'test@example.com')
      expect(client).not_to be_valid
      expect(client.errors[:first_name]).to include("can't be blank")
    end

    it 'requires last_name' do
      client = Client.new(first_name: 'Test', email: 'test@example.com')
      expect(client).not_to be_valid
      expect(client.errors[:last_name]).to include("can't be blank")
    end

    it 'does not require email (optional field)' do
      client = Client.new(first_name: 'Test', last_name: 'User')
      expect(client).to be_valid
    end

    it 'is valid with required attributes' do
      client = Client.new(
        first_name: 'Test',
        last_name: 'User',
        email: 'test@example.com',
        phone: '671-555-1234',
        date_of_birth: 30.years.ago,
        mailing_address: '123 Test St'
      )
      expect(client).to be_valid
    end
  end

  describe '#full_name' do
    it 'returns first and last name combined' do
      client = Client.new(first_name: 'John', last_name: 'Doe')
      expect(client.full_name).to eq('John Doe')
    end
  end

  describe 'associations' do
    it 'has many tax_returns' do
      association = described_class.reflect_on_association(:tax_returns)
      expect(association.macro).to eq(:has_many)
    end

    it 'has many dependents' do
      association = described_class.reflect_on_association(:dependents)
      expect(association.macro).to eq(:has_many)
    end
  end
end
