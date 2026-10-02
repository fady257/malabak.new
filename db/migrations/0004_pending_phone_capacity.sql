-- Keep a privacy-preserving count of live pending holds per venue and phone HMAC.
-- The BEFORE trigger is the concurrency-safe guard: a third pending INSERT fails,
-- and the entire D1 batch (booking + slot locks) rolls back.
CREATE TABLE pending_phone_capacity (
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  phone_lookup_hash TEXT NOT NULL CHECK (length(phone_lookup_hash) BETWEEN 32 AND 128),
  active_count INTEGER NOT NULL DEFAULT 0 CHECK (active_count >= 0),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (venue_id, phone_lookup_hash)
);

INSERT INTO pending_phone_capacity (venue_id, phone_lookup_hash, active_count, updated_at_ms)
SELECT venue_id, customer_phone_lookup_hash, COUNT(*), MAX(updated_at_ms)
FROM bookings
WHERE status = 'pending'
GROUP BY venue_id, customer_phone_lookup_hash;

CREATE TRIGGER bookings_pending_capacity_check
BEFORE INSERT ON bookings
WHEN NEW.status = 'pending'
BEGIN
  SELECT CASE
    WHEN COALESCE((
      SELECT active_count FROM pending_phone_capacity
      WHERE venue_id = NEW.venue_id AND phone_lookup_hash = NEW.customer_phone_lookup_hash
    ), 0) >= 2
    THEN RAISE(ABORT, 'maximum two pending bookings per phone')
  END;
END;

CREATE TRIGGER bookings_pending_capacity_add
AFTER INSERT ON bookings
WHEN NEW.status = 'pending'
BEGIN
  INSERT INTO pending_phone_capacity (venue_id, phone_lookup_hash, active_count, updated_at_ms)
  VALUES (NEW.venue_id, NEW.customer_phone_lookup_hash, 1, NEW.updated_at_ms)
  ON CONFLICT(venue_id, phone_lookup_hash) DO UPDATE SET
    active_count = pending_phone_capacity.active_count + 1,
    updated_at_ms = excluded.updated_at_ms;
END;

CREATE TRIGGER bookings_pending_capacity_release
AFTER UPDATE OF status ON bookings
WHEN OLD.status = 'pending' AND NEW.status != 'pending'
BEGIN
  UPDATE pending_phone_capacity
  SET active_count = active_count - 1, updated_at_ms = NEW.updated_at_ms
  WHERE venue_id = OLD.venue_id AND phone_lookup_hash = OLD.customer_phone_lookup_hash;
  DELETE FROM pending_phone_capacity
  WHERE venue_id = OLD.venue_id AND phone_lookup_hash = OLD.customer_phone_lookup_hash AND active_count <= 0;
END;

CREATE TRIGGER bookings_pending_capacity_delete
AFTER DELETE ON bookings
WHEN OLD.status = 'pending'
BEGIN
  UPDATE pending_phone_capacity
  SET active_count = active_count - 1, updated_at_ms = OLD.updated_at_ms
  WHERE venue_id = OLD.venue_id AND phone_lookup_hash = OLD.customer_phone_lookup_hash;
  DELETE FROM pending_phone_capacity
  WHERE venue_id = OLD.venue_id AND phone_lookup_hash = OLD.customer_phone_lookup_hash AND active_count <= 0;
END;
