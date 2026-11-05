import sqlite3
from datetime import datetime
from pathlib import Path
import re

from flask import current_app, g
from supabase import create_client

BASE_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = BASE_DIR / "schema.sql"

SEED_EVENTS = [
    (
        "Welcome Week Club Fair",
        "Clubs, food stalls, and the event office booth.",
        "Main Quad",
        "2026-11-12 10:00",
    ),
    (
        "Career Night with Alumni",
        "Bring a student ID if you want a name tag.",
        "Student Center Hall B",
        "2026-11-18 18:00",
    ),
    (
        "Winter Concert on the Lawn",
        "Blankets welcome. Moves to the auditorium if it rains.",
        "East Lawn",
        "2026-12-04 19:00",
    ),
]


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def like(term):
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def database_path():
    return current_app.config["DATABASE_PATH"]


def connect(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db(path=None):
    backend = current_app.config.get("DATABASE_BACKEND", "sqlite")
    if backend not in ("sqlite", "supabase"):
        raise ValueError(f"Unsupported DATABASE_BACKEND: {backend}")
    if backend == "supabase":
        get_supabase().table("events").select("id").limit(1).execute()
        return

    if path is None:
        path = database_path()
    connection = connect(path)
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    student_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(students)")
    }
    if "email_verified" not in student_columns:
        connection.execute(
            "ALTER TABLE students ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0"
        )
    event_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(events)")
    }
    if "capacity" not in event_columns:
        connection.execute(
            "ALTER TABLE events ADD COLUMN capacity INTEGER NOT NULL DEFAULT 50"
        )
    connection.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_event_participations_event_status
            ON event_participations(event_id, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_email_challenges_student_purpose
            ON email_challenges(student_id, purpose, created_at DESC);
        """
    )
    connection.execute("PRAGMA foreign_keys = ON")
    count = connection.execute("SELECT COUNT(*) AS n FROM events").fetchone()["n"]
    if count == 0:
        connection.executemany(
            """
            INSERT INTO events (title, description, location, event_date, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [(*event, now()) for event in SEED_EVENTS],
        )
    connection.commit()
    connection.close()


def get_db():
    if current_app.config.get("DATABASE_BACKEND", "sqlite") == "supabase":
        raise RuntimeError("Raw SQL connections are available only with the SQLite backend.")
    if "db" not in g:
        g.db = connect(database_path())
    return g.db


def get_supabase():
    if current_app.config.get("DATABASE_BACKEND", "sqlite") != "supabase":
        raise RuntimeError("The Supabase client is available only with the Supabase backend.")
    client = current_app.extensions.get("supabase")
    if client is None:
        url = current_app.config.get("SUPABASE_URL")
        key = current_app.config.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use the Supabase backend."
            )
        client = create_client(url, key)
        current_app.extensions["supabase"] = client
    return client


_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _identifier(value):
    if not _IDENTIFIER_RE.fullmatch(value):
        raise ValueError(f"Invalid database identifier: {value!r}")
    return value


def _filters(query, filters):
    for column, condition in (filters or {}).items():
        _identifier(column)
        operator, value = condition if isinstance(condition, tuple) else ("eq", condition)
        if operator == "eq":
            query = query.eq(column, value)
        elif operator == "gte":
            query = query.gte(column, value)
        elif operator == "lte":
            query = query.lte(column, value)
        elif operator == "between":
            query = query.gte(column, value[0]).lte(column, value[1])
        elif operator == "in":
            query = query.in_(column, value)
        else:
            raise ValueError(f"Unsupported database filter operator: {operator}")
    return query


