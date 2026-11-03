"""Create the first event-office administrator.

Usage:
    python create_admin.py

The script asks for a name, email, and password. If ADMIN_NAME, ADMIN_EMAIL,
and ADMIN_PASSWORD are set in the environment or in .env, it uses those
instead of asking.
"""

import getpass
import os
import sys

from werkzeug.security import generate_password_hash

from app import create_app
from database import insert_row, now, select_one
from validators import EMAIL_RE, NAME_RE, password_error


def prompt_account():
    name = os.environ.get("ADMIN_NAME", "").strip()
    email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD", "")

    if not name:
        name = input("Full name: ").strip()
    if not email:
        email = input("Email: ").strip().lower()
    if not password:
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Those passwords do not match.")
            return None

    if not NAME_RE.match(name):
        print("Use a name made of letters, spaces, hyphens, or apostrophes.")
        return None
    if not EMAIL_RE.match(email) or len(email) > 120:
        print("Enter a valid email address.")
        return None
    problem = password_error(password)
    if problem:
        print(problem)
        return None
    return name, email, password


def main():
    app = create_app()
    account = prompt_account()
    if account is None:
        return 1

    name, email, password = account
    with app.app_context():
        existing = select_one("admins", columns="id", filters={"email": email})
        if existing is not None:
            print("An administrator with that email already exists.")
            return 1

        insert_row(
            "admins",
            {
                "full_name": name,
                "email": email,
                "password_hash": generate_password_hash(password),
                "created_at": now(),
            },
        )
    print(f"Administrator account created for {email}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
