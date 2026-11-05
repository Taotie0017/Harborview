import hashlib
import hmac
import secrets
import time
from datetime import datetime

from flask import current_app

from database import delete_rows, insert_row, now, select_rows, update_rows
from email_service import send_email

CODE_LIFETIME_SECONDS = 600
RESEND_COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5


def _code_hash(student_id, purpose, code):
    return hmac.new(
        current_app.config["SECRET_KEY"].encode("utf-8"),
        f"harborview:{student_id}:{purpose}:{code}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def create_challenge(student, purpose):
    if purpose not in ("signup", "login"):
        raise ValueError("Invalid email verification purpose.")
    rows, _ = select_rows(
        "email_challenges",
        columns="id,created_at",
        filters={"student_id": student["id"], "purpose": purpose},
        order_by=(("created_at", True),),
        limit=1,
    )
    if rows:
        last_sent = datetime.strptime(rows[0]["created_at"], "%Y-%m-%d %H:%M:%S").timestamp()
        if time.time() - last_sent < RESEND_COOLDOWN_SECONDS:
            raise RuntimeError("Wait one minute before requesting another code.")

    code = f"{secrets.randbelow(1_000_000):06d}"
    delete_rows("email_challenges", {"student_id": student["id"], "purpose": purpose})
    challenge = insert_row(
        "email_challenges",
        {
            "student_id": student["id"],
            "purpose": purpose,
            "code_hash": _code_hash(student["id"], purpose, code),
            "expires_at": int(time.time()) + CODE_LIFETIME_SECONDS,
            "attempts": 0,
            "created_at": now(),
        },
    )
    try:
        send_email(student["email"], student["full_name"], code, purpose)
    except Exception:
        delete_rows("email_challenges", {"id": challenge["id"]})
        raise


def verify_challenge(student_id, purpose, code):
    rows, _ = select_rows(
        "email_challenges",
        columns="id,code_hash,expires_at,attempts",
        filters={"student_id": student_id, "purpose": purpose},
        order_by=(("created_at", True),),
        limit=1,
    )
    if not rows:
        return "missing"
    challenge = rows[0]
    if challenge["expires_at"] < int(time.time()) or challenge["attempts"] >= MAX_ATTEMPTS:
        delete_rows("email_challenges", {"id": challenge["id"]})
        return "expired"
    expected = _code_hash(student_id, purpose, code)
    if not hmac.compare_digest(challenge["code_hash"], expected):
        attempts = challenge["attempts"] + 1
        if attempts >= MAX_ATTEMPTS:
            delete_rows("email_challenges", {"id": challenge["id"]})
            return "locked"
        update_rows("email_challenges", {"attempts": attempts}, {"id": challenge["id"]})
        return "invalid"
    delete_rows("email_challenges", {"id": challenge["id"]})
    return "ok"
