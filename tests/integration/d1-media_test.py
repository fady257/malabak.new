import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class D1PitchMediaMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        for migration in sorted((ROOT / "db" / "migrations").glob("*.sql")):
            self.db.executescript(migration.read_text(encoding="utf-8"))
        self.db.execute("INSERT INTO users VALUES ('owner', 'owner@example.com', 'owner@example.com', 'x', 1, 1)")
        self.db.execute("INSERT INTO venues (id,owner_user_id,slug,name,created_at_ms,updated_at_ms) VALUES ('venue','owner','venue','Venue',1,1)")
        self.db.execute("INSERT INTO venue_members VALUES ('venue','owner','owner',1,1)")
        self.db.execute("INSERT INTO pitches VALUES ('pitch','venue','Pitch',1,0,1,1)")

    def tearDown(self):
        self.db.close()

    def insert_media(self, asset_id, blob):
        self.db.execute(
            """INSERT INTO media_assets
               (id,venue_id,pitch_id,image_bytes,byte_size,width,height,etag,state,uploaded_by_user_id,created_at_ms)
               VALUES (?,?,?,?,?,1,1,?, 'active', 'owner', 1)""",
            (asset_id, "venue", "pitch", sqlite3.Binary(blob), len(blob), f"etag-{asset_id}-00000000"),
        )

    def test_accepts_bounded_blob_and_limits_one_active_photo(self):
        self.insert_media("image-1", b"webp-data")
        stored = self.db.execute("SELECT image_bytes FROM media_assets WHERE id='image-1'").fetchone()[0]
        self.assertEqual(stored, b"webp-data")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_media("image-2", b"another")

    def test_rejects_blob_larger_than_1500000_bytes(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_media("too-large", b"x" * 1_500_001)

    def test_deleted_image_bytes_can_be_reclaimed_by_replacement(self):
        self.insert_media("old-image", b"old")
        self.db.execute("UPDATE media_assets SET state='deleted', image_bytes=NULL WHERE id='old-image'")
        self.insert_media("new-image", b"new")
        self.assertEqual(self.db.execute("SELECT count(*) FROM media_assets WHERE state='active'").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
