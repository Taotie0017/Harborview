from datetime import datetime

from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from werkzeug.security import generate_password_hash

from auth_service import authenticate_admin
from constants import DEPARTMENTS, YEAR_LEVELS
from database import (
    add_audit,
    count_rows,
    delete_rows,
    insert_row,
    now,
    paged_rows,
    select_one,
    select_rows,
    update_rows,
)
from security import admin_required
from validators import validate_event, validate_record, validate_student_edit

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


def start_admin_session(admin):
    session.clear()
    session["role"] = "admin"
    session["user_id"] = admin["id"]
    session["name"] = admin["full_name"]
    session.permanent = True


@admin_bp.route("/login", methods=["GET", "POST"])
def login():
    if session.get("role") == "admin":
        return redirect(url_for("admin.dashboard"))

    errors = {}
    email = ""
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if not email or not password:
            errors["form"] = "Enter the admin email and password."
        else:
            admin = authenticate_admin(email, password)
            if admin is None:
                errors["form"] = "The email or password is not right."
            else:
                start_admin_session(admin)
                add_audit(admin["id"], "login", "admins", admin["id"], "Signed in to the admin area.")
                flash(f"Signed in as {admin['full_name']}.", "success")
                return redirect(url_for("admin.dashboard"))

    return render_template("admin/login.html", errors=errors, email=email)


def load_admin():
    admin = select_one("admins", filters={"id": session.get("user_id")})
    if admin is None:
        session.clear()
    return admin


@admin_bp.route("/")
@admin_required
def dashboard():
    admin = load_admin()
    if admin is None:
        return redirect(url_for("admin.login"))

    today = datetime.now().strftime("%Y-%m-%d")
    stats = {
        "students": count_rows("students"),
        "active": count_rows("students", {"is_active": 1}),
        "success": count_rows("login_records", {"status": "success"}),
        "failed": count_rows("login_records", {"status": "failed"}),
        "today": count_rows("login_records", {"created_at": ("gte", today)}),
    }
    recent_students, _total = select_rows(
        "students",
        columns="full_name,student_id,department,created_at",
        order_by=(("created_at", True),),
        limit=5,
    )
    recent_records, _total = select_rows(
        "login_records",
        columns="created_at,status,attempted_identifier,student_name",
        order_by=(("created_at", True),),
        limit=8,
    )
    for record in recent_records:
        record["student_name"] = record["student_name"] or "Unknown account"
    return render_template(
        "admin/dashboard.html",
        admin=admin,
        stats=stats,
        recent_students=recent_students,
        recent_records=recent_records,
    )


def require_admin():
    admin = load_admin()
    if admin is None:
        return None
    return admin


def student_filters(filters):
    conditions = {}
    if filters["department"] in DEPARTMENTS:
        conditions["department"] = filters["department"]
    if filters["year_level"] in YEAR_LEVELS:
        conditions["year_level"] = filters["year_level"]
    if filters["active"] in ("0", "1"):
        conditions["is_active"] = int(filters["active"])
    return conditions


@admin_bp.route("/students")
@admin_required
def students():
    if require_admin() is None:
        return redirect(url_for("admin.login"))
    filters = {
        "q": request.args.get("q", "").strip(),
        "department": request.args.get("department", "").strip(),
        "year_level": request.args.get("year_level", "").strip(),
        "active": request.args.get("active", "").strip(),
    }
    rows, page, pages, total = paged_rows(
        "students",
        request.args.get("page", 1),
        filters=student_filters(filters),
        search=filters["q"],
        search_columns=("full_name", "email", "student_id"),
        order_by=(("created_at", True),),
    )
    return render_template(
        "admin/students.html",
        students=rows,
        filters=filters,
        departments=DEPARTMENTS,
        year_levels=YEAR_LEVELS,
        page=page,
        pages=pages,
        total=total,
    )


