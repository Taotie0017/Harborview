import os

from flask import Flask, abort, flash, redirect, render_template, request, session, url_for
from flask_wtf.csrf import CSRFError, CSRFProtect

from config import Config
from database import close_db, init_db
from routes.admin import admin_bp
from routes.public import public_bp
from routes.student import student_bp

csrf = CSRFProtect()


def create_app(test_config=None):
    app = Flask(
        __name__,
        static_folder=None if os.environ.get("VERCEL") else "public/static",
    )
    if app.static_folder is None:
        app.add_url_rule("/static/<path:filename>", endpoint="static", build_only=True)
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)
    if not app.config["SECRET_KEY"] or app.config["SECRET_KEY"] in {
        "dev-only-change-me",
        "replace-this-with-a-long-random-string",
    }:
        raise RuntimeError("Set SECRET_KEY to a private, random value before starting the app.")

    csrf.init_app(app)
    app.teardown_appcontext(close_db)
    app.register_blueprint(public_bp)
    app.register_blueprint(student_bp)
    app.register_blueprint(admin_bp)

    @app.context_processor
    def inject_session():
        return {
            "current_role": session.get("role"),
            "current_name": session.get("name"),
        }

    @app.before_request
    def guard_areas():
        path = request.path
        role = session.get("role")
        admin_area = path == "/admin" or path.startswith("/admin/")
        student_area = path in ("/dashboard", "/my-logins") or path.startswith("/dashboard/") or path.startswith("/my-logins/")
        if admin_area and path != "/admin/login":
            if role == "student":
                abort(403, "Student accounts cannot open the event office.")
            if role != "admin":
                return redirect(url_for("admin.login"))
        if student_area:
            if role == "admin":
                abort(403, "The office account uses the admin dashboard.")
            if role != "student":
                return redirect(url_for("public.login"))
        return None

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.errorhandler(403)
    def forbidden(error):
        return render_template("errors/403.html", description=error.description), 403

    @app.errorhandler(404)
    def missing(_error):
        return render_template("errors/404.html"), 404

    @app.errorhandler(CSRFError)
    def csrf_error(_error):
        flash_target = url_for("public.welcome")
        referrer = request.referrer or ""
        if referrer.startswith(request.host_url):
            flash_target = referrer
        flash("That form expired. Refresh the page and try again.", "error")
        return redirect(flash_target)

    with app.app_context():
        init_db()

    return app


def main():
    application = create_app()
    port = int(os.environ.get("PORT", "5000"))
    application.run(host="127.0.0.1", port=port, debug=application.config["DEBUG"])


if os.environ.get("VERCEL"):
    app = create_app()


if __name__ == "__main__":
    main()