def select_rows(
    table,
    *,
    columns="*",
    filters=None,
    search=None,
    search_columns=(),
    or_filters=(),
    order_by=(),
    limit=None,
    offset=0,
):
    _identifier(table)
    or_filter_columns = [column for column, _operator, _value in or_filters]
    for column in (*search_columns, *or_filter_columns):
        _identifier(column)
    for column, _descending in order_by:
        _identifier(column)

    if current_app.config.get("DATABASE_BACKEND", "sqlite") == "supabase":
        query = get_supabase().table(table).select(columns, count="exact")
        query = _filters(query, filters)
        or_expressions = []
        if search and search_columns:
            pattern = like(search).replace("\\", "\\\\").replace('"', '\\"')
            or_expressions.extend(
                f'{column}.ilike."{pattern}"' for column in search_columns
            )
        for column, operator, value in or_filters:
            if operator == "in":
                items = ",".join(str(item) for item in value)
                or_expressions.append(f"{column}.in.({items})")
            elif operator == "eq":
                or_expressions.append(f"{column}.eq.{value}")
            else:
                raise ValueError(f"Unsupported OR filter operator: {operator}")
        if or_expressions:
            query = query.or_(",".join(or_expressions))
        for column, descending in order_by:
            query = query.order(column, desc=descending)
        if limit is not None:
            response = query.range(offset, offset + limit - 1).execute()
            return response.data or [], response.count or 0

        rows = []
        total = None
        next_offset = offset
        while total is None or next_offset < total:
            response = query.range(next_offset, next_offset + 999).execute()
            batch = response.data or []
            rows.extend(batch)
            total = response.count if response.count is not None else len(batch)
            if not batch:
                break
            next_offset += len(batch)
        return rows, total or 0

    where = []
    params = []
    for column, condition in (filters or {}).items():
        _identifier(column)
        operator, value = condition if isinstance(condition, tuple) else ("eq", condition)
        if operator == "eq":
            where.append(f"{column} = ?")
            params.append(value)
        elif operator in ("gte", "lte"):
            where.append(f"{column} {'>=' if operator == 'gte' else '<='} ?")
            params.append(value)
        elif operator == "between":
            where.append(f"({column} >= ? AND {column} <= ?)")
            params.extend(value)
        elif operator == "in":
            values = tuple(value)
            if not values:
                where.append("1 = 0")
            else:
                where.append(f"{column} IN ({','.join('?' for _ in values)})")
                params.extend(values)
        else:
            raise ValueError(f"Unsupported database filter operator: {operator}")
    or_clauses = []
    or_params = []
    if search and search_columns:
        pattern = like(search)
        for column in search_columns:
            or_clauses.append(f"{column} LIKE ? ESCAPE '\\'")
            or_params.append(pattern)
    for column, operator, value in or_filters:
        if operator == "in":
            values = tuple(value)
            if values:
                or_clauses.append(f"{column} IN ({','.join('?' for _ in values)})")
                or_params.extend(values)
        elif operator == "eq":
            or_clauses.append(f"{column} = ?")
            or_params.append(value)
        else:
            raise ValueError(f"Unsupported OR filter operator: {operator}")
    if or_clauses:
        where.append(f"({' OR '.join(or_clauses)})")
        params.extend(or_params)
    where_sql = f" WHERE {' AND '.join(where)}" if where else ""
    order_sql = ""
    if order_by:
        order_sql = " ORDER BY " + ", ".join(
            f"{column} {'DESC' if descending else 'ASC'}" for column, descending in order_by
        )
    connection = get_db()
    total = connection.execute(
        f"SELECT COUNT(*) AS n FROM {table}{where_sql}", params
    ).fetchone()["n"]
    sql = f"SELECT {columns} FROM {table}{where_sql}{order_sql}"
    query_params = params
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        query_params = (*params, limit, offset)
    elif offset:
        sql += " LIMIT -1 OFFSET ?"
        query_params = (*params, offset)
    rows = connection.execute(sql, query_params).fetchall()
    return [dict(row) for row in rows], total


def select_one(table, *, columns="*", filters=None):
    rows, _total = select_rows(table, columns=columns, filters=filters, limit=1)
    return rows[0] if rows else None


def count_rows(table, filters=None):
    _rows, total = select_rows(table, columns="id", filters=filters, limit=1)
    return total


