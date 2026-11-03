PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    student_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    department TEXT NOT NULL,
    year_level TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    student_code TEXT,
    student_name TEXT,
    attempted_identifier TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    ip_address TEXT,
    user_agent TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    edited_at TEXT,
    edited_by INTEGER,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    FOREIGN KEY (edited_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    target_table TEXT NOT NULL,
    target_id INTEGER,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES admins(id)
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT NOT NULL,
    event_date TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_login_records_student ON login_records(student_id);
CREATE INDEX IF NOT EXISTS idx_login_records_created ON login_records(created_at);
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);
