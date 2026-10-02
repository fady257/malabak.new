-- Freeze the quoted price on each booking so later rule edits do not rewrite history.
ALTER TABLE bookings ADD COLUMN price_piasters INTEGER NOT NULL DEFAULT 0 CHECK (price_piasters >= 0);
ALTER TABLE bookings ADD COLUMN payment_received_piasters INTEGER NOT NULL DEFAULT 0 CHECK (payment_received_piasters >= 0 AND payment_received_piasters <= price_piasters);
CREATE INDEX idx_bookings_revenue ON bookings(venue_id, payment_status, business_date, payment_received_piasters);
