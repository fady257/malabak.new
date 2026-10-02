-- Malabak storage pivot: pitch photos are stored as bounded WebP BLOBs in D1.
-- The application has not deployed user media yet; old R2 pointers and receipt
-- records cannot be migrated into D1 because their bytes are not in the database.
DROP TABLE IF EXISTS media_assets;

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  pitch_id TEXT NOT NULL,
  detected_content_type TEXT NOT NULL DEFAULT 'image/webp' CHECK (detected_content_type = 'image/webp'),
  image_bytes BLOB,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 1500000),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 1800),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 1800),
  etag TEXT NOT NULL UNIQUE CHECK (length(etag) BETWEEN 16 AND 64),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'deleted')),
  uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (pitch_id, venue_id) REFERENCES pitches(id, venue_id) ON DELETE CASCADE,
  FOREIGN KEY (venue_id, uploaded_by_user_id) REFERENCES venue_members(venue_id, user_id) ON DELETE RESTRICT,
  CHECK (length(id) BETWEEN 1 AND 64),
  CHECK (
    (state = 'active' AND typeof(image_bytes) = 'blob' AND length(image_bytes) = byte_size AND byte_size BETWEEN 1 AND 1500000)
    OR (state = 'deleted' AND image_bytes IS NULL)
  )
);
CREATE UNIQUE INDEX idx_media_assets_one_active_photo_per_pitch
  ON media_assets(pitch_id) WHERE state = 'active';
CREATE INDEX idx_media_assets_venue_state
  ON media_assets(venue_id, state, created_at_ms DESC);
