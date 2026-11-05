from datetime import datetime

from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from database import (
    cancel_event_registration,
    paged_rows,
    register_for_event,
    select_one,
    select_rows,
    student_events,
)
from security import student_required

student_bp = Blueprint("student", __name__)


def greeting():
    hour = datetime.now().hour
    if hour < 12:
        return "Good morning"
    if hour < 17:
        return "Good afternoon"
    return "Good evening"


def load_student():
    student = select_one("students", filters={"id": session.get("user_id")})
    if student is None:
        session.clear()
    return student


@student_bp.route("/dashboard")
@student_required
def dashboard():
    student = load_student()
    if student is None:
        return redirect(url_for("public.login"))

    _, login_count = select_rows(
        "login_records",
        columns="id",
        filters={"student_id": student["id"], "status": "success"},
        limit=1,
    )
    last_login_rows, _ = select_rows(
        "login_records",
        columns="created_at",
        filters={"student_id": student["id"], "status": "success"},
        order_by=(("created_at", True),),
        limit=1,
    )
    return render_template(
        "student/dashboard.html",
        student=student,
        events=student_events(student["id"]),
        login_count=login_count,
        last_login=last_login_rows[0]["created_at"] if last_login_rows else "No successful login yet",
        greeting=greeting(),
    )


@student_bp.post("/events/<int:event_id>/register")
@student_required
def register_event(event_id):
    student = load_student()
    if student is None:
        return redirect(url_for("public.login"))
    status = register_for_event(event_id, student["id"])
    if status == "not_found":
        flash("That event is no longer available.", "error")
    elif status == "registered":
        flash("You are registered for the event.", "success")
    elif status == "waitlisted":
        flash("The event is full. You have been added to the waitlist.", "info")
    return redirect(url_for("student.dashboard"))


@student_bp.post("/events/<int:event_id>/cancel")
@student_required
def cancel_event(event_id):
    student = load_student()
    if student is None:
        return redirect(url_for("public.login"))
    status = cancel_event_registration(event_id, student["id"])
    if status == "not_found":
        flash("That event is no longer available.", "error")
    elif status == "cancelled":
        flash("Your event registration was cancelled.", "success")
    return redirect(url_for("student.dashboard"))


@student_bp.route("/my-logins")
@student_required
def records():
    student = load_student()
    if student is None:
        return redirect(url_for("public.login"))

    rows, page, pages, total = paged_rows(
        "login_records",
        request.args.get("page", 1),
        columns="created_at,status,ip_address",
        filters={"student_id": student["id"]},
        order_by=(("created_at", True),),
    )
    return render_template(
        "student/records.html",
        student=student,
        records=rows,
        page=page,
        pages=pages,
        total=total,
    )
