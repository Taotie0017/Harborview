from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from auth_service import authenticate_student, record_login, register_student
from database import list_events, select_one
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
                record_login(student, identifier.strip(), "success", client_ip(), client_agent())
                start_student_session(student)
                flash(f"Welcome back, {student['full_name']}.", "success")
                return redirect(url_for("student.dashboard"))
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
            student_id, message = register_student(values, password)
            if message:
                errors["form"] = message
            else:
                student = select_one("students", filters={"id": student_id})
                start_student_session(student)
                flash(f"Account created. Welcome, {student['full_name']}.", "success")
                return redirect(url_for("student.dashboard"))

    return render_template("signup.html", errors=errors, values=values)


@public_bp.post("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("public.welcome"))
