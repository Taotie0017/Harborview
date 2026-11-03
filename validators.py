import re
from datetime import datetime

from constants import DEPARTMENTS, YEAR_LEVELS

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z .'-]{1,79}$")
STUDENT_ID_RE = re.compile(r"^[A-Za-z0-9-]{4,20}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def password_error(password):
    if len(password) < 8:
        return "Use at least 8 characters."
    if len(password) > 128:
        return "That password is too long."
    if not any(character.isalpha() for character in password) or not any(character.isdigit() for character in password):
        return "Include at least one letter and one number."
    return ""


def validate_signup(form):
    values = {
        "full_name": form.get("full_name", "").strip(),
        "student_id": form.get("student_id", "").strip().upper(),
        "email": form.get("email", "").strip().lower(),
        "department": form.get("department", "").strip(),
        "year_level": form.get("year_level", "").strip(),
    }
    password = form.get("password", "")
    confirm = form.get("confirm_password", "")
    errors = {}

    if not NAME_RE.match(values["full_name"]):
        errors["full_name"] = "Enter your name using letters, spaces, hyphens, or apostrophes."
    if not STUDENT_ID_RE.match(values["student_id"]):
        errors["student_id"] = "Use 4 to 20 letters, numbers, or hyphens."
    if not EMAIL_RE.match(values["email"]) or len(values["email"]) > 120:
        errors["email"] = "Enter a valid email address."
    if values["department"] not in DEPARTMENTS:
        errors["department"] = "Choose a department from the list."
    if values["year_level"] not in YEAR_LEVELS:
        errors["year_level"] = "Choose a year level from the list."

    problem = password_error(password)
    if problem:
        errors["password"] = problem
    if password != confirm:
        errors["confirm_password"] = "Those passwords do not match."

    return values, password, errors


def validate_login(form):
    identifier = form.get("identifier", "").strip()
    password = form.get("password", "")
    errors = {}
    if not identifier or len(identifier) > 120:
        errors["identifier"] = "Enter your student ID or email."
    if not password or len(password) > 128:
        errors["password"] = "Enter your password."
    return identifier, password, errors


def validate_student_edit(form):
    raw_is_active = form.get("is_active", "")
    values = {
        "full_name": form.get("full_name", "").strip(),
        "student_id": form.get("student_id", "").strip().upper(),
        "email": form.get("email", "").strip().lower(),
        "department": form.get("department", "").strip(),
        "year_level": form.get("year_level", "").strip(),
        "is_active": int(raw_is_active) if raw_is_active in ("0", "1") else 0,
    }
    password = form.get("new_password", "")
    errors = {}
    if not NAME_RE.match(values["full_name"]):
        errors["full_name"] = "Enter a name using letters, spaces, hyphens, or apostrophes."
    if not STUDENT_ID_RE.match(values["student_id"]):
        errors["student_id"] = "Use 4 to 20 letters, numbers, or hyphens."
    if not EMAIL_RE.match(values["email"]) or len(values["email"]) > 120:
        errors["email"] = "Enter a valid email address."
    if values["department"] not in DEPARTMENTS:
        errors["department"] = "Choose a department from the list."
    if values["year_level"] not in YEAR_LEVELS:
        errors["year_level"] = "Choose a year level from the list."
    if raw_is_active not in ("0", "1"):
        errors["is_active"] = "Choose an account status."
    if password:
        problem = password_error(password)
        if problem:
            errors["new_password"] = problem
    return values, password, errors


def validate_record(form):
    values = {
        "status": form.get("status", "").strip(),
        "note": form.get("note", "").strip(),
    }
    errors = {}
    if values["status"] not in ("success", "failed"):
        errors["status"] = "Choose successful or failed."
    if len(values["note"]) > 500:
        errors["note"] = "Keep the note under 500 characters."
    return values, errors


def validate_event(form):
    raw_date = form.get("event_date", "").strip()
    values = {
        "title": form.get("title", "").strip(),
        "description": form.get("description", "").strip(),
        "location": form.get("location", "").strip(),
        "event_date": raw_date.replace("T", " "),
    }
    errors = {}
    if not 3 <= len(values["title"]) <= 120:
        errors["title"] = "Use a title between 3 and 120 characters."
    if not 5 <= len(values["description"]) <= 1000:
        errors["description"] = "Describe the event in 5 to 1000 characters."
    if not 2 <= len(values["location"]) <= 120:
        errors["location"] = "Enter a location."
    try:
        parsed_date = datetime.strptime(values["event_date"], "%Y-%m-%d %H:%M")
        if parsed_date.strftime("%Y-%m-%d %H:%M") != values["event_date"]:
            raise ValueError
    except ValueError:
        errors["event_date"] = "Choose a valid date and time."
    return values, errors