@admin_bp.route("/students/<int:student_id>/edit", methods=["GET", "POST"])
@admin_required
def edit_student(student_id):
    admin = require_admin()
    if admin is None:
        return redirect(url_for("admin.login"))
    student = select_one("students", filters={"id": student_id})
    if student is None:
        flash("That student was not found.", "error")
        return redirect(url_for("admin.students"))

    if request.method == "POST":
        values, password, errors = validate_student_edit(request.form)
        if not errors:
            email_taken = select_rows(
                "students",
                columns="id",
                filters={"email": values["email"]},
                limit=2,
            )[0]
            id_taken = select_rows(
                "students",
                columns="id",
                filters={"student_id": values["student_id"]},
                limit=2,
            )[0]
            email_taken = any(row["id"] != student_id for row in email_taken)
            id_taken = any(row["id"] != student_id for row in id_taken)
            if email_taken:
                errors["email"] = "Another student already uses that email."
            elif id_taken:
                errors["student_id"] = "Another student already uses that ID."
            else:
                updates = {
                    "full_name": values["full_name"],
                    "student_id": values["student_id"],
                    "email": values["email"],
                    "department": values["department"],
                    "year_level": values["year_level"],
                    "is_active": values["is_active"],
                }
                if password:
                    updates["password_hash"] = generate_password_hash(password)
                update_rows("students", updates, {"id": student_id})
                add_audit(
                    admin["id"],
                    "update",
                    "students",
                    student_id,
                    f"Updated {values['full_name']} ({values['student_id']}).",
                )
                flash("Student account updated.", "success")
                return redirect(url_for("admin.students"))
    else:
        values = {
            "full_name": student["full_name"],
            "student_id": student["student_id"],
            "email": student["email"],
            "department": student["department"],
            "year_level": student["year_level"],
            "is_active": student["is_active"],
        }
        errors = {}

    return render_template(
        "admin/student_form.html",
        student=student,
        values=values,
        errors=errors,
        departments=DEPARTMENTS,
        year_levels=YEAR_LEVELS,
    )


@admin_bp.post("/students/<int:student_id>/delete")
@admin_required
def delete_student(student_id):
    admin = require_admin()
    if admin is None:
        return redirect(url_for("admin.login"))
    student = select_one("students", filters={"id": student_id})
    if student is None:
        flash("That student was not found.", "error")
        return redirect(url_for("admin.students"))
    delete_rows("students", {"id": student_id})
    add_audit(
        admin["id"],
        "delete",
        "students",
        student_id,
        f"Deleted {student['full_name']} ({student['student_id']}).",
    )
    flash("Student account deleted. Past login rows keep the name that was saved.", "success")
    return redirect(url_for("admin.students"))


def record_filters(filters):
    conditions = {}
    if filters["status"] in ("success", "failed"):
        conditions["status"] = filters["status"]
    if filters["date_from"] and filters["date_to"]:
        conditions["created_at"] = (
            "between",
            (filters["date_from"], filters["date_to"] + " 23:59:59"),
        )
    elif filters["date_from"]:
        conditions["created_at"] = ("gte", filters["date_from"])
    elif filters["date_to"]:
        conditions["created_at"] = ("lte", filters["date_to"] + " 23:59:59")
    return conditions


def add_record_display_fields(records):
    student_ids = sorted({record["student_id"] for record in records if record["student_id"] is not None})
    students = []
    if student_ids:
        students, _total = select_rows(
            "students",
            columns="id,full_name,student_id",
            filters={"id": ("in", student_ids)},
        )
    students_by_id = {student["id"]: student for student in students}
    for record in records:
        student = students_by_id.get(record["student_id"])
        record["display_name"] = (
            (student and student["full_name"])
            or record["student_name"]
            or "Unknown account"
        )
        record["display_code"] = (
            (student and student["student_id"]) or record["student_code"] or ""
        )
    return records


@admin_bp.route("/records")
@admin_required
def records():
    if require_admin() is None:
        return redirect(url_for("admin.login"))
    filters = {
        "q": request.args.get("q", "").strip(),
        "status": request.args.get("status", "").strip(),
        "date_from": request.args.get("date_from", "").strip(),
        "date_to": request.args.get("date_to", "").strip(),
    }
    conditions = record_filters(filters)
    or_filters = []
    if filters["q"]:
        matching_students, _student_count = select_rows(
            "students",
            columns="id",
            search=filters["q"],
            search_columns=("full_name", "email", "student_id"),
            limit=1000,
        )
        if matching_students:
            or_filters.append(("student_id", "in", [student["id"] for student in matching_students]))
    rows, page, pages, total = paged_rows(
        "login_records",
        request.args.get("page", 1),
        filters=conditions,
        search=filters["q"],
        search_columns=("attempted_identifier", "student_name", "student_code"),
        or_filters=or_filters,
        order_by=(("created_at", True),),
    )
    rows = add_record_display_fields(rows)
    return render_template(
        "admin/records.html",
        records=rows,
        filters=filters,
        page=page,
        pages=pages,
        total=total,
    )


@admin_bp.route("/records/<int:record_id>/edit", methods=["GET", "POST"])
@admin_required
def edit_record(record_id):
    admin = require_admin()
    if admin is None:
        return redirect(url_for("admin.login"))
    record = select_one("login_records", filters={"id": record_id})
    if record is None:
        flash("That login record was not found.", "error")
        return redirect(url_for("admin.records"))
    record = add_record_display_fields([record])[0]

    if request.method == "POST":
        values, errors = validate_record(request.form)
        if not errors:
            update_rows(
                "login_records",
                {
                    "status": values["status"],
                    "note": values["note"],
                    "edited_at": now(),
                    "edited_by": admin["id"],
                },
                {"id": record_id},
            )
            add_audit(
                admin["id"],
                "update",
                "login_records",
                record_id,
                f"Status {record['status']} -> {values['status']}.",
            )
            flash("Login record updated.", "success")
            return redirect(url_for("admin.records"))
    else:
        values = {"status": record["status"], "note": record["note"] or ""}
        errors = {}

    return render_template("admin/record_form.html", record=record, values=values, errors=errors)


