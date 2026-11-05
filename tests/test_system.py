import pytest
from werkzeug.security import generate_password_hash

from app import create_app
from database import execute, now, query_all, query_one, select_one
from validators import validate_event, validate_student_edit

STUDENT = {
    "full_name": "Ada Lovelace",
    "student_id": "HV-1001",
    "email": "ada@harborview.edu",
    "department": "Computer Science",
    "year_level": "2nd Year",
    "password": "eventpass1",
    "confirm_password": "eventpass1",
}

SENT_CODES = {}


@pytest.fixture
def app(tmp_path):
    application = create_app(
        {
            "TESTING": True,
            "WTF_CSRF_ENABLED": False,
            "SECRET_KEY": "test-secret",
            "DATABASE_BACKEND": "sqlite",
            "DATABASE_PATH": str(tmp_path / "test.db"),
        }
    )
    yield application


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def mock_email_delivery(monkeypatch):
    SENT_CODES.clear()

    def capture_email(recipient, _name, code, _purpose):
        SENT_CODES[recipient] = code

    monkeypatch.setattr("email_challenges.send_email", capture_email)


def complete_pending_email(client):
    with client.session_transaction() as browser_session:
        student_id = browser_session.get("pending_email_student_id")
    if student_id is None:
        return None
    with client.application.app_context():
        student = select_one("students", filters={"id": student_id})
    return client.post(
        "/verify-email",
        data={"code": SENT_CODES[student["email"]]},
        follow_redirects=True,
    )


def test_app_rejects_placeholder_secret_key(tmp_path):
    with pytest.raises(RuntimeError, match="Set SECRET_KEY"):
        create_app(
            {
                "SECRET_KEY": "dev-only-change-me",
                "DATABASE_BACKEND": "sqlite",
                "DATABASE_PATH": str(tmp_path / "secret.db"),
            }
        )


def add_admin(app, email="office@harborview.edu", password="officepass1"):
    with app.app_context():
        execute(
            """
            INSERT INTO admins (full_name, email, password_hash, created_at)
            VALUES (?, ?, ?, ?)
            """,
            ("Event Office", email, generate_password_hash(password), now()),
        )


def login_student(client, identifier="HV-1001", password="eventpass1"):
    return client.post(
        "/login",
        data={"identifier": identifier, "password": password},
        follow_redirects=True,
    )


def login_student(client, identifier="HV-1001", password=STUDENT["password"]):
    complete_pending_email(client)
    response = client.post(
        "/login",
        data={"identifier": identifier, "password": password},
        follow_redirects=True,
    )
    while True:
        with client.session_transaction() as browser_session:
            student_id = browser_session.get("pending_email_student_id")
        if student_id is None:
            return response
        response = complete_pending_email(client)


def login_admin(client):
    return client.post(
        "/admin/login",
        data={"email": "office@harborview.edu", "password": "officepass1"},
        follow_redirects=True,
    )


def test_public_pages_load(client):
    for path in ("/", "/login", "/signup", "/admin/login"):
        response = client.get(path)
        assert response.status_code == 200
    home = client.get("/")
    assert b"Welcome Week Club Fair" in home.data


def test_signup_rejects_a_weak_password(client):
    data = dict(STUDENT)
    data["password"] = "short"
    data["confirm_password"] = "short"
    response = client.post("/signup", data=data)
    assert response.status_code == 200
    assert b"at least 8 characters" in response.data


def test_student_edit_rejects_invalid_account_status():
    values, _, errors = validate_student_edit(
        {
            "full_name": "Ada Lovelace",
            "student_id": "HV-1001",
            "email": "ada@harborview.edu",
            "department": "Computer Science",
            "year_level": "2nd Year",
            "is_active": "invalid",
        }
    )
    assert values["is_active"] == 0
    assert "is_active" in errors


def test_event_rejects_noncanonical_datetime():
    _, errors = validate_event(
        {
            "title": "Test event",
            "description": "A valid event description.",
            "location": "Main Hall",
            "event_date": "2026-12-01T10:00junk",
        }
    )
    assert "event_date" in errors


