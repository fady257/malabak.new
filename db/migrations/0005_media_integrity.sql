-- Deduplicate any legacy active pitch photos before enforcing one active cover per pitch.
UPDATE media_assets AS older
SET state = 'deleted'
WHERE older.purpose = 'pitch_photo'
  AND older.state = 'active'
  AND EXISTS (
    SELECT 1 FROM media_assets AS newer
    WHERE newer.purpose = 'pitch_photo'
      AND newer.state = 'active'
      AND newer.pitch_id = older.pitch_id
      AND (newer.created_at_ms > older.created_at_ms
        OR (newer.created_at_ms = older.created_at_ms AND newer.id > older.id))
  );

CREATE UNIQUE INDEX idx_media_one_active_pitch_photo
  ON media_assets (pitch_id)
  WHERE purpose = 'pitch_photo' AND state = 'active';
