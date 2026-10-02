-- Malabak initial D1 schema. All timestamps are UTC Unix milliseconds.
-- Customer phone values are encrypted by the application; *_hash values are keyed HMACs.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(id) BETWEEN 1 AND 64),
  CHECK (email_normalized = lower(trim(email_normalized))),
  CHECK (length(email_normalized) BETWEEN 3 AND 254)
);

CREATE TABLE venues (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  vodafone_cash_number TEXT,
  deposit_amount_piasters INTEGER NOT NULL DEFAULT 0 CHECK (deposit_amount_piasters >= 0),
  hold_minutes INTEGER NOT NULL DEFAULT 30 CHECK (hold_minutes BETWEEN 1 AND 240),
  slot_length_minutes INTEGER NOT NULL DEFAULT 60 CHECK (slot_length_minutes IN (60, 90)),
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo' CHECK (timezone = 'Africa/Cairo'),
  opening_minute INTEGER NOT NULL DEFAULT 840 CHECK (opening_minute BETWEEN 0 AND 1439),
  closing_business_minute INTEGER NOT NULL DEFAULT 1560 CHECK (closing_business_minute > opening_minute AND closing_business_minute <= 2880),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(slug) BETWEEN 2 AND 80),
  CHECK (length(name) BETWEEN 1 AND 160)
);

CREATE TABLE venue_members (
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (venue_id, user_id)
);
CREATE INDEX idx_venue_members_user_active ON venue_members(user_id, active, venue_id);
CREATE UNIQUE INDEX idx_venue_single_owner ON venue_members(venue_id) WHERE role = 'owner';

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  CHECK (expires_at_ms > created_at_ms),
  CHECK (revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms)
);
CREATE INDEX idx_sessions_user_expiry ON sessions(user_id, expires_at_ms, revoked_at_ms);

CREATE TABLE pitches (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (id, venue_id),
  UNIQUE (venue_id, name),
  CHECK (length(name) BETWEEN 1 AND 100)
);
CREATE INDEX idx_pitches_venue_active ON pitches(venue_id, active, display_order);

CREATE TABLE price_rules (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  pitch_id TEXT,
  day_mask INTEGER NOT NULL CHECK (day_mask BETWEEN 1 AND 127),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 2879 AND start_minute % 30 = 0),
  end_minute INTEGER NOT NULL CHECK (end_minute > start_minute AND end_minute <= 2880),
  price_piasters INTEGER NOT NULL CHECK (price_piasters >= 0),
  valid_from_business_date TEXT,
  valid_until_business_date TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (pitch_id, venue_id) REFERENCES pitches(id, venue_id) ON DELETE CASCADE,
  CHECK (valid_until_business_date IS NULL OR valid_from_business_date IS NULL OR valid_until_business_date >= valid_from_business_date)
);
CREATE INDEX idx_price_rules_lookup ON price_rules(venue_id, pitch_id, day_mask, start_minute, end_minute);