def test_event_capacity_must_be_a_positive_whole_number():
    values, errors = validate_event(
        {
            "title": "Test event",
            "description": "A valid event description.",
            "location": "Main Hall",
            "event_date": "2026-12-01T10:00",
            "capacity": "2.5",
        }
    )
    assert values["capacity"] == "2.5"
    assert "capacity" in errors


def test_admin_can_create_event_with_capacity(app):
    add_admin(app)
    office = app.test_client()
    login_admin(office)
    response = office.post(
        "/admin/events/new",
        data={
            "title": "Capacity test",
            "description": "A valid event description.",
            "location": "Main Hall",
            "event_date": "2026-12-01T10:00",
            "capacity": "12",
        },
        follow_redirects=True,
    )
    assert b"Event posted" in response.data
    with app.app_context():
        event = query_one("SELECT capacity FROM events WHERE title = 'Capacity test'")
    assert event["capacity"] == 12


def test_student_can_register_and_password_is_hashed(client, app):
    response = client.post("/signup", data=STUDENT, follow_redirects=True)
    assert response.status_code == 200
    assert b"Confirm your email" in response.data
    complete_pending_email(client)
    with app.app_context():
        row = query_one(
            "SELECT password_hash,email_verified FROM students WHERE email = ?",
            (STUDENT["email"],),
        )
    assert row["password_hash"] != STUDENT["password"]
    assert row["email_verified"] == 1
    assert "eventpass1" not in row["password_hash"]


def test_duplicate_email_is_rejected(client):
    client.post("/signup", data=STUDENT)
    again = dict(STUDENT)
    again["student_id"] = "HV-1002"
    response = client.post("/signup", data=again)
    assert b"already registered" in response.data


def test_login_records_success_and_failure(client, app):
    client.post("/signup", data=STUDENT)
    bad = client.post("/login", data={"identifier": "HV-1001", "password": "wrongpass1"})
    assert b"not right" in bad.data
    good = login_student(client)
    assert b"Good" in good.data
    assert b"Ada" in good.data
    with app.app_context():
        rows = query_all("SELECT status FROM login_records ORDER BY id")
    assert [row["status"] for row in rows] == ["failed", "success"]


def test_student_sees_only_their_own_records(app):
    ada = app.test_client()
    grace = app.test_client()
    ada.post("/signup", data=STUDENT)
    other = dict(STUDENT)
    other.update(
        {
            "full_name": "Grace Hopper",
            "student_id": "HV-2002",
            "email": "grace@harborview.edu",
            "department": "Engineering",
        }
    )
    grace.post("/signup", data=other)
    login_student(ada)
    login_student(grace, "grace@harborview.edu")
    page = ada.get("/my-logins")
    assert page.status_code == 200
    assert b"Successful" in page.data
    assert b"grace@harborview.edu" not in page.data
    assert b"HV-2002" not in page.data
    assert b"Delete" not in page.data


def test_student_cannot_open_admin_pages(client):
    client.post("/signup", data=STUDENT)
    login_student(client)
    assert client.get("/admin/").status_code == 403
    assert client.post("/admin/records/1/delete").status_code == 403
    assert client.get("/admin/students").status_code == 403


def test_admin_cannot_open_the_student_dashboard(app):
    add_admin(app)
    client = app.test_client()
    login_admin(client)
    assert client.get("/dashboard").status_code == 403


def test_anonymous_users_are_sent_to_the_right_login(client):
    student_gate = client.get("/dashboard")
    admin_gate = client.get("/admin/students")
    assert student_gate.status_code == 302
    assert "/login" in student_gate.headers["Location"]
    assert admin_gate.status_code == 302
    assert "/admin/login" in admin_gate.headers["Location"]


def test_login_requires_an_email_code(client):
    client.post("/signup", data=STUDENT)
    complete_pending_email(client)
    response = client.post(
        "/login",
        data={"identifier": "HV-1001", "password": STUDENT["password"]},
        follow_redirects=True,
    )
    assert b"Confirm your sign-in" in response.data
    verified = complete_pending_email(client)
    assert b"Good" in verified.data