@admin_bp.post("/records/<int:record_id>/delete")
@admin_required
def delete_record(record_id):
    admin = require_admin()
    if admin is None:
        return redirect(url_for("admin.login"))
    record = select_one(
        "login_records",
        columns="id,attempted_identifier,created_at",
        filters={"id": record_id},
    )
    if record is None:
        flash("That login record was not found.", "error")
        return redirect(url_for("admin.records"))
    delete_rows("login_records", {"id": record_id})
    add_audit(
        admin["id"],
        "delete",
        "login_records",
        record_id,
        f"Deleted attempt {record['attempted_identifier']} from {record['created_at']}.",
    )
    flash("Login record deleted.", "success")
    return redirect(url_for("admin.records"))


@admin_bp.route("/events")
@admin_required
def events():
    if require_admin() is None:
        return redirect(url_for("admin.login"))
    rows, _total = select_rows("events", order_by=(("event_date", False),))
    return render_template("admin/events.html", events=rows)


@admin_bp.route("/events/new", methods=["GET", "POST"])
@admin_required
def new_event():
    admin = require_admin()
    if admin is None:
        return redirect(url_for("admin.login"))
    errors = {}
    values = {}
    if request.method == "POST":
        values, errors = validate_event(request.form)
        if not errors:
            event = insert_row(
                "events",
                {
                    "title": values["title"],
                    "description": values["description"],
                    "location": values["location"],
                    "event_date": values["event_date"],
                    "created_by": admin["id"],
                    "created_at": now(),
                },
            )
            add_audit(admin["id"], "create", "events", event["id"], f"Posted {values['title']}.")
            flash("Event posted.", "success")
            return redirect(url_for("admin.events"))
    return render_template("admin/event_form.html", values=values, errors=errors, event=None)


@admin_bp.route("/events/<int:event_id>/edit", methods=["GET", "POST"])
@admin_required
def edit_event(event_id):
    admin = require_admin()
    if admin is None:
        return redirect(url_for("admin.login"))
    event = select_one("events", filters={"id": event_id})
    if event is None:
        flash("That event was not found.", "error")
        return redirect(url_for("admin.events"))
    if request.method == "POST":
        values, errors = validate_event(request.form)
        if not errors:
            update_rows(
                "events",
                {
                    "title": values["title"],
                    "description": values["description"],
                    "location": values["location"],
                    "event_date": values["event_date"],
                },
                {"id": event_id},
            )
            add_audit(admin["id"], "update", "events", event_id, f"Updated {values['title']}.")
            flash("Event updated.", "success")
            return redirect(url_for("admin.events"))
    else:
        values = {
            "title": event["title"],
            "description": event["description"],
            "location": event["location"],
            "event_date": event["event_date"].replace(" ", "T"),
        }
        errors = {}
    return render_template("admin/event_form.html", values=values, errors=errors, event=event)


@admin_bp.post("/events/<int:event_id>/delete")
@admin_required
def delete_event(event_id):
    admin = require_admin()
    if admin is None:
        return redirect(url_for("admin.login"))
    event = select_one("events", columns="id,title", filters={"id": event_id})
    if event is None:
        flash("That event was not found.", "error")
        return redirect(url_for("admin.events"))
    delete_rows("events", {"id": event_id})
    add_audit(admin["id"], "delete", "events", event_id, f"Removed {event['title']}.")
    flash("Event removed.", "success")
    return redirect(url_for("admin.events"))


@admin_bp.route("/audit")
@admin_required
def audit():
    if require_admin() is None:
        return redirect(url_for("admin.login"))
    rows, page, pages, total = paged_rows(
        "admin_audit_logs",
        request.args.get("page", 1),
        order_by=(("created_at", True),),
    )
    admin_ids = sorted({row["admin_id"] for row in rows})
    admins = []
    if admin_ids:
        admins, _total = select_rows(
            "admins",
            columns="id,full_name",
            filters={"id": ("in", admin_ids)},
        )
    admins_by_id = {admin["id"]: admin["full_name"] for admin in admins}
    for row in rows:
        row["admin_name"] = admins_by_id.get(row["admin_id"], "Unknown admin")
    return render_template(
        "admin/audit.html",
        logs=rows,
        page=page,
        pages=pages,
        total=total,
    )
