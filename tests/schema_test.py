import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "db" / "migrations" / "0001_initial.sql"
MEDIA_MIGRATION = ROOT / "db" / "migrations" / "0006_d1_pitch_image_blobs.sql"


class MalabakSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(MIGRATION.read_text(encoding="utf-8"))
        self.db.executescript(MEDIA_MIGRATION.read_text(encoding="utf-8"))
        self.add_user_and_venue("user-1", "venue-1", "pitch-1", "owner@example.test")

    def tearDown(self):
        self.db.close()

    def add_user_and_venue(self, user_id, venue_id, pitch_id, email):
        self.db.execute(
            "INSERT INTO users (id,email,email_normalized,password_hash,created_at_ms,updated_at_ms) "
            "VALUES (?,?,?,?,?,?)",
            (user_id, email, email, "test-hash", 1, 1),
        )
        self.db.execute(
            "INSERT INTO venues (id,owner_user_id,slug,name,created_at_ms,updated_at_ms) "
            "VALUES (?,?,?,?,?,?)",
            (venue_id, user_id, venue_id, "ملعب تجريبي", 1, 1),
        )
        self.db.execute(
            "INSERT INTO venue_members (venue_id,user_id,role,created_at_ms) VALUES (?,?,?,?)",
            (venue_id, user_id, "owner", 1),
        )
        self.db.execute(
            "INSERT INTO pitches (id,venue_id,name,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)",
            (pitch_id, venue_id, "ملعب 1", 1, 1),
        )
        self.db.commit()

    def add_booking(
        self,
        booking_id,
        *,
        venue_id="venue-1",
        pitch_id="pitch-1",
        start_minute=840,
        status="pending",
        expiry=10_000,
        created_by_user_id=None,
        recurring_series_id=None,
    ):
        self.db.execute(
            """INSERT INTO bookings (
                id,venue_id,pitch_id,recurring_series_id,business_date,start_minute,duration_minutes,
                start_at_utc_ms,end_at_utc_ms,customer_name,customer_phone_ciphertext,
                customer_phone_lookup_hash,booking_code_hash,status,payment_status,
                hold_expires_at_ms,created_by_user_id,created_at_ms,updated_at_ms
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                booking_id, venue_id, pitch_id, recurring_series_id, "2026-10-01", start_minute, 60,
                10_000, 3_610_000, "عميل تجريبي", "encrypted-phone", "a" * 64,
                "b" * 64, status, "unpaid", expiry if status == "pending" else None,
                created_by_user_id, 1, 1,
            ),
        )

    def lock(self, booking_id, bucket, *, venue_pitch="pitch-1", business_date="2026-10-01"):
        self.db.execute(
            "INSERT INTO slot_locks (pitch_id,business_date,bucket_index,booking_id,created_at_ms) "
            "VALUES (?,?,?,?,?)",
            (venue_pitch, business_date, bucket, booking_id, 1),
        )

    def add_booking_with_locks(self, booking_id, buckets, **booking_args):
        with self.db:
            self.add_booking(booking_id, **booking_args)
            pitch_id = booking_args.get("pitch_id", "pitch-1")
            business_date = "2026-10-01"
            for bucket in buckets:
                self.lock(booking_id, bucket, venue_pitch=pitch_id, business_date=business_date)

    def add_second_tenant(self):
        self.add_user_and_venue("user-2", "venue-2", "pitch-2", "other@example.test")

    def add_series(self, series_id, *, venue_id, pitch_id, owner_id):
        self.db.execute(
            """INSERT INTO recurring_series (
                id,venue_id,pitch_id,first_business_date,start_minute,duration_minutes,
                occurrence_count,customer_name,customer_phone_ciphertext,customer_phone_lookup_hash,
                created_by_user_id,created_at_ms,updated_at_ms
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                series_id, venue_id, pitch_id, "2026-10-01", 840, 60, 4,
                "عميل تجريبي", "encrypted-phone", "c" * 64,
                owner_id, 1, 1,
            ),
        )

    def test_migration_creates_expected_tables_and_indexes(self):
        tables = {
            row[0]
            for row in self.db.execute("SELECT name FROM sqlite_schema WHERE type='table'").fetchall()
        }
        self.assertTrue(
            {
                "users", "venues", "venue_members", "sessions", "pitches",
                "price_rules", "recurring_series", "bookings", "slot_locks",
                "media_assets", "audit_events",
            }.issubset(tables)
        )
        indexes = {
            row[0]
            for row in self.db.execute("SELECT name FROM sqlite_schema WHERE type='index'").fetchall()
        }
        self.assertIn("idx_bookings_active_slot_start", indexes)
        self.assertIn("idx_bookings_pending_expiry", indexes)
        self.assertIn("idx_venue_single_owner", indexes)

    def test_tenant_membership_and_pitch_foreign_keys_are_enforced(self):
        self.add_second_tenant()
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_booking("cross-venue-pitch", venue_id="venue-1", pitch_id="pitch-2")
        self.db.rollback()

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO venue_members (venue_id,user_id,role,created_at_ms) VALUES (?,?,?,?)",
                ("missing-venue", "user-1", "owner", 2),
            )
        self.db.rollback()

    def test_booking_actor_and_recurring_series_must_belong_to_same_venue(self):
        self.add_second_tenant()
        self.add_series("series-2", venue_id="venue-2", pitch_id="pitch-2", owner_id="user-2")
        self.db.commit()

        with self.assertRaises(sqlite3.IntegrityError):
            self.add_booking("wrong-series", recurring_series_id="series-2")
        self.db.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_booking("wrong-actor", created_by_user_id="user-2")
        self.db.rollback()

    def test_pitch_media_and_audit_actors_cannot_cross_tenant_boundaries(self):
        self.add_second_tenant()
        with self.db:
            self.add_booking("booking-2", venue_id="venue-2", pitch_id="pitch-2", status="confirmed")

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO media_assets (
                    id,venue_id,pitch_id,detected_content_type,image_bytes,byte_size,
                    width,height,etag,state,created_at_ms
                ) VALUES (?,?,?,'image/webp',?,?,?,?,?,'active',?)""",
                (
                    "photo-cross-tenant", "venue-1", "pitch-2", sqlite3.Binary(b"x"), 1, 1, 1, "d" * 64, 1,
                ),
            )
        self.db.rollback()

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO audit_events (id,venue_id,actor_user_id,entity_type,entity_id,action,created_at_ms) "
                "VALUES (?,?,?,?,?,?,?)",
                ("event-cross-tenant", "venue-1", "user-2", "booking", "x", "update", 1),
            )
        self.db.rollback()

    def test_slot_locks_reject_overlapping_reservations_at_database_level(self):
        self.add_booking_with_locks("booking-1", [0, 1], start_minute=840)
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.add_booking("booking-overlap", start_minute=870)
                # The second slot starts half an hour later and overlaps bucket 1.
                self.lock("booking-overlap", 1)
        self.assertIsNone(self.db.execute("SELECT id FROM bookings WHERE id='booking-overlap'").fetchone())

    def test_cancelled_slot_can_be_rebooked_without_deleting_booking_history(self):
        self.add_booking_with_locks("booking-old", [0], status="confirmed")
        with self.db:
            self.db.execute("DELETE FROM slot_locks WHERE booking_id='booking-old'")
            self.db.execute("UPDATE bookings SET status='cancelled', updated_at_ms=20 WHERE id='booking-old'")
            self.add_booking("booking-new", start_minute=840)
            self.lock("booking-new", 0)
        self.assertEqual(
            self.db.execute("SELECT status FROM bookings WHERE id='booking-old'").fetchone()[0],
            "cancelled",
        )
        self.assertEqual(
            self.db.execute(
                "SELECT booking_id FROM slot_locks WHERE pitch_id='pitch-1' AND business_date='2026-10-01' AND bucket_index=0"
            ).fetchone()[0],
            "booking-new",
        )

    def test_expiry_releases_only_past_pending_locks_and_preserves_confirmed_or_live_holds(self):
        self.add_booking_with_locks("pending-expired", [0], expiry=100)
        self.add_booking_with_locks("pending-live", [2], start_minute=900, expiry=500)
        self.add_booking_with_locks("confirmed-old-hold", [4], start_minute=960, status="confirmed", expiry=50)
        now_ms = 200

        with self.db:
            self.db.execute(
                """DELETE FROM slot_locks WHERE booking_id IN (
                    SELECT id FROM bookings WHERE status='pending' AND hold_expires_at_ms <= ?
                    AND (? IS NULL OR business_date = ?)
                )""",
                (now_ms, "2026-10-01", "2026-10-01"),
            )
            self.db.execute(
                """UPDATE bookings SET status='expired', updated_at_ms=?
                    WHERE status='pending' AND hold_expires_at_ms <= ?
                    AND (? IS NULL OR business_date = ?)""",
                (now_ms, now_ms, "2026-10-01", "2026-10-01"),
            )

        self.assertEqual(
            self.db.execute("SELECT status FROM bookings WHERE id='pending-expired'").fetchone()[0],
            "expired",
        )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM slot_locks WHERE booking_id='pending-expired'").fetchone()[0],
            0,
        )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM slot_locks WHERE booking_id='pending-live'").fetchone()[0],
            1,
        )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM slot_locks WHERE booking_id='confirmed-old-hold'").fetchone()[0],
            1,
        )

    def test_venue_slot_length_is_constrained(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE venues SET slot_length_minutes=75 WHERE id='venue-1'")
        self.db.rollback()


if __name__ == "__main__":
    unittest.main()
