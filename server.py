import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = os.environ.get("DATABASE_PATH", str(ROOT / "data" / "morning.db"))
PORT = int(os.environ.get("PORT", "8000"))
SESSION_DAYS = 14
KOREA_TIME = timezone(timedelta(hours=9))
RECORD_KINDS = ("temperature", "feeding", "medication", "elimination", "vitality")


def connect():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


@contextmanager
def database():
    db = connect()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize():
    with database() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS dogs (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                birth_year INTEGER NOT NULL,
                diagnosis TEXT NOT NULL DEFAULT '',
                invite_code TEXT NOT NULL UNIQUE,
                med_start TEXT NOT NULL DEFAULT '08:00',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS memberships (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('owner', 'caregiver')),
                PRIMARY KEY (user_id, dog_id)
            );
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY,
                dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('temperature', 'feeding', 'medication', 'elimination', 'vitality')),
                value REAL,
                detail TEXT NOT NULL DEFAULT '',
                recorded_at TEXT NOT NULL,
                dose_index INTEGER,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS seeded_dog_data (
                dog_id INTEGER PRIMARY KEY REFERENCES dogs(id) ON DELETE CASCADE
            );
            """
        )
        schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='records'").fetchone()["sql"]
        if "elimination" not in schema or "vitality" not in schema:
            db.execute("DROP INDEX IF EXISTS records_dog_kind_time")
            db.execute("ALTER TABLE records RENAME TO records_legacy")
            db.execute(
                "CREATE TABLE records ("
                "id INTEGER PRIMARY KEY,"
                "dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,"
                "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
                "kind TEXT NOT NULL CHECK (kind IN ('temperature','feeding','medication','elimination','vitality')),"
                "value REAL, detail TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL,"
                "dose_index INTEGER, created_at TEXT NOT NULL)"
            )
            db.execute(
                "INSERT INTO records(id,dog_id,user_id,kind,value,detail,recorded_at,dose_index,created_at) "
                "SELECT id,dog_id,user_id,kind,value,detail,recorded_at,dose_index,created_at FROM records_legacy"
            )
            db.execute("DROP TABLE records_legacy")
        db.execute("CREATE INDEX IF NOT EXISTS records_dog_kind_time ON records(dog_id, kind, recorded_at)")
        default_dogs = db.execute(
            "SELECT id FROM dogs WHERE name='주모닝' AND birth_year=2017 AND diagnosis='바베시아'"
        ).fetchall()
        for dog in default_dogs:
            owner = db.execute(
                "SELECT user_id FROM memberships WHERE dog_id=? ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1",
                (dog["id"],),
            ).fetchone()
            if owner:
                add_sample_records(db, dog["id"], owner["user_id"])


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="minutes")


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 180_000)
    return f"{salt}${hashed.hex()}"


def password_matches(password, stored):
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(password_hash(password, salt), stored)


def create_session(db, user_id):
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + SESSION_DAYS * 86400),
    )
    return token


def clean_text(value, label, maximum=120, allow_empty=False):
    if not isinstance(value, str):
        raise ValueError(f"{label}을(를) 입력해 주세요.")
    value = value.strip()
    if (not value and not allow_empty) or len(value) > maximum:
        raise ValueError(f"{label}은(는) 1~{maximum}자 이내로 입력해 주세요.")
    return value


def valid_recorded_at(value):
    if not isinstance(value, str):
        raise ValueError("날짜와 시간을 확인해 주세요.")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("날짜와 시간을 확인해 주세요.") from exc
    if parsed.tzinfo is None:
        parsed = parsed.astimezone()
    if parsed.year < 2000 or parsed > datetime.now().astimezone() + timedelta(minutes=1):
        raise ValueError("날짜와 시간을 확인해 주세요.")
    return parsed.astimezone(timezone.utc).isoformat(timespec="minutes")


def add_sample_records(db, dog_id, user_id):
    if db.execute("SELECT 1 FROM seeded_dog_data WHERE dog_id=?", (dog_id,)).fetchone():
        return

    db.execute("UPDATE dogs SET med_start='07:30' WHERE id=? AND med_start='08:00'", (dog_id,))
    samples = [
        ("temperature", 39.3, "", "2026-10-07T12:30", None),
        ("temperature", 39.5, "", "2026-10-07T14:02", None),
        ("temperature", 39.3, "", "2026-10-07T14:13", None),
        ("temperature", 39.1, "", "2026-10-07T14:24", None),
        ("temperature", 38.4, "", "2026-10-07T14:43", None),
        ("feeding", 25, "", "2026-10-07T07:15", None),
        ("feeding", 5, "", "2026-10-07T14:51", None),
        ("feeding", 15, "", "2026-10-07T15:00", None),
        ("feeding", 20, "", "2026-10-07T15:15", None),
        ("elimination", None, "대변", "2026-10-06T16:47", None),
        ("elimination", None, "소변", "2026-10-07T07:41", None),
        ("medication", None, "", "2026-10-07T07:30", 1),
        ("medication", None, "", "2026-10-07T15:30", 2),
    ]
    db.executemany(
        "INSERT INTO records(dog_id,user_id,kind,value,detail,recorded_at,dose_index,created_at) "
        "VALUES(?,?,?,?,?,?,?,?)",
        [
            (
                dog_id,
                user_id,
                kind,
                value,
                detail,
                datetime.fromisoformat(recorded).replace(tzinfo=KOREA_TIME).astimezone(timezone.utc).isoformat(timespec="minutes"),
                dose_index,
                now_iso(),
            )
            for kind, value, detail, recorded, dose_index in samples
        ],
    )
    db.execute("INSERT INTO seeded_dog_data(dog_id) VALUES(?)", (dog_id,))


class AppHandler(BaseHTTPRequestHandler):
    server_version = "MorningCare/1.0"

    def log_message(self, fmt, *args):
        print(f"{self.log_date_time_string()} {self.address_string()} {fmt % args}")

    def send_json(self, status, payload, cookie=None, clear_cookie=False):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
            self.send_header(
                "Set-Cookie",
                f"morning_session={cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_DAYS * 86400}{secure}",
            )
        elif clear_cookie:
            self.send_header("Set-Cookie", "morning_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
        self.end_headers()
        self.wfile.write(body)

    def body_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("요청 형식이 올바르지 않습니다.") from exc
        if length < 2 or length > 16_384:
            raise ValueError("요청 데이터가 비어 있거나 너무 큽니다.")
        try:
            value = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError("요청 형식이 올바르지 않습니다.") from exc
        if not isinstance(value, dict):
            raise ValueError("요청 형식이 올바르지 않습니다.")
        return value

    def current_user(self, db):
        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        morsel = cookie.get("morning_session")
        if not morsel:
            return None
        token_hash = hashlib.sha256(morsel.value.encode()).hexdigest()
        row = db.execute(
            "SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id "
            "WHERE s.token_hash=? AND s.expires_at>?",
            (token_hash, int(time.time())),
        ).fetchone()
        return dict(row) if row else None

    def json_response(self, status, payload, cookie=None, clear_cookie=False):
        self.send_json(status, payload, cookie, clear_cookie)

    def handle_api(self, method, path):
        try:
            data = self.body_json() if method in ("POST", "PUT") else {}
            with database() as db:
                if path == "/api/register" and method == "POST":
                    name = clean_text(data.get("name"), "이름", 50)
                    email = clean_text(data.get("email"), "이메일", 200).lower()
                    invite_code = clean_text(data.get("invite_code", ""), "초대 코드", 20, allow_empty=True).upper()
                    password = data.get("password")
                    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                        raise ValueError("올바른 이메일 주소를 입력해 주세요.")
                    if not isinstance(password, str) or len(password) < 8 or len(password) > 200:
                        raise ValueError("비밀번호는 8자 이상 입력해 주세요.")
                    invited_dog = None
                    if invite_code:
                        invited_dog = db.execute("SELECT id FROM dogs WHERE invite_code=?", (invite_code,)).fetchone()
                        if not invited_dog:
                            raise ValueError("초대 코드를 찾을 수 없습니다.")
                    try:
                        cursor = db.execute(
                            "INSERT INTO users(name,email,password_hash,created_at) VALUES(?,?,?,?)",
                            (name, email, password_hash(password), now_iso()),
                        )
                    except sqlite3.IntegrityError as exc:
                        raise ValueError("이미 가입된 이메일입니다.") from exc
                    user_id = cursor.lastrowid
                    if invited_dog:
                        db.execute(
                            "INSERT INTO memberships(user_id,dog_id,role) VALUES(?,?,?)",
                            (user_id, invited_dog["id"], "caregiver"),
                        )
                    else:
                        dog_invite_code = secrets.token_hex(4).upper()
                        dog_cursor = db.execute(
                            "INSERT INTO dogs(name,birth_year,diagnosis,invite_code,med_start,created_at) "
                            "VALUES(?,?,?,?,?,?)",
                            ("주모닝", 2017, "바베시아", dog_invite_code, "07:30", now_iso()),
                        )
                        dog_id = dog_cursor.lastrowid
                        db.execute("INSERT INTO memberships(user_id,dog_id,role) VALUES(?,?,?)", (user_id, dog_id, "owner"))
                        add_sample_records(db, dog_id, user_id)
                    session = create_session(db, user_id)
                    self.json_response(201, {"user": {"id": user_id, "name": name, "email": email}}, session)
                    return

                if path == "/api/login" and method == "POST":
                    email = clean_text(data.get("email"), "이메일", 200).lower()
                    password = data.get("password")
                    user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
                    if not user or not isinstance(password, str) or not password_matches(password, user["password_hash"]):
                        self.json_response(HTTPStatus.UNAUTHORIZED, {"error": "이메일 또는 비밀번호를 확인해 주세요."})
                        return
                    session = create_session(db, user["id"])
                    self.json_response(200, {"user": {"id": user["id"], "name": user["name"], "email": user["email"]}}, session)
                    return

                user = self.current_user(db)
                if path == "/api/logout" and method == "POST":
                    if user:
                        cookie = SimpleCookie()
                        cookie.load(self.headers.get("Cookie", ""))
                        token = cookie.get("morning_session")
                        if token:
                            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.value.encode()).hexdigest(),))
                    self.json_response(200, {"ok": True}, clear_cookie=True)
                    return

                if path == "/api/me" and method == "GET":
                    if not user:
                        self.json_response(200, {"user": None})
                        return
                    dogs = db.execute(
                        "SELECT d.id,d.name,d.birth_year,d.diagnosis,d.invite_code,d.med_start,m.role "
                        "FROM dogs d JOIN memberships m ON m.dog_id=d.id WHERE m.user_id=? ORDER BY d.id",
                        (user["id"],),
                    ).fetchall()
                    self.json_response(200, {"user": user, "dogs": [dict(dog) for dog in dogs]})
                    return

                if not user:
                    self.json_response(HTTPStatus.UNAUTHORIZED, {"error": "로그인이 필요합니다."})
                    return

                if path == "/api/join" and method == "POST":
                    code = clean_text(data.get("code"), "초대 코드", 20).upper()
                    dog = db.execute("SELECT id FROM dogs WHERE invite_code=?", (code,)).fetchone()
                    if not dog:
                        raise ValueError("초대 코드를 찾을 수 없습니다.")
                    db.execute(
                        "INSERT OR IGNORE INTO memberships(user_id,dog_id,role) VALUES(?,?,?)",
                        (user["id"], dog["id"], "caregiver"),
                    )
                    self.json_response(200, {"ok": True})
                    return

                if path == "/api/dogs" and method == "POST":
                    name = clean_text(data.get("name"), "강아지 이름", 50)
                    try:
                        birth_year = int(data.get("birth_year"))
                    except (TypeError, ValueError) as exc:
                        raise ValueError("출생 연도를 확인해 주세요.") from exc
                    if not 2000 <= birth_year <= datetime.now().year:
                        raise ValueError("출생 연도를 확인해 주세요.")
                    diagnosis = clean_text(data.get("diagnosis", ""), "병명", 120, allow_empty=True)
                    invite_code = secrets.token_hex(4).upper()
                    cursor = db.execute(
                        "INSERT INTO dogs(name,birth_year,diagnosis,invite_code,created_at) VALUES(?,?,?,?,?)",
                        (name, birth_year, diagnosis, invite_code, now_iso()),
                    )
                    db.execute(
                        "INSERT INTO memberships(user_id,dog_id,role) VALUES(?,?,?)",
                        (user["id"], cursor.lastrowid, "owner"),
                    )
                    self.json_response(201, {"ok": True})
                    return

                dog_match = re.fullmatch(
                    r"/api/dogs/(\d+)(?:/(temperature|feeding|medication|elimination|vitality|schedule|invite))?",
                    path,
                )
                if dog_match:
                    dog_id = int(dog_match.group(1))
                    section = dog_match.group(2)
                    member = db.execute(
                        "SELECT role FROM memberships WHERE user_id=? AND dog_id=?",
                        (user["id"], dog_id),
                    ).fetchone()
                    if not member:
                        self.json_response(HTTPStatus.NOT_FOUND, {"error": "강아지 프로필을 찾을 수 없습니다."})
                        return
                    if method == "PUT" and section is None:
                        name = clean_text(data.get("name"), "강아지 이름", 50)
                        try:
                            year = int(data.get("birth_year"))
                        except (TypeError, ValueError) as exc:
                            raise ValueError("출생 연도를 확인해 주세요.") from exc
                        if not 2000 <= year <= datetime.now().year:
                            raise ValueError("출생 연도를 확인해 주세요.")
                        diagnosis = clean_text(data.get("diagnosis", ""), "병명", 120, allow_empty=True)
                        db.execute(
                            "UPDATE dogs SET name=?,birth_year=?,diagnosis=? WHERE id=?",
                            (name, year, diagnosis, dog_id),
                        )
                        self.json_response(200, {"ok": True})
                        return
                    if section == "invite" and method == "POST":
                        if member["role"] != "owner":
                            self.json_response(HTTPStatus.FORBIDDEN, {"error": "보호자만 초대 코드를 새로 만들 수 있습니다."})
                            return
                        code = secrets.token_hex(4).upper()
                        db.execute("UPDATE dogs SET invite_code=? WHERE id=?", (code, dog_id))
                        self.json_response(200, {"code": code})
                        return
                    if section == "schedule" and method == "PUT":
                        start = data.get("med_start")
                        if not isinstance(start, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", start):
                            raise ValueError("복약 시작 시간을 확인해 주세요.")
                        db.execute("UPDATE dogs SET med_start=? WHERE id=?", (start, dog_id))
                        self.json_response(200, {"ok": True})
                        return
                    if section in RECORD_KINDS and method == "GET":
                        rows = db.execute(
                            "SELECT r.id,r.value,r.detail,r.recorded_at,r.dose_index,u.name AS caregiver "
                            "FROM records r JOIN users u ON u.id=r.user_id "
                            "WHERE r.dog_id=? AND r.kind=? ORDER BY r.recorded_at",
                            (dog_id, section),
                        ).fetchall()
                        self.json_response(200, {"records": [dict(row) for row in rows]})
                        return
                    if section in RECORD_KINDS and method == "POST":
                        recorded_at = valid_recorded_at(data.get("recorded_at"))
                        value = None
                        dose_index = None
                        detail = clean_text(data.get("detail", ""), "메모", 200, allow_empty=True)
                        if section == "temperature":
                            try:
                                value = float(data.get("value"))
                            except (TypeError, ValueError) as exc:
                                raise ValueError("체온을 숫자로 입력해 주세요.") from exc
                            if not 30 <= value <= 45:
                                raise ValueError("체온은 30~45°C 범위로 입력해 주세요.")
                            value = round(value, 1)
                        elif section == "feeding":
                            try:
                                value = float(data.get("value"))
                            except (TypeError, ValueError) as exc:
                                raise ValueError("급여량을 숫자로 입력해 주세요.") from exc
                            if not 0.1 <= value <= 2000:
                                raise ValueError("급여량은 0.1~2,000ml 범위로 입력해 주세요.")
                            value = round(value, 1)
                        elif section == "medication":
                            try:
                                dose_index = int(data.get("dose_index"))
                            except (TypeError, ValueError) as exc:
                                raise ValueError("복약 회차를 선택해 주세요.") from exc
                            if dose_index not in (1, 2, 3):
                                raise ValueError("복약 회차를 선택해 주세요.")
                        elif section == "elimination":
                            if detail not in ("소변", "대변"):
                                raise ValueError("소변 또는 대변을 선택해 주세요.")
                        elif section == "vitality":
                            try:
                                value = int(data.get("value"))
                            except (TypeError, ValueError) as exc:
                                raise ValueError("활력 상태를 선택해 주세요.") from exc
                            if value not in (1, 2, 3):
                                raise ValueError("활력 상태를 선택해 주세요.")
                            detail = {1: "좋음", 2: "보통", 3: "나쁨"}[value]
                        db.execute(
                            "INSERT INTO records(dog_id,user_id,kind,value,detail,recorded_at,dose_index,created_at) "
                            "VALUES(?,?,?,?,?,?,?,?)",
                            (dog_id, user["id"], section, value, detail, recorded_at, dose_index, now_iso()),
                        )
                        self.json_response(201, {"ok": True})
                        return

                self.json_response(HTTPStatus.NOT_FOUND, {"error": "요청한 기능을 찾을 수 없습니다."})
        except ValueError as exc:
            self.json_response(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except sqlite3.Error:
            self.json_response(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "저장 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."})

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.handle_api("GET", path)
            return
        if path == "/":
            path = "/index.html"
        target = (ROOT / path.lstrip("/")).resolve()
        if ROOT not in target.parents or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".json": "application/manifest+json; charset=utf-8",
            ".png": "image/png",
        }.get(target.suffix, "application/octet-stream")
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.handle_api("POST", path)
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.handle_api("PUT", path)
        else:
            self.send_error(HTTPStatus.NOT_FOUND)


if __name__ == "__main__":
    initialize()
    print(f"Morning Care is listening on 0.0.0.0:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), AppHandler).serve_forever()