CREATE TABLE recurring_series (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  pitch_id TEXT NOT NULL,
  first_business_date TEXT NOT NULL CHECK (first_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 2879 AND start_minute % 30 = 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (60, 90)),
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count BETWEEN 2 AND 52),
  customer_name TEXT NOT NULL,
  customer_phone_ciphertext TEXT NOT NULL,
  customer_phone_lookup_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (id, venue_id),
  FOREIGN KEY (pitch_id, venue_id) REFERENCES pitches(id, venue_id) ON DELETE CASCADE,
  FOREIGN KEY (venue_id, created_by_user_id) REFERENCES venue_members(venue_id, user_id) ON DELETE RESTRICT,
  CHECK (length(customer_name) BETWEEN 1 AND 120)
);
CREATE INDEX idx_recurring_series_venue_status ON recurring_series(venue_id, status, first_business_date);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  pitch_id TEXT NOT NULL,
  recurring_series_id TEXT,
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 2879 AND start_minute % 30 = 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (60, 90)),
  start_at_utc_ms INTEGER NOT NULL,
  end_at_utc_ms INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone_ciphertext TEXT NOT NULL,
  customer_phone_lookup_hash TEXT NOT NULL,
  booking_code_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'rejected', 'expired', 'completed', 'no_show')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'deposit', 'paid')),
  payment_reference TEXT,
  hold_expires_at_ms INTEGER,
  cancellation_reason TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (id, venue_id),
  UNIQUE (id, pitch_id, business_date),
  FOREIGN KEY (pitch_id, venue_id) REFERENCES pitches(id, venue_id) ON DELETE RESTRICT,
  FOREIGN KEY (recurring_series_id, venue_id) REFERENCES recurring_series(id, venue_id) ON DELETE RESTRICT,
  FOREIGN KEY (venue_id, created_by_user_id) REFERENCES venue_members(venue_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (venue_id, updated_by_user_id) REFERENCES venue_members(venue_id, user_id) ON DELETE RESTRICT,
  CHECK (end_at_utc_ms > start_at_utc_ms),
  CHECK (status != 'pending' OR hold_expires_at_ms IS NOT NULL),
  CHECK (length(customer_name) BETWEEN 1 AND 120),
  CHECK (length(customer_phone_ciphertext) BETWEEN 1 AND 2048),
  CHECK (length(customer_phone_lookup_hash) BETWEEN 32 AND 128),
  CHECK (length(booking_code_hash) BETWEEN 32 AND 128)
);
CREATE INDEX idx_bookings_venue_day_status ON bookings(venue_id, business_date, status, start_minute);
CREATE INDEX idx_bookings_phone_lookup ON bookings(venue_id, customer_phone_lookup_hash, business_date);
CREATE INDEX idx_bookings_recurring_date ON bookings(recurring_series_id, business_date);
CREATE INDEX idx_bookings_pending_expiry ON bookings(hold_expires_at_ms, business_date) WHERE status = 'pending';
CREATE UNIQUE INDEX idx_bookings_active_slot_start ON bookings(pitch_id, business_date, start_minute) WHERE status IN ('pending', 'confirmed');

-- A reservation owns every 30-minute UTC-elapsed bucket that its real duration spans.
-- The composite primary key is the final database-level guard against overlap.
CREATE TABLE slot_locks (
  pitch_id TEXT NOT NULL,
  business_date TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  bucket_index INTEGER NOT NULL CHECK (bucket_index BETWEEN 0 AND 25),
  booking_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (pitch_id, business_date, bucket_index),
  UNIQUE (booking_id, bucket_index),
  FOREIGN KEY (booking_id, pitch_id, business_date) REFERENCES bookings(id, pitch_id, business_date) ON DELETE RESTRICT
);
CREATE INDEX idx_slot_locks_booking ON slot_locks(booking_id);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  pitch_id TEXT,
  booking_id TEXT REFERENCES bookings(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('pitch_photo', 'payment_receipt')),
  object_key TEXT NOT NULL UNIQUE,
  detected_content_type TEXT NOT NULL CHECK (detected_content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 12000),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 12000),
  sha256_hex TEXT NOT NULL CHECK (length(sha256_hex) = 64),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('pending', 'active', 'rejected', 'deleted')),
  uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (pitch_id, venue_id) REFERENCES pitches(id, venue_id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id, venue_id) REFERENCES bookings(id, venue_id) ON DELETE RESTRICT,
  FOREIGN KEY (venue_id, uploaded_by_user_id) REFERENCES venue_members(venue_id, user_id) ON DELETE RESTRICT,
  CHECK (
    (purpose = 'pitch_photo' AND pitch_id IS NOT NULL AND booking_id IS NULL)
    OR (purpose = 'payment_receipt' AND booking_id IS NOT NULL)
  )
);
CREATE INDEX idx_media_assets_venue_purpose ON media_assets(venue_id, purpose, state, created_at_ms);
CREATE INDEX idx_media_assets_booking ON media_assets(booking_id, purpose, state);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (venue_id, actor_user_id) REFERENCES venue_members(venue_id, user_id) ON DELETE RESTRICT,
  CHECK (length(entity_type) BETWEEN 1 AND 60),
  CHECK (length(action) BETWEEN 1 AND 80)
);
CREATE INDEX idx_audit_events_venue_time ON audit_events(venue_id, created_at_ms DESC);
