-- Additive application settings, rate limits, and public venue presentation fields.
ALTER TABLE venues ADD COLUMN description TEXT;
ALTER TABLE venues ADD COLUMN whatsapp_number TEXT;
ALTER TABLE venues ADD COLUMN public_booking_enabled INTEGER NOT NULL DEFAULT 1 CHECK (public_booking_enabled IN (0, 1));
ALTER TABLE venues ADD COLUMN cancellation_notice_hours INTEGER NOT NULL DEFAULT 2 CHECK (cancellation_notice_hours BETWEEN 0 AND 168);
ALTER TABLE pitches ADD COLUMN description TEXT;
ALTER TABLE pitches ADD COLUMN indoor INTEGER NOT NULL DEFAULT 0 CHECK (indoor IN (0, 1));
ALTER TABLE bookings ADD COLUMN customer_note TEXT;

CREATE TABLE rate_limit_buckets (
  key_hash TEXT PRIMARY KEY NOT NULL,
  window_started_at_ms INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits BETWEEN 0 AND 1000000),
  blocked_until_ms INTEGER
);
CREATE INDEX idx_rate_limit_window ON rate_limit_buckets(window_started_at_ms, blocked_until_ms);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(key) BETWEEN 1 AND 80),
  CHECK (length(value) <= 2000)
);

CREATE INDEX idx_bookings_created_at ON bookings(venue_id, created_at_ms DESC);
CREATE INDEX idx_bookings_status_updated ON bookings(venue_id, status, updated_at_ms DESC);
CREATE INDEX idx_media_assets_pitch_public ON media_assets(venue_id, pitch_id, purpose, state);
