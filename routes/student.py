from datetime import datetime

from flask import Blueprint, redirect, render_template, request, session, url_for

from database import list_events, paged_rows, select_one, select_rows
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
        events=list_events(),
        login_count=login_count,
        last_login=last_login_rows[0]["created_at"] if last_login_rows else "No successful login yet",
        greeting=greeting(),
    )


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
