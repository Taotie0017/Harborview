from functools import wraps

from flask import abort, flash, redirect, session, url_for

from database import select_one


def student_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        role = session.get("role")
        if role == "admin":
            abort(403, "The office account uses the admin dashboard.")
        if role != "student" or not session.get("user_id"):
            flash("Please log in with a student account.", "error")
            return redirect(url_for("public.login"))
        student = select_one(
            "students", columns="is_active", filters={"id": session.get("user_id")}
        )
        if student is None or not student["is_active"]:
            session.clear()
            flash("This account is not active. Contact the event office.", "error")
            return redirect(url_for("public.login"))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        role = session.get("role")
        if role == "student":
            abort(403, "Student accounts cannot open the event office.")
        if role != "admin" or not session.get("user_id"):
            flash("Administrator login is required.", "error")
            return redirect(url_for("admin.login"))
        return view(*args, **kwargs)

    return wrapped
