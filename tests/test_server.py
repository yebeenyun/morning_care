import http.cookiejar
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path

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
        self.assertEqual(len(records["records"]), 5)

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
            "recorded_at": recorded_at,
        })
        self.assertEqual(status, 201)
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/vitality")
        self.assertEqual(status, 200)
        self.assertTrue(any(item["value"] == 1 and item["detail"] == "좋음" for item in records["records"]))
        status, records = self.request(self.owner, f"/api/dogs/{dog['id']}/elimination")
        self.assertEqual(status, 200)
        self.assertTrue(any(item["detail"] == "소변" for item in records["records"]))

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
                    self.assertEqual(counts["temperature"], 6)
                    self.assertEqual(counts["elimination"], 2)
                    self.assertEqual(counts["feeding"], 4)
                    self.assertEqual(counts["medication"], 2)
                    self.assertEqual(
                        db.execute("SELECT detail FROM records WHERE id=1").fetchone()["detail"],
                        "기존 기록",
                    )
                    self.assertEqual(
                        db.execute("SELECT med_start FROM dogs WHERE id=1").fetchone()["med_start"],
                        "07:30",
                    )
            finally:
                server.DB_PATH = previous_db_path


if __name__ == "__main__":
    unittest.main()
