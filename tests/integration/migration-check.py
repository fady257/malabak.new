import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def migrated_database():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for migration in sorted((ROOT / "db" / "migrations").glob("*.sql")):
        db.executescript(migration.read_text(encoding="utf-8"))
    return db


def seed_tenant(db, suffix):
    user_id = f"user-{suffix}"
    venue_id = f"venue-{suffix}"
    pitch_id = f"pitch-{suffix}"
    db.execute(
        "INSERT INTO users (id,email,email_normalized,password_hash,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?)",
        (user_id, f"owner-{suffix}@example.test", f"owner-{suffix}@example.test", "test-hash", 1, 1),
    )
    db.execute(
        "INSERT INTO venues (id,owner_user_id,slug,name,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?)",
        (venue_id, user_id, f"venue-{suffix}", "Test Venue", 1, 1),
    )
    db.execute(
        "INSERT INTO venue_members (venue_id,user_id,role,created_at_ms) VALUES (?,?,?,?)",
        (venue_id, user_id, "owner", 1),
    )
    db.execute(
        "INSERT INTO pitches (id,venue_id,name,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)",
        (pitch_id, venue_id, "Pitch 1", 1, 1),
    )
    return venue_id, pitch_id


def insert_booking(db, booking_id, venue_id, pitch_id, start_minute, phone_hash, status="pending"):
    db.execute(
        """INSERT INTO bookings (
            id,venue_id,pitch_id,business_date,start_minute,duration_minutes,start_at_utc_ms,end_at_utc_ms,
            customer_name,customer_phone_ciphertext,customer_phone_lookup_hash,booking_code_hash,status,
            payment_status,hold_expires_at_ms,created_at_ms,updated_at_ms
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            booking_id, venue_id, pitch_id, "2026-10-01", start_minute, 60,
            1_000_000 + start_minute * 60_000, 1_000_000 + (start_minute + 60) * 60_000,
            "Test Customer", "ciphertext-only", phone_hash, (booking_id + "x")[:1].ljust(64, "b"),
            status, "unpaid", 9_999_999 if status == "pending" else None, 1, 1,
        ),
    )


class MigrationTests(unittest.TestCase):
    def test_all_migrations_apply_and_add_payment_snapshots(self):
        db = migrated_database()
        names = {row[1] for row in db.execute("PRAGMA table_info(bookings)")}
        self.assertIn("price_piasters", names)
        self.assertIn("payment_received_piasters", names)
        self.assertIsNotNone(db.execute("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='pending_phone_capacity'").fetchone())
        db.close()

    def test_database_enforces_two_pending_bookings_per_phone_and_releases_capacity(self):
        db = migrated_database()
        venue_id, pitch_id = seed_tenant(db, "one")
        phone_hash = "a" * 64
        with db:
            insert_booking(db, "booking-one", venue_id, pitch_id, 840, phone_hash)
            insert_booking(db, "booking-two", venue_id, pitch_id, 930, phone_hash)

        with self.assertRaises(sqlite3.IntegrityError):
            with db:
                insert_booking(db, "booking-three-blocked", venue_id, pitch_id, 1020, phone_hash)
        self.assertIsNone(db.execute("SELECT id FROM bookings WHERE id='booking-three-blocked'").fetchone())
        self.assertEqual(
            db.execute("SELECT active_count FROM pending_phone_capacity WHERE venue_id=? AND phone_lookup_hash=?", (venue_id, phone_hash)).fetchone()[0],
            2,
        )

        with db:
            db.execute("UPDATE bookings SET status='confirmed', updated_at_ms=2 WHERE id='booking-one'")
            insert_booking(db, "booking-three", venue_id, pitch_id, 1020, phone_hash)
        self.assertEqual(
            db.execute("SELECT active_count FROM pending_phone_capacity WHERE venue_id=? AND phone_lookup_hash=?", (venue_id, phone_hash)).fetchone()[0],
            2,
        )
        db.close()

    def test_pending_capacity_is_scoped_to_venue(self):
        db = migrated_database()
        venue_one, pitch_one = seed_tenant(db, "one")
        venue_two, pitch_two = seed_tenant(db, "two")
        phone_hash = "c" * 64
        with db:
            insert_booking(db, "one-a", venue_one, pitch_one, 840, phone_hash)
            insert_booking(db, "one-b", venue_one, pitch_one, 930, phone_hash)
            insert_booking(db, "two-a", venue_two, pitch_two, 840, phone_hash)
        self.assertEqual(
            db.execute("SELECT active_count FROM pending_phone_capacity WHERE venue_id=? AND phone_lookup_hash=?", (venue_two, phone_hash)).fetchone()[0],
            1,
        )
        db.close()

    def test_only_one_active_cover_photo_is_allowed_per_pitch(self):
        db = migrated_database()
        venue_id, pitch_id = seed_tenant(db, "photo")

        def insert_photo(asset_id, key):
            db.execute(
                """INSERT INTO media_assets (
                    id,venue_id,pitch_id,detected_content_type,image_bytes,byte_size,
                    width,height,etag,state,created_at_ms
                ) VALUES (?,?,?,'image/webp',?,9,1,1,?,'active',?)""",
                (asset_id, venue_id, pitch_id, sqlite3.Binary(b"webp-data"), f"etag-{asset_id}-00000000", 1),
            )

        with db:
            insert_photo("photo-one", "unused")
        with self.assertRaises(sqlite3.IntegrityError):
            with db:
                insert_photo("photo-two-conflict", "unused")
        with db:
            db.execute("UPDATE media_assets SET state='deleted',image_bytes=NULL WHERE id='photo-one'")
            insert_photo("photo-two", "unused")
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM media_assets WHERE pitch_id=? AND state='active'", (pitch_id,)).fetchone()[0],
            1,
        )
        db.close()


if __name__ == "__main__":
    unittest.main()
