import http.cookiejar
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server


class SharedCareApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.previous_db_path = server.DB_PATH
        server.DB_PATH = str(Path(cls.temp_dir.name) / "test.db")
        server.initialize()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.AppHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.thread.join(timeout=2)
        cls.httpd.server_close()
        server.DB_PATH = cls.previous_db_path
        cls.temp_dir.cleanup()

    def setUp(self):
        self.owner = self.make_client()
        self.caregiver = self.make_client()

    @staticmethod
    def make_client():
        cookies = http.cookiejar.CookieJar()
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))

    def request(self, client, path, method="GET", payload=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body else {},
        )
        try:
            with client.open(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def register(self, client, name, email, invite_code=""):
        return self.request(client, "/api/register", "POST", {
            "name": name,
            "email": email,
            "password": "morning-care-password",
            "invite_code": invite_code,
        })

    def test_invited_caregivers_share_dog_profile_and_records(self):
        status, _ = self.register(self.owner, "민지", "minji@example.com")
        self.assertEqual(status, 201)
        status, owner_data = self.request(self.owner, "/api/me")
        self.assertEqual(status, 200)
        dog = owner_data["dogs"][0]
        self.assertEqual((dog["name"], dog["birth_year"], dog["diagnosis"]), ("주모닝", 2017, "바베시아"))
        self.assertEqual(dog["med_start"], "07:30")
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/temperature")
        self.assertEqual(status, 200)
        self.assertEqual(
            [(record["recorded_at"], record["value"]) for record in records["records"]],
            [
                ("2026-10-07T03:30+00:00", 39.3),
                ("2026-10-07T05:02+00:00", 39.5),
                ("2026-10-07T05:13+00:00", 39.3),
                ("2026-10-07T05:24+00:00", 39.1),
                ("2026-10-07T05:43+00:00", 38.4),
                ("2026-10-07T08:09+00:00", 39.5),
            ],
        )
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/feeding")
        self.assertEqual(status, 200)
        self.assertEqual(
            [(record["recorded_at"], record["value"]) for record in records["records"]],
            [
                ("2026-10-06T22:15+00:00", 25),
                ("2026-10-07T05:51+00:00", 5),
                ("2026-10-07T06:00+00:00", 15),
                ("2026-10-07T06:15+00:00", 20),
            ],
        )
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/elimination")
        self.assertEqual(status, 200)
        self.assertEqual([record["detail"] for record in records["records"]], ["대변", "소변"])
        self.assertEqual(
            [record["recorded_at"] for record in records["records"]],
            ["2026-10-06T07:47+00:00", "2026-10-06T22:41+00:00"],
        )
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/medication")
        self.assertEqual(status, 200)
        self.assertEqual([record["dose_index"] for record in records["records"]], [1, 2])
        self.assertEqual(
            [record["recorded_at"] for record in records["records"]],
            ["2026-10-06T22:30+00:00", "2026-10-07T06:30+00:00"],
        )
        server.initialize()
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/temperature")
        self.assertEqual(status, 200)
        self.assertEqual(len(records["records"]), 6)

        status, _ = self.register(self.caregiver, "서준", "seojun@example.com")
        self.assertEqual(status, 201)
        status, _ = self.request(self.caregiver, "/api/join", "POST", {"code": dog["invite_code"].lower()})
        self.assertEqual(status, 200)
        status, caregiver_data = self.request(self.caregiver, "/api/me")
        self.assertEqual(status, 200)
        self.assertEqual(caregiver_data["dogs"][0]["id"], dog["id"])
        self.assertEqual(caregiver_data["dogs"][0]["role"], "caregiver")

        recorded_at = datetime.now().astimezone().isoformat(timespec="minutes")
        status, _ = self.request(self.caregiver, f"/api/dogs/{dog['id']}/temperature", "POST", {
            "value": 38.8,
            "recorded_at": recorded_at,
        })
        self.assertEqual(status, 201)
        status, _ = self.request(self.caregiver, f"/api/dogs/{dog['id']}/feeding", "POST", {
            "value": 25,
            "feeding_method": "self",
            "detail": "처방식",
            "recorded_at": recorded_at,
        })
        self.assertEqual(status, 201)
        status, _ = self.request(self.caregiver, f"/api/dogs/{dog['id']}/medication", "POST", {
            "dose_index": 1,
            "recorded_at": recorded_at,
        })
        self.assertEqual(status, 201)
        status, _ = self.request(self.caregiver, f"/api/dogs/{dog['id']}/schedule", "PUT", {"med_start": "07:30"})
        self.assertEqual(status, 200)
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/temperature")
        self.assertEqual(status, 200)
        self.assertTrue(any(item["value"] == 38.8 and item["caregiver"] == "서준" for item in records["records"]))
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/feeding")
        self.assertEqual(status, 200)
        self.assertTrue(any(item["value"] == 25 and item["caregiver"] == "서준" for item in records["records"]))
        self.assertTrue(any(item["value"] == 25 and item["feeding_method"] == "self" for item in records["records"]))
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/medication")
        self.assertEqual(status, 200)
        self.assertTrue(any(item["dose_index"] == 1 and item["caregiver"] == "서준" for item in records["records"]))
        status, _ = self.request(self.caregiver, f"/api/dogs/{dog['id']}/elimination", "POST", {
            "detail": "소변",
            "recorded_at": recorded_at,
        })
        self.assertEqual(status, 201)
        status, _ = self.request(self.caregiver, f"/api/dogs/{dog['id']}/vitality", "POST", {
            "value": 1,
            "memo": "식욕이 돌아옴",
            "recorded_at": recorded_at,
        })
        self.assertEqual(status, 201)
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/vitality")
        self.assertEqual(status, 200)
        self.assertTrue(any(
            item["value"] == 1 and item["detail"] == "좋음" and item["memo"] == "식욕이 돌아옴"
            for item in records["records"]
        ))
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/elimination")
        self.assertEqual(status, 200)
        self.assertTrue(any(item["detail"] == "소변" for item in records["records"]))
        status, _ = self.request(self.caregiver, f"/api/dogs/{dog['id']}/hydration", "POST", {
            "value": 35.5,
            "recorded_at": recorded_at,
        })
        self.assertEqual(status, 201)
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/hydration")
        self.assertEqual(status, 200)
        self.assertTrue(any(item["value"] == 35.5 and item["caregiver"] == "서준" for item in records["records"]))
        status, result = self.request(self.caregiver, f"/api/dogs/{dog['id']}/hydration", "POST", {
            "value": 0,
            "recorded_at": recorded_at,
        })
        self.assertEqual(status, 400)
        self.assertIn("음수량", result["error"])

    def test_signup_with_invitation_joins_without_creating_another_sample_dog(self):
        self.register(self.owner, "민지", "invitation-owner@example.com")
        _, owner_data = self.request(self.owner, "/api/me")
        invited_dog = owner_data["dogs"][0]

        status, _ = self.register(self.caregiver, "서준", "invitation-caregiver@example.com", invited_dog["invite_code"])
        self.assertEqual(status, 201)
        status, caregiver_data = self.request(self.caregiver, "/api/me")
        self.assertEqual(status, 200)
        self.assertEqual(len(caregiver_data["dogs"]), 1)
        self.assertEqual(caregiver_data["dogs"][0]["id"], invited_dog["id"])
        self.assertEqual(caregiver_data["dogs"][0]["role"], "caregiver")

    def test_invalid_invitation_and_measurements_are_rejected(self):
        self.register(self.owner, "민지", "invalid-test@example.com")
        _, profile = self.request(self.owner, "/api/me")
        dog = profile["dogs"][0]
        status, error = self.request(self.owner, "/api/join", "POST", {"code": "NOT-REAL"})
        self.assertEqual(status, 400)
        self.assertIn("초대 코드", error["error"])
        status, error = self.request(self.owner, f"/api/dogs/{dog['id']}/temperature", "POST", {
            "value": 90,
            "recorded_at": datetime.now().astimezone().isoformat(timespec="minutes"),
        })
        self.assertEqual(status, 400)
        self.assertIn("30~45", error["error"])

    def test_pwa_assets_are_served_with_installable_content_types(self):
        for path, expected_type in [
            ("/manifest.json", "application/manifest+json"),
            ("/sw.js", "text/javascript"),
            ("/icons/icon-192.png", "image/png"),
            ("/icons/apple-touch-icon.png", "image/png"),
        ]:
            request = urllib.request.Request(self.base_url + path)
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(expected_type, response.headers.get("Content-Type", ""))

    def test_admin_can_read_all_profiles_and_records_but_regular_users_cannot(self):
        self.register(self.owner, "민지", "admin-visibility-owner@example.com")
        _, owner_profile = self.request(self.owner, "/api/me")
        dog_id = owner_profile["dogs"][0]["id"]

        status, forbidden = self.request(self.owner, "/api/admin/overview")
        self.assertEqual(status, 403)
        self.assertIn("관리자", forbidden["error"])

        status, unauthorized = self.request(self.make_client(), "/api/admin/overview")
        self.assertEqual(status, 401)
        self.assertIn("로그인", unauthorized["error"])

        admin_email = "admin@example.com"
        admin_password = "a-long-test-admin-password"
        with patch.dict(os.environ, {"ADMIN_EMAIL": admin_email, "ADMIN_PASSWORD": admin_password}):
            server.initialize()
        status, login = self.request(self.caregiver, "/api/login", "POST", {
            "email": admin_email,
            "password": admin_password,
        })
        self.assertEqual(status, 200)
        self.assertEqual(login["user"]["role"], "admin")
        status, profile = self.request(self.caregiver, "/api/me")
        self.assertEqual(status, 200)
        self.assertEqual(profile["user"]["role"], "admin")
        status, overview = self.request(self.caregiver, "/api/admin/overview")
        self.assertEqual(status, 200)
        self.assertTrue(any(dog["id"] == dog_id for dog in overview["dogs"]))
        self.assertTrue(any(account["email"] == "admin-visibility-owner@example.com" for account in overview["users"]))
        self.assertTrue(any(record["dog_id"] == dog_id and record["kind"] == "temperature" for record in overview["records"]))
        self.assertTrue(all("invite_code" not in dog for dog in overview["dogs"]))

        with patch.dict(os.environ, {"ADMIN_EMAIL": admin_email, "ADMIN_PASSWORD": "a-new-test-admin-password"}):
            server.initialize()
        status, expired = self.request(self.caregiver, "/api/admin/overview")
        self.assertEqual(status, 401)
        self.assertIn("로그인", expired["error"])
        status, _ = self.request(self.make_client(), "/api/login", "POST", {
            "email": admin_email,
            "password": admin_password,
        })
        self.assertEqual(status, 401)
        status, login = self.request(self.make_client(), "/api/login", "POST", {
            "email": admin_email,
            "password": "a-new-test-admin-password",
        })
        self.assertEqual(status, 200)
        self.assertEqual(login["user"]["role"], "admin")

    def test_admin_credentials_must_be_set_together_and_strong(self):
        with tempfile.TemporaryDirectory() as directory:
            previous_db_path = server.DB_PATH
            server.DB_PATH = str(Path(directory) / "bootstrap.db")
            try:
                with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com"}, clear=True):
                    with self.assertRaisesRegex(RuntimeError, "모두 설정"):
                        server.initialize()
                with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com", "ADMIN_PASSWORD": "short"}):
                    with self.assertRaisesRegex(RuntimeError, "16자 이상"):
                        server.initialize()
            finally:
                server.DB_PATH = previous_db_path

    def test_admin_bootstraps_demo_dog_and_health_data_once(self):
        with tempfile.TemporaryDirectory() as directory:
            previous_db_path = server.DB_PATH
            server.DB_PATH = str(Path(directory) / "admin-demo.db")
            try:
                with patch.dict(os.environ, {
                    "ADMIN_EMAIL": "admin@example.com",
                    "ADMIN_PASSWORD": "a-long-test-admin-password",
                }):
                    server.initialize()
                    server.initialize()
                with server.database() as db:
                    dogs = db.execute(
                        "SELECT d.id,d.name,d.birth_year,d.diagnosis,u.role "
                        "FROM dogs d JOIN memberships m ON m.dog_id=d.id "
                        "JOIN users u ON u.id=m.user_id WHERE d.name='주모닝'"
                    ).fetchall()
                    self.assertEqual(len(dogs), 1)
                    self.assertEqual(
                        (dogs[0]["name"], dogs[0]["birth_year"], dogs[0]["diagnosis"], dogs[0]["role"]),
                        ("주모닝", 2017, "바베시아", "admin"),
                    )
                    self.assertEqual(
                        db.execute(
                            "SELECT COUNT(*) FROM records WHERE dog_id=?",
                            (dogs[0]["id"],),
                        ).fetchone()[0],
                        14,
                    )
                    self.assertEqual(
                        db.execute(
                            "SELECT COUNT(*) FROM records WHERE dog_id=? AND kind='temperature' "
                            "AND recorded_at='2026-10-07T08:09+00:00'",
                            (dogs[0]["id"],),
                        ).fetchone()[0],
                        1,
                    )
            finally:
                server.DB_PATH = previous_db_path

    def test_existing_database_migrates_and_seeds_default_dog_once(self):
        with tempfile.TemporaryDirectory() as directory:
            previous_db_path = server.DB_PATH
            server.DB_PATH = str(Path(directory) / "legacy.db")
            try:
                with sqlite3.connect(server.DB_PATH) as db:
                    db.executescript(
                        """
                        CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
                            password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
                        CREATE TABLE dogs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, birth_year INTEGER NOT NULL,
                            diagnosis TEXT NOT NULL DEFAULT '', invite_code TEXT NOT NULL UNIQUE,
                            med_start TEXT NOT NULL DEFAULT '08:00', created_at TEXT NOT NULL);
                        CREATE TABLE memberships (user_id INTEGER NOT NULL REFERENCES users(id),
                            dog_id INTEGER NOT NULL REFERENCES dogs(id), role TEXT NOT NULL,
                            PRIMARY KEY(user_id,dog_id));
                        CREATE TABLE records (id INTEGER PRIMARY KEY, dog_id INTEGER NOT NULL REFERENCES dogs(id),
                            user_id INTEGER NOT NULL REFERENCES users(id),
                            kind TEXT NOT NULL CHECK(kind IN ('temperature','feeding','medication')),
                            value REAL, detail TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL,
                            dose_index INTEGER, created_at TEXT NOT NULL);
                        INSERT INTO users VALUES (1,'민지','legacy@example.com','hash','2026-10-07T00:00+00:00');
                        INSERT INTO dogs VALUES (1,'주모닝',2017,'바베시아','LEGACY01','08:00','2026-10-07T00:00+00:00');
                        INSERT INTO memberships VALUES (1,1,'owner');
                        INSERT INTO records VALUES (1,1,1,'temperature',38.2,'기존 기록',
                            '2026-10-06T00:00+00:00',NULL,'2026-10-06T00:00+00:00');
                        """
                    )
                server.initialize()
                server.initialize()
                with server.database() as db:
                    kinds = db.execute("SELECT kind,COUNT(*) AS count FROM records GROUP BY kind").fetchall()
                    counts = {row["kind"]: row["count"] for row in kinds}
                    self.assertEqual(counts["temperature"], 7)
                    self.assertEqual(counts["elimination"], 2)
                    self.assertEqual(counts["feeding"], 4)
                    feeding_methods = db.execute(
                        "SELECT recorded_at,feeding_method FROM records WHERE dog_id=1 AND kind='feeding' "
                        "ORDER BY recorded_at"
                    ).fetchall()
                    self.assertEqual([row["feeding_method"] for row in feeding_methods], ["assisted", "assisted", "assisted", "self"])
                    self.assertNotIn("hydration", counts)
                    self.assertEqual(counts["medication"], 2)
                    self.assertEqual(
                        db.execute("SELECT detail FROM records WHERE id=1").fetchone()["detail"],
                        "기존 기록",
                    )
                    self.assertEqual(
                        db.execute("SELECT med_start FROM dogs WHERE id=1").fetchone()["med_start"],
                        "07:30",
                    )
                    self.assertIn("role", {row["name"] for row in db.execute("PRAGMA table_info(users)")})
                    self.assertEqual(db.execute("SELECT role FROM users WHERE id=1").fetchone()["role"], "user")
                    records_schema = db.execute(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name='records'"
                    ).fetchone()["sql"]
                    self.assertIn("'hydration'", records_schema)
                    self.assertIn("memo TEXT NOT NULL DEFAULT ''", records_schema)
            finally:
                server.DB_PATH = previous_db_path


if __name__ == "__main__":
    unittest.main()