def test_event_registration_waitlists_and_promotes_next_student(app):
    with app.app_context():
        ada_id = execute(
            """INSERT INTO students
            (full_name,student_id,email,department,year_level,password_hash,email_verified,is_active,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            ("Ada Lovelace", "HV-1001", "ada@harborview.edu", "Computer Science", "2nd Year", "hash", 1, 1, now()),
        )
        grace_id = execute(
            """INSERT INTO students
            (full_name,student_id,email,department,year_level,password_hash,email_verified,is_active,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            ("Grace Hopper", "HV-2002", "grace@harborview.edu", "Engineering", "4th Year", "hash", 1, 1, now()),
        )
        event_id = execute(
            """INSERT INTO events (title,description,location,event_date,capacity,created_at)
            VALUES (?,?,?,?,?,?)""",
            ("Test event", "A test event.", "Main Hall", "2026-12-01 10:00", 1, now()),
        )

    ada = app.test_client()
    grace = app.test_client()
    for student_client, student_id, name in (
        (ada, ada_id, "Ada Lovelace"),
        (grace, grace_id, "Grace Hopper"),
    ):
        with student_client.session_transaction() as browser_session:
            browser_session.update(role="student", user_id=student_id, name=name)

    assert b"You are registered" in ada.post(
        f"/events/{event_id}/register", follow_redirects=True
    ).data
    assert b"waitlist" in grace.post(
        f"/events/{event_id}/register", follow_redirects=True
    ).data.lower()
    ada.post(f"/events/{event_id}/cancel", follow_redirects=True)
    assert b"You are registered" in grace.get("/dashboard").data


def test_admin_can_filter_edit_and_delete_records(app):
    add_admin(app)
    student = app.test_client()
    office = app.test_client()
    student.post("/signup", data=STUDENT)
    other = dict(STUDENT)
    other.update(
        {
            "full_name": "Grace Hopper",
            "student_id": "HV-2002",
            "email": "grace@harborview.edu",
            "department": "Nursing",
            "year_level": "4th Year",
        }
    )
    student.post("/signup", data=other)
    login_student(student)
    login_admin(office)

    filtered = office.get("/admin/students?department=Nursing")
    assert b"Grace Hopper" in filtered.data
    assert b"Ada Lovelace" not in filtered.data

    with app.app_context():
        record = query_one("SELECT id FROM login_records WHERE status = 'success' ORDER BY id LIMIT 1")
        ada = query_one("SELECT id FROM students WHERE student_id = 'HV-1001'")

    edited = office.post(
        f"/admin/records/{record['id']}/edit",
        data={"status": "failed", "note": "Corrected after a test login."},
        follow_redirects=True,
    )
    assert b"Login record updated" in edited.data

    removed = office.post(f"/admin/records/{record['id']}/delete", follow_redirects=True)
    assert b"Login record deleted" in removed.data

    office.post(
        f"/admin/students/{ada['id']}/edit",
        data={
            "full_name": "Ada Lovelace",
            "student_id": "HV-1001",
            "email": "ada@harborview.edu",
            "department": "Computer Science",
            "year_level": "3rd Year",
            "is_active": "0",
        },
        follow_redirects=True,
    )
    blocked = student.get("/dashboard", follow_redirects=True)
    assert b"not active" in blocked.data

    with app.app_context():
        audit = query_one("SELECT COUNT(*) AS n FROM admin_audit_logs")
    assert audit["n"] >= 3


def test_failed_logins_lock_after_five_tries(client):
    client.post("/signup", data=STUDENT)
    last = None
    for _ in range(6):
        last = client.post("/login", data={"identifier": "HV-1001", "password": "wrongpass1"})
    assert b"Too many failed" in last.data


def test_post_without_csrf_token_is_rejected(tmp_path):
    application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "DATABASE_BACKEND": "sqlite",
            "DATABASE_PATH": str(tmp_path / "csrf.db"),
        }
    )
    response = application.test_client().post("/signup", data=STUDENT, follow_redirects=True)
    assert b"form expired" in response.data
