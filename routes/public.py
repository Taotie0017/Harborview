import time

from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from auth_service import authenticate_student, record_login, register_student
from database import list_events, select_one, update_rows
from email_challenges import create_challenge, verify_challenge
from validators import validate_login, validate_signup

public_bp = Blueprint("public", __name__)


def client_ip():
    return request.remote_addr or ""


def client_agent():
    return request.headers.get("User-Agent", "")


def start_student_session(student):
    session.clear()
    session["role"] = "student"
    session["user_id"] = student["id"]
    session["name"] = student["full_name"]
    session.permanent = True


@public_bp.route("/")
def welcome():
    return render_template("welcome.html", events=list_events())


@public_bp.route("/login", methods=["GET", "POST"])
def login():
    if session.get("role") == "student":
        return redirect(url_for("student.dashboard"))

    errors = {}
    identifier = ""
    if request.method == "POST":
        identifier, password, errors = validate_login(request.form)
        if not errors:
            student, status = authenticate_student(identifier, password, client_ip(), client_agent())
            if status == "ok":
                purpose = "login" if student["email_verified"] else "signup"
                try:
                    existing = select_one(
                        "email_challenges",
                        columns="expires_at",
                        filters={"student_id": student["id"], "purpose": purpose},
                    )
                    if not existing or existing["expires_at"] <= time.time():
                        create_challenge(student, purpose)
                except RuntimeError as error:
                    errors["form"] = str(error)
                else:
                    session["pending_email_student_id"] = student["id"]
                    session["pending_email_purpose"] = purpose
                    session["pending_login_identifier"] = identifier.strip()
                    session["pending_login"] = True
                    return redirect(url_for("public.verify_email"))
            if status == "inactive":
                errors["form"] = "This account is deactivated. Contact the event office."
            elif status == "locked":
                errors["form"] = "Too many failed tries. Wait a few minutes and try again."
            else:
                errors["form"] = "The student ID or password is not right."

    return render_template("login.html", errors=errors, identifier=identifier)


@public_bp.route("/signup", methods=["GET", "POST"])
def signup():
    if session.get("role") == "student":
        return redirect(url_for("student.dashboard"))

    errors = {}
    values = {}
    if request.method == "POST":
        values, password, errors = validate_signup(request.form)
        if not errors:
            _, message = register_student(values, password)
            if message:
                errors["form"] = message
            else:
                student = select_one("students", filters={"email": values["email"]})
                session["pending_email_student_id"] = student["id"]
                session["pending_email_purpose"] = "signup"
                session["pending_login"] = False
                try:
                    create_challenge(student, "signup")
                except RuntimeError as error:
                    errors["form"] = (
                        f"Your account was created, but email verification could not be started: {error}"
                    )
                else:
                    flash("Check your email for a verification code.", "success")
                    return redirect(url_for("public.verify_email"))

    return render_template("signup.html", errors=errors, values=values)


@public_bp.route("/verify-email", methods=["GET", "POST"])
def verify_email():
    student_id = session.get("pending_email_student_id")
    purpose = session.get("pending_email_purpose")
    student = select_one("students", filters={"id": student_id}) if student_id else None
    if student is None or purpose not in ("signup", "login"):
        session.pop("pending_email_student_id", None)
        session.pop("pending_email_purpose", None)
        flash("Request a new verification code by signing in again.", "error")
        return redirect(url_for("public.login"))

    errors = {}
    if request.method == "POST":
        code = request.form.get("code", "").strip()
        if not code.isdigit() or len(code) != 6:
            errors["code"] = "Enter the 6-digit code from your email."
        else:
            status = verify_challenge(student_id, purpose, code)
            if status == "ok":
                if purpose == "signup":
                    update_rows("students", {"email_verified": 1}, {"id": student_id})
                    if session.pop("pending_login", False):
                        purpose = "login"
                        session["pending_email_purpose"] = purpose
                        try:
                            create_challenge(student, "login")
                        except RuntimeError as error:
                            errors["form"] = str(error)
                        else:
                            flash("Email verified. Enter the sign-in code we just sent.", "success")
                            return redirect(url_for("public.verify_email"))
                    else:
                        session.pop("pending_email_student_id", None)
                        session.pop("pending_email_purpose", None)
                        flash("Email verified. You can now log in.", "success")
                        return redirect(url_for("public.login"))
                else:
                    record_login(
                        student,
                        session.pop("pending_login_identifier", student["email"]),
                        "success",
                        client_ip(),
                        client_agent(),
                    )
                    start_student_session(student)
                    flash(f"Welcome back, {student['full_name']}.", "success")
                    return redirect(url_for("student.dashboard"))
            elif status == "invalid":
                errors["code"] = "That code is not correct."
            elif status == "locked":
                errors["form"] = "Too many incorrect codes. Request a new code."
            else:
                errors["form"] = "That code expired. Request a new one."

    return render_template("verify_email.html", student=student, purpose=purpose, errors=errors)


@public_bp.post("/verify-email/resend")
def resend_verification_email():
    student_id = session.get("pending_email_student_id")
    purpose = session.get("pending_email_purpose")
    student = select_one("students", filters={"id": student_id}) if student_id else None
    if student is None or purpose not in ("signup", "login"):
        flash("Sign in again to request a verification code.", "error")
        return redirect(url_for("public.login"))
    try:
        create_challenge(student, purpose)
    except RuntimeError as error:
        flash(str(error), "error")
    else:
        flash("A new verification code was sent.", "success")
    return redirect(url_for("public.verify_email"))


@public_bp.post("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("public.welcome"))
