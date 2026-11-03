import sqlite3
from datetime import datetime, timedelta

from postgrest.exceptions import APIError
from werkzeug.security import check_password_hash, generate_password_hash

from database import insert_row, now, select_one, select_rows

LOCK_LIMIT = 5
LOCK_MINUTES = 10


def record_login(student, identifier, status, ip_address, user_agent):
    insert_row(
        "login_records",
        {
            "student_id": None if student is None else student["id"],
            "student_code": None if student is None else student["student_id"],
            "student_name": None if student is None else student["full_name"],
            "attempted_identifier": identifier[:120],
            "status": status,
            "ip_address": (ip_address or "")[:80],
            "user_agent": (user_agent or "")[:255],
            "created_at": now(),
        },
    )


def register_student(values, password):
    existing_email = select_one("students", columns="id", filters={"email": values["email"]})
    existing_id = select_one("students", columns="id", filters={"student_id": values["student_id"]})
    if existing_email and existing_id:
        return None, "That student ID and email are already registered."
    if existing_email:
        return None, "That email is already registered."
    if existing_id:
        return None, "That student ID is already registered."

    try:
        student = insert_row(
            "students",
            {
                "full_name": values["full_name"],
                "student_id": values["student_id"],
                "email": values["email"],
                "department": values["department"],
                "year_level": values["year_level"],
                "password_hash": generate_password_hash(password),
                "is_active": 1,
                "created_at": now(),
            },
        )
    except sqlite3.IntegrityError:
        return None, "That student ID or email is already registered."
    except APIError as error:
        if error.code == "23505":
            return None, "That student ID or email is already registered."
        raise
    return student["id"], None


def find_student(identifier):
    cleaned = identifier.strip()
    return select_one("students", filters={"email": cleaned.lower()}) or select_one(
        "students", filters={"student_id": cleaned.upper()}
    )


def recent_failure_count(identifier, student_id):
    cutoff = (datetime.now() - timedelta(minutes=LOCK_MINUTES)).strftime("%Y-%m-%d %H:%M:%S")
    matching = []
    for status in ("failed", "success"):
        rows, _total = select_rows(
            "login_records",
            columns="student_id,attempted_identifier,created_at,status",
            filters={"status": status, "created_at": ("gte", cutoff)},
        )
        matching.extend(
            row
            for row in rows
            if row["attempted_identifier"].casefold() == identifier.casefold()
            or (student_id is not None and row["student_id"] == student_id)
        )
    last_success = max(
        (row["created_at"] for row in matching if row["status"] == "success"),
        default="",
    )
    return sum(
        1
        for row in matching
        if row["status"] == "failed" and row["created_at"] > last_success
    )


def authenticate_student(identifier, password, ip_address, user_agent):
    student = find_student(identifier)
    typed = identifier.strip()
    student_id = None if student is None else student["id"]
    if recent_failure_count(typed, student_id) >= LOCK_LIMIT:
        record_login(student, typed, "failed", ip_address, user_agent)
        return None, "locked"
    if student is None:
        record_login(None, typed, "failed", ip_address, user_agent)
        return None, "invalid"
    if not student["is_active"]:
        record_login(student, typed, "failed", ip_address, user_agent)
        return None, "inactive"
    if not check_password_hash(student["password_hash"], password):
        record_login(student, typed, "failed", ip_address, user_agent)
        return None, "invalid"
    record_login(student, typed, "success", ip_address, user_agent)
    return student, "ok"


def find_admin(email):
    return select_one("admins", filters={"email": email.strip().lower()})


def authenticate_admin(email, password):
    admin = find_admin(email)
    if admin is None or not check_password_hash(admin["password_hash"], password):
        return None
    return admin