def paged_rows(
    table,
    page,
    *,
    columns="*",
    filters=None,
    search=None,
    search_columns=(),
    or_filters=(),
    order_by=(),
    per_page=10,
):
    page, per_page, offset = page_window(page, per_page)
    rows, total = select_rows(
        table,
        columns=columns,
        filters=filters,
        search=search,
        search_columns=search_columns,
        or_filters=or_filters,
        order_by=order_by,
        limit=per_page,
        offset=offset,
    )
    pages = max(1, (total + per_page - 1) // per_page)
    page = min(page, pages)
    if offset != (page - 1) * per_page:
        rows, _total = select_rows(
            table,
            columns=columns,
            filters=filters,
            search=search,
            search_columns=search_columns,
            or_filters=or_filters,
            order_by=order_by,
            limit=per_page,
            offset=(page - 1) * per_page,
        )
    return rows, page, pages, total


def insert_row(table, values):
    _identifier(table)
    if current_app.config.get("DATABASE_BACKEND", "sqlite") == "supabase":
        response = get_supabase().table(table).insert(values).select("*").execute()
        return (response.data or [None])[0]
    columns = tuple(values)
    for column in columns:
        _identifier(column)
    placeholders = ", ".join("?" for _ in columns)
    cursor = get_db().execute(
        f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
        tuple(values[column] for column in columns),
    )
    get_db().commit()
    return select_one(table, filters={"id": cursor.lastrowid})


def update_rows(table, values, filters):
    _identifier(table)
    if not filters:
        raise ValueError("Updates require at least one filter.")
    if current_app.config.get("DATABASE_BACKEND", "sqlite") == "supabase":
        query = _filters(get_supabase().table(table).update(values), filters)
        return query.execute().data or []
    for column in values:
        _identifier(column)
    assignments = ", ".join(f"{column} = ?" for column in values)
    where, params = _sqlite_where(filters)
    cursor = get_db().execute(
        f"UPDATE {table} SET {assignments} WHERE {where}",
        (*values.values(), *params),
    )
    get_db().commit()
    return cursor.rowcount


def delete_rows(table, filters):
    _identifier(table)
    if not filters:
        raise ValueError("Deletes require at least one filter.")
    if current_app.config.get("DATABASE_BACKEND", "sqlite") == "supabase":
        query = _filters(get_supabase().table(table).delete(), filters)
        return query.execute().data or []
    where, params = _sqlite_where(filters)
    cursor = get_db().execute(f"DELETE FROM {table} WHERE {where}", params)
    get_db().commit()
    return cursor.rowcount


def _sqlite_where(filters):
    clauses = []
    params = []
    for column, condition in filters.items():
        _identifier(column)
        operator, value = condition if isinstance(condition, tuple) else ("eq", condition)
        if operator not in ("eq", "gte", "lte"):
            raise ValueError(f"Unsupported SQLite filter operator: {operator}")
        clauses.append(f"{column} {'=' if operator == 'eq' else '>=' if operator == 'gte' else '<='} ?")
        params.append(value)
    return " AND ".join(clauses), params


def close_db(_error=None):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute(sql, params=()):
    connection = get_db()
    cursor = connection.execute(sql, params)
    connection.commit()
    return cursor.lastrowid


def add_audit(admin_id, action, target_table, target_id, details):
    insert_row(
        "admin_audit_logs",
        {
            "admin_id": admin_id,
            "action": action,
            "target_table": target_table,
            "target_id": target_id,
            "details": details,
            "created_at": now(),
        },
    )


def list_events():
    rows, _total = select_rows("events", order_by=(("event_date", False),))
    return rows


def student_events(student_id):
    events = list_events()
    if not events:
        return events

    event_ids = [event["id"] for event in events]
    if current_app.config.get("DATABASE_BACKEND", "sqlite") == "supabase":
        participations = (
            get_supabase()
            .table("event_participations")
            .select("event_id,student_id,status")
            .in_("event_id", event_ids)
            .execute()
            .data
            or []
        )
    else:
        placeholders = ",".join("?" for _ in event_ids)
        participations = [
            dict(row)
            for row in query_all(
                f"SELECT event_id, student_id, status FROM event_participations WHERE event_id IN ({placeholders})",
                event_ids,
            )
        ]

    statuses = {
        participation["event_id"]: participation["status"]
        for participation in participations
        if participation["student_id"] == student_id
    }

    for event in events:
        event["registered_count"] = sum(
            1
            for participation in participations
            if participation["event_id"] == event["id"]
            and participation["status"] == "registered"
        )
        event["my_status"] = statuses.get(event["id"], "")
    return events


def register_for_event(event_id, student_id):
    if current_app.config.get("DATABASE_BACKEND", "sqlite") == "supabase":
        response = get_supabase().rpc(
            "join_event", {"p_event_id": event_id, "p_student_id": student_id}
        ).execute()
        return response.data

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    try:
        event = connection.execute(
            "SELECT capacity FROM events WHERE id = ?", (event_id,)
        ).fetchone()
        if event is None:
            connection.rollback()
            return "not_found"
        existing = connection.execute(
            "SELECT status FROM event_participations WHERE event_id = ? AND student_id = ?",
            (event_id, student_id),
        ).fetchone()
        if existing and existing["status"] in ("registered", "waitlisted"):
            connection.commit()
            return existing["status"]
        count = connection.execute(
            "SELECT COUNT(*) AS n FROM event_participations WHERE event_id = ? AND status = 'registered'",
            (event_id,),
        ).fetchone()["n"]
        status = "registered" if count < event["capacity"] else "waitlisted"
        connection.execute(
            """
            INSERT INTO event_participations (event_id, student_id, status, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(event_id, student_id)
            DO UPDATE SET status = excluded.status, created_at = excluded.created_at
            """,
            (event_id, student_id, status, now()),
        )
        connection.commit()
        return status
    except Exception:
        connection.rollback()
        raise


def cancel_event_registration(event_id, student_id):
    if current_app.config.get("DATABASE_BACKEND", "sqlite") == "supabase":
        response = get_supabase().rpc(
            "cancel_event_registration",
            {"p_event_id": event_id, "p_student_id": student_id},
        ).execute()
        return response.data

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    try:
        event = connection.execute(
            "SELECT capacity FROM events WHERE id = ?", (event_id,)
        ).fetchone()
        existing = connection.execute(
            "SELECT status FROM event_participations WHERE event_id = ? AND student_id = ?",
            (event_id, student_id),
        ).fetchone()
        if event is None:
            connection.rollback()
            return "not_found"
        if existing is None or existing["status"] == "cancelled":
            connection.rollback()
            return "not_registered"
        connection.execute(
            "UPDATE event_participations SET status = 'cancelled' WHERE event_id = ? AND student_id = ?",
            (event_id, student_id),
        )
        if existing["status"] == "registered":
            count = connection.execute(
                "SELECT COUNT(*) AS n FROM event_participations WHERE event_id = ? AND status = 'registered'",
                (event_id,),
            ).fetchone()["n"]
            if count < event["capacity"]:
                next_student = connection.execute(
                    """
                    SELECT student_id FROM event_participations
                    WHERE event_id = ? AND status = 'waitlisted'
                    ORDER BY created_at, id LIMIT 1
                    """,
                    (event_id,),
                ).fetchone()
                if next_student:
                    connection.execute(
                        """
                        UPDATE event_participations SET status = 'registered'
                        WHERE event_id = ? AND student_id = ?
                        """,
                        (event_id, next_student["student_id"]),
                    )
        connection.commit()
        return "cancelled"
    except Exception:
        connection.rollback()
        raise


def page_window(page, per_page=10):
    try:
        page = int(page)
    except (TypeError, ValueError):
        page = 1
    page = max(page, 1)
    return page, per_page, (page - 1) * per_page


def paged(select_sql, count_sql, params, page, per_page=10):
    page, per_page, offset = page_window(page, per_page)
    total = query_one(count_sql, params)["n"]
    pages = max(1, (total + per_page - 1) // per_page)
    page = min(page, pages)
    offset = (page - 1) * per_page
    rows = query_all(f"{select_sql} LIMIT ? OFFSET ?", (*params, per_page, offset))
    return rows, page, pages, total
