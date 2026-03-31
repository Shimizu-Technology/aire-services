# AIRE Ops API (Rails Backend)

## Setup

```bash
bundle install
rails db:create db:migrate db:seed
```

## Environment Variables

Create a `.env` file:

```bash
# Clerk Authentication
CLERK_JWKS_URL=https://your-app.clerk.accounts.dev/.well-known/jwks.json

# Active Record Encryption
ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY=<your_key>
ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY=<your_key>
ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT=<your_salt>

# Production only
DATABASE_URL=postgres://...
```

Generate encryption keys:
```bash
bin/rails db:encryption:init
```

## Run Server

```bash
rails server  # Runs on port 3000
```

## Testing

```bash
# Run all specs
bundle exec rspec

# Run specific spec file
bundle exec rspec spec/models/client_spec.rb

# Run with verbose output
bundle exec rspec --format documentation
```

## Key Files

- `app/services/clerk_auth.rb` - JWT verification
- `app/controllers/concerns/clerk_authenticatable.rb` - Auth middleware
- `app/services/create_intake_service.rb` - Intake form processing
- `db/seeds.rb` - Default workflow stages and time categories
