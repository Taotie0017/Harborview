import { randomBytes, scryptSync, pbkdf2Sync, createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SESSION_COOKIE = "harborview_session";
const SESSION_TTL = 8 * 60 * 60;
const PAGE_SIZE = 20;
const DEPARTMENTS = [
  "Computer Science",
  "Engineering",
  "Business",
  "Arts and Design",
  "Education",
  "Nursing",
  "Science",
];
const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "Graduate"];
let supabase;

function db() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return supabase;
}

function secret() {
  const value = process.env.SECRET_KEY;
  if (!value) {
    throw new Error("SECRET_KEY is missing from the Vercel Function runtime.");
  }
  if (value.length < 32) {
    throw new Error("SECRET_KEY is available to the Function but has fewer than 32 characters.");
  }
  return value;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function makeSession(data = {}) {
  return {
    csrf: data.csrf || randomBytes(24).toString("base64url"),
    role: data.role || "",
    user_id: data.user_id || "",
    name: data.name || "",
    flash: data.flash || "",
    flash_type: data.flash_type || "info",
    expires: Math.floor(Date.now() / 1000) + SESSION_TTL,
  };
}

function signSession(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(request) {
  const cookie = (request.headers.get("cookie") || "")
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return makeSession();
  try {
    const [payload, signature] = cookie.slice(SESSION_COOKIE.length + 1).split(".");
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return makeSession();
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.expires < Date.now() / 1000) return makeSession();
    return makeSession(parsed);
  } catch {
    return makeSession();
  }
}

function response(body, session, request, status = 200, headers = {}) {
  const secure = new URL(request.url).protocol === "https:";
  const cookie = `${SESSION_COOKIE}=${signSession(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secure ? "; Secure" : ""}`;
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "Set-Cookie": cookie,
      ...headers,
    },
  });
}

function redirect(path, session, request, message = "", type = "info") {
  if (message) {
    session.flash = message;
    session.flash_type = type;
  }
  return response("", session, request, 303, { Location: path });
}

function takeFlash(session) {
  const flash = session.flash ? `<ul class="flashes"><li class="flash flash-${escapeHtml(session.flash_type)}" role="status"><span>${escapeHtml(session.flash)}</span></li></ul>` : "";
  session.flash = "";
  session.flash_type = "info";
  return flash;
}

function layout(title, body, session, request) {
  const admin = session.role === "admin";
  const student = session.role === "student";
  const nav = admin
    ? `<aside class="sidebar"><a class="side-brand" href="/admin/"><strong>Event office</strong></a><nav class="side-nav"><a class="side-link" href="/admin/">Overview</a><a class="side-link" href="/admin/students">Students</a><a class="side-link" href="/admin/records">Login records</a><a class="side-link" href="/admin/events">Events</a><a class="side-link" href="/admin/audit">Audit log</a></nav><form method="post" action="/logout">${csrfInput(session)}<button class="button button-ghost button-small">Log out</button></form></aside>`
    : `<header class="site-header"><a class="brand" href="/"><img src="/static/images/mark.svg" alt="" width="42" height="42"><span><strong>Harborview</strong><small>Student Events</small></span></a><nav class="site-nav"><a href="/">Home</a>${student ? `<a href="/dashboard">Dashboard</a><a href="/my-logins">My Logins</a><span>${escapeHtml(session.name)}</span><form class="inline-form" method="post" action="/logout">${csrfInput(session)}<button class="ghost">Log out</button></form>` : `<a href="/login">Login</a><a href="/signup">Sign Up</a><a href="/admin/login">Admin Login</a>`}</nav></header>`;
  const content = `${nav}${admin ? `<main class="admin-main" id="content">${takeFlash(session)}${body}</main>` : `<main id="content">${takeFlash(session)}${body}</main><footer class="site-footer"><p>Harborview University Student Event Office</p><p>A course project for student login and event notices. Not an official campus portal.</p></footer>`}`;
  return response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Harborview</title><link rel="icon" href="/static/images/mark.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/css/style.css"></head><body>${admin ? `<div class="admin-shell">${content}</div>` : content}<script src="/static/js/main.js"></script><script src="/static/js/forms.js"></script><script src="/static/js/admin.js"></script></body></html>`, session, request);
}

function csrfInput(session) {
  return `<input type="hidden" name="csrf_token" value="${escapeHtml(session.csrf)}">`;
}

function fieldError(errors, key) {
  return errors[key] ? `<p class="field-error">${escapeHtml(errors[key])}</p>` : "";
}

function formError(errors) {
  return errors.form ? `<p class="form-error">${escapeHtml(errors.form)}</p>` : "";
}

function input(label, name, value = "", options = {}, error = "") {
  const type = options.type || "text";
  const attrs = Object.entries(options)
    .filter(([key]) => key !== "type")
    .map(([key, val]) => `${key}="${escapeHtml(val)}"`)
    .join(" ");
  return `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs}>${error}`;
}

function pageHeading(eyebrow, title, description = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${title}</h1>${description ? `<p class="lede">${description}</p>` : ""}</div></div>`;
}

function table(headers, rows, empty) {
  return rows.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="empty">${empty}</p>`;
}

function pager(path, page, pages, total, label, query = {}) {
  const params = new URLSearchParams(query);
  const link = (number) => {
    params.set("page", number);
    return `${path}?${params.toString()}`;
  };
  return `<nav class="pager"><span>${total} ${label} · page ${page} of ${pages}</span><span class="button-row">${page > 1 ? `<a class="button button-ghost button-small" href="${link(page - 1)}">Previous</a>` : ""}${page < pages ? `<a class="button button-small" href="${link(page + 1)}">Next</a>` : ""}</span></nav>`;
}

function now() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:32768:8:1$${salt}$${hash.toString("hex")}`;
}

function verifyPassword(password, encoded) {
  const [method, salt, expectedHex] = String(encoded || "").split("$");
  if (!method || !salt || !expectedHex || !/^[a-f\d]+$/i.test(expectedHex) || expectedHex.length % 2) return false;
  const expected = Buffer.from(expectedHex, "hex");
  let actual;
  if (method.startsWith("scrypt:")) {
    const [, n, r, p] = method.split(":");
    if (![32768, 65536].includes(Number(n)) || Number(r) !== 8 || ![1, 2].includes(Number(p))) return false;
    actual = scryptSync(password, salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: Math.max(64 * 1024 * 1024, 128 * Number(n) * Number(r) + 1024 * 1024),
    });
  } else if (method.startsWith("pbkdf2:")) {
    const [, digest, iterations] = method.split(":");
    if (!["sha256", "sha512"].includes(digest) || Number(iterations) < 1 || Number(iterations) > 2_000_000) return false;
    actual = pbkdf2Sync(password, salt, Number(iterations), expected.length, digest);
  } else {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function passwordError(password) {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 128) return "That password is too long.";
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return "Include at least one letter and one number.";
  return "";
}

function validEmail(value) {
  return value.length <= 120 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function validName(value) {
  return /^[A-Za-z][A-Za-z .'-]{1,79}$/.test(value);
}

function pageNumber(value) {
  const n = Number.parseInt(value || "1", 10);
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

async function query(queryPromise) {
  const result = await queryPromise;
  if (result.error) throw new Error(result.error.message);
  return result;
}

async function one(tableName, filters) {
  let statement = db().from(tableName).select("*");
  for (const [key, value] of Object.entries(filters)) statement = statement.eq(key, value);
  const { data, error } = await statement.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function addAudit(adminId, action, tableName, targetId, details) {
  await query(db().from("admin_audit_logs").insert({
    admin_id: adminId, action, target_table: tableName, target_id: targetId,
    details, created_at: now(),
  }));
}

async function recordLogin(student, identifier, status, request) {
  await query(db().from("login_records").insert({
    student_id: student?.id ?? null,
    student_code: student?.student_id ?? null,
    student_name: student?.full_name ?? null,
    attempted_identifier: identifier.slice(0, 120),
    status,
    ip_address: (request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 80),
    user_agent: (request.headers.get("user-agent") || "").slice(0, 255),
    created_at: now(),
  }));
}

async function findStudent(identifier) {
  const email = await one("students", { email: identifier.trim().toLowerCase() });
  return email || one("students", { student_id: identifier.trim().toUpperCase() });
}

async function studentLogin(identifier, password, request) {
  const student = await findStudent(identifier);
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const recent = [];
  for (const status of ["failed", "success"]) {
    const { data } = await query(db().from("login_records").select("student_id,attempted_identifier,created_at,status")
      .eq("status", status).gte("created_at", since).order("created_at", { ascending: false }).limit(500));
    recent.push(...data);
  }
  const matching = recent.filter((row) =>
    row.attempted_identifier.toLowerCase() === identifier.trim().toLowerCase()
    || (student && row.student_id === student.id));
  const lastSuccess = matching.filter((row) => row.status === "success")
    .reduce((latest, row) => row.created_at > latest ? row.created_at : latest, "");
  const failures = matching.filter((row) => row.status === "failed" && row.created_at > lastSuccess).length;
  if (failures >= 5) {
    await recordLogin(student, identifier.trim(), "failed", request);
    return { status: "locked" };
  }
  if (!student) {
    await recordLogin(null, identifier.trim(), "failed", request);
    return { status: "invalid" };
  }
  if (!student.is_active) {
    await recordLogin(student, identifier.trim(), "failed", request);
    return { status: "inactive" };
  }
  if (!verifyPassword(password, student.password_hash)) {
    await recordLogin(student, identifier.trim(), "failed", request);
    return { status: "invalid" };
  }
  await recordLogin(student, identifier.trim(), "success", request);
  return { status: "ok", user: student };
}

function escapeFilterValue(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function paged(tableName, page, filters = [], search = "", searchColumns = [], orderBy = "created_at") {
  let statement = db().from(tableName).select("*", { count: "exact" });
  for (const [key, value] of filters) statement = statement.eq(key, value);
  if (search && searchColumns.length) {
    const term = escapeFilterValue(`%${search}%`);
    statement = statement.or(searchColumns.map((column) => `${column}.ilike.${term}`).join(","));
  }
  statement = statement.order(orderBy, { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const { data, count } = await query(statement);
  const total = count || 0;
  return { rows: data || [], total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page };
}

function selectHtml(name, options, selected) {
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}"${String(selected) === String(value) ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

async function renderWelcome(session, request) {
  const { data: events } = await query(db().from("events").select("*").order("event_date", { ascending: true }).limit(10));
  const items = (events || []).map((event) => `<li><p class="event-date">${escapeHtml(event.event_date)} · ${escapeHtml(event.location)}</p><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.description)}</p></li>`).join("");
  return layout("Harborview Student Events", `<section class="hero"><div class="hero-copy"><p class="eyebrow">Student Event Office</p><h1>Campus events, with a login that stays on record.</h1><p class="lede">Students sign up once, check announcements, and look back at their own login history. The event office uses a separate admin account to manage registrations and records.</p><div class="hero-actions"><a class="button" href="/login">Student Login</a><a class="button button-secondary" href="/signup">Create an account</a><a class="button button-ghost" href="/admin/login">Admin Login</a></div></div><aside class="hero-panel"><p class="eyebrow">On the board</p><h2>This month at Harborview</h2><ul class="event-list">${items || "<li><p>No events posted yet.</p></li>"}</ul></aside></section><section class="action-grid"><article class="action-card"><h2>Students</h2><p>Register with your student ID, then sign in to read notices and your personal login history.</p><a href="/signup">Sign up</a></article><article class="action-card"><h2>Event office</h2><p>Administrators have a different login. Student accounts cannot open those pages.</p><a href="/admin/login">Admin login</a></article></section>`, session, request);
}

function loginPage(session, request, errors = {}, identifier = "", admin = false) {
  const path = admin ? "/admin/login" : "/login";
  const loginId = admin ? "email" : "identifier";
  const label = admin ? "Email" : "Student ID or email";
  return layout(admin ? "Admin login" : "Student login", `<section class="auth-layout"><div class="auth-card"><p class="eyebrow">${admin ? "Event office" : "Students"}</p><h1>${admin ? "Admin login" : "Log in"}</h1><p class="lede">${admin ? "Use the office account created for this site." : "Use the student ID or email from your registration."}</p>${formError(errors)}<form class="stack-form" method="post" action="${path}">${csrfInput(session)}${input(label, loginId, identifier, { autocomplete: "username", required: "required", maxlength: "120" }, fieldError(errors, loginId))}${input("Password", "password", "", { type: "password", autocomplete: "current-password", required: "required", maxlength: "128" }, fieldError(errors, "password"))}<button class="button" type="submit">Log in</button></form>${admin ? `<p class="form-note"><a href="/">Back home</a></p>` : `<p class="form-note">Need an account? <a href="/signup">Sign up</a></p>`}</div></section>`, session, request);
}

function signupPage(session, request, values = {}, errors = {}) {
  const departments = selectHtml("department", DEPARTMENTS.map((item) => [item, item]), values.department);
  const years = selectHtml("year_level", YEAR_LEVELS.map((item) => [item, item]), values.year_level);
  return layout("Sign up", `<section class="auth-layout"><div class="auth-card"><p class="eyebrow">New student</p><h1>Create your account</h1>${formError(errors)}<form class="stack-form" method="post" action="/signup">${csrfInput(session)}${input("Full name", "full_name", values.full_name, { required: "required", maxlength: "80" }, fieldError(errors, "full_name"))}${input("Student ID", "student_id", values.student_id, { required: "required", minlength: "4", maxlength: "20" }, fieldError(errors, "student_id"))}${input("Email", "email", values.email, { type: "email", required: "required", maxlength: "120" }, fieldError(errors, "email"))}<label for="department">Department</label><select name="department" id="department" required><option value="">Select a department</option>${departments}</select>${fieldError(errors, "department")}<label for="year_level">Year level</label><select name="year_level" id="year_level" required><option value="">Select a year</option>${years}</select>${fieldError(errors, "year_level")}${input("Password", "password", "", { type: "password", required: "required", minlength: "8", maxlength: "128" }, fieldError(errors, "password"))}${input("Confirm password", "confirm_password", "", { type: "password", required: "required", maxlength: "128" }, fieldError(errors, "confirm_password"))}<button class="button" type="submit">Create account</button></form><p class="form-note">Already registered? <a href="/login">Log in</a></p></div></section>`, session, request);
}

function eventList(events, empty = "No events posted yet.") {
  return events.length
    ? `<ul class="event-list">${events.map((event) => `<li><p class="event-date">${escapeHtml(event.event_date)} · ${escapeHtml(event.location)}</p><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.description)}</p></li>`).join("")}</ul>`
    : `<p class="empty">${empty}</p>`;
}

async function studentDashboard(session, request) {
  const student = await one("students", { id: session.user_id });
  if (!student) return redirect("/login", makeSession({ csrf: session.csrf }), request);
  const [{ data: logins, count }, { data: last }, { data: events }] = await Promise.all([
    query(db().from("login_records").select("id", { count: "exact" }).eq("student_id", student.id).eq("status", "success")),
    query(db().from("login_records").select("created_at").eq("student_id", student.id).eq("status", "success").order("created_at", { ascending: false }).limit(1)),
    query(db().from("events").select("*").order("event_date", { ascending: true }).limit(10)),
  ]);
  const firstName = student.full_name.split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return layout("Dashboard", `${pageHeading("Student dashboard", `${greeting}, ${escapeHtml(firstName)}.`, "Here is your event board and the account the office has on file.")}<section class="dashboard-grid"><article class="info-card"><h2>Your details</h2><dl class="detail-list"><dt>Name</dt><dd>${escapeHtml(student.full_name)}</dd><dt>Student ID</dt><dd>${escapeHtml(student.student_id)}</dd><dt>Email</dt><dd>${escapeHtml(student.email)}</dd><dt>Department</dt><dd>${escapeHtml(student.department)}</dd><dt>Year</dt><dd>${escapeHtml(student.year_level)}</dd><dt>Joined</dt><dd>${escapeHtml(student.created_at)}</dd><dt>Sign-ins</dt><dd>${count || 0}</dd><dt>Last success</dt><dd>${escapeHtml(last?.[0]?.created_at || "No successful login yet")}</dd></dl></article><article class="panel"><h2>Coming up</h2>${eventList(events || [], "The event office has not posted anything yet.")}</article></section><p><a class="button button-secondary" href="/my-logins">My login history</a></p>`, session, request);
}

async function studentRecords(session, request, url) {
  const page = pageNumber(url.searchParams.get("page"));
  const result = await paged("login_records", page, [["student_id", session.user_id]], "", [], "created_at");
  return layout("My logins", `${pageHeading("History", "My login history", "These are your own attempts. The event office is the only group that can change them.")}${table(["When", "Result", "IP address"], result.rows.map((row) => `<tr><td>${escapeHtml(row.created_at)}</td><td><span class="badge ${row.status === "success" ? "badge-ok" : "badge-bad"}">${row.status === "success" ? "Successful" : "Failed"}</span></td><td>${escapeHtml(row.ip_address || "—")}</td></tr>`), "No login attempts are stored for your account yet.")}${result.total ? pager("/my-logins", page, result.pages, result.total, result.total === 1 ? "record" : "records") : ""}`, session, request);
}

function adminShell(title, body, session, request) {
  return layout(title, body, session, request);
}

async function adminDashboard(session, request) {
  const today = new Date().toISOString().slice(0, 10);
  const counts = await Promise.all([
    db().from("students").select("id", { count: "exact", head: true }),
    db().from("students").select("id", { count: "exact", head: true }).eq("is_active", 1),
    db().from("login_records").select("id", { count: "exact", head: true }).eq("status", "success"),
    db().from("login_records").select("id", { count: "exact", head: true }).eq("status", "failed"),
    db().from("login_records").select("id", { count: "exact", head: true }).gte("created_at", today),
  ]);
  for (const result of counts) if (result.error) throw new Error(result.error.message);
  const [{ data: students }, { data: records }] = await Promise.all([
    query(db().from("students").select("full_name,student_id,department,created_at").order("created_at", { ascending: false }).limit(5)),
    query(db().from("login_records").select("created_at,status,attempted_identifier,student_name").order("created_at", { ascending: false }).limit(8)),
  ]);
  const labels = ["Registered students", "Active accounts", "Successful logins", "Failed logins", "Attempts today"];
  const stats = counts.map((item, index) => `<article class="stat"><span>${labels[index]}</span><strong>${item.count || 0}</strong></article>`).join("");
  const studentRows = (students || []).map((row) => `<tr><td>${escapeHtml(row.full_name)}</td><td>${escapeHtml(row.student_id)}</td><td>${escapeHtml(row.department)}</td><td>${escapeHtml(row.created_at)}</td></tr>`);
  const recordRows = (records || []).map((row) => `<tr><td>${escapeHtml(row.created_at)}</td><td>${escapeHtml(row.student_name || "Unknown account")}<br><small>${escapeHtml(row.attempted_identifier)}</small></td><td><span class="badge ${row.status === "success" ? "badge-ok" : "badge-bad"}">${row.status === "success" ? "Successful" : "Failed"}</span></td></tr>`);
  return adminShell("Admin overview", `${pageHeading("Event office", "Overview", `Signed in as ${escapeHtml(session.name)}.`)}<section class="stat-grid">${stats}</section><section class="dashboard-grid"><article class="panel"><h2>Newest students</h2>${table(["Name", "Student ID", "Department", "Joined"], studentRows, "No students have registered yet.")}</article><article class="panel"><h2>Latest login attempts</h2>${table(["When", "Student", "Result"], recordRows, "No login attempts yet.")}</article></section>`, session, request);
}

function studentFilters(searchParams) {
  return {
    q: (searchParams.get("q") || "").trim(),
    department: (searchParams.get("department") || "").trim(),
    year_level: (searchParams.get("year_level") || "").trim(),
    active: (searchParams.get("active") || "").trim(),
  };
}

async function adminStudents(session, request, url) {
  const filters = studentFilters(url.searchParams);
  const page = pageNumber(url.searchParams.get("page"));
  const conditions = [];
  if (DEPARTMENTS.includes(filters.department)) conditions.push(["department", filters.department]);
  if (YEAR_LEVELS.includes(filters.year_level)) conditions.push(["year_level", filters.year_level]);
  if (["0", "1"].includes(filters.active)) conditions.push(["is_active", Number(filters.active)]);
  const result = await paged("students", page, conditions, filters.q, ["full_name", "email", "student_id"]);
  const rows = result.rows.map((student) => `<tr><td>${escapeHtml(student.full_name)}</td><td>${escapeHtml(student.student_id)}</td><td>${escapeHtml(student.email)}</td><td>${escapeHtml(student.department)}</td><td>${escapeHtml(student.year_level)}</td><td><span class="badge ${student.is_active ? "badge-ok" : "badge-off"}">${student.is_active ? "Active" : "Inactive"}</span></td><td><a href="/admin/students/${student.id}/edit">Edit</a><form method="post" action="/admin/students/${student.id}/delete">${csrfInput(session)}<button class="button button-danger button-small">Delete</button></form></td></tr>`);
  const query = { q: filters.q, department: filters.department, year_level: filters.year_level, active: filters.active };
  const filterForm = `<form class="filters" method="get"><div><label for="q">Search</label><input id="q" name="q" value="${escapeHtml(filters.q)}"></div><div><label for="department">Department</label><select id="department" name="department"><option value="">All</option>${selectHtml("department", DEPARTMENTS.map((x) => [x, x]), filters.department)}</select></div><div><label for="year_level">Year</label><select id="year_level" name="year_level"><option value="">All</option>${selectHtml("year_level", YEAR_LEVELS.map((x) => [x, x]), filters.year_level)}</select></div><div><label for="active">Status</label><select id="active" name="active"><option value="">All</option>${selectHtml("active", [["1", "Active"], ["0", "Inactive"]], filters.active)}</select></div><div class="filter-actions"><button class="button button-small">Filter</button><a class="button button-ghost button-small" href="/admin/students">Reset</a></div></form>`;
  return adminShell("Students", `${pageHeading("Accounts", "Registered students")}${filterForm}${table(["Name", "Student ID", "Email", "Department", "Year", "Status", ""], rows, "No students match those filters.")}${result.total ? pager("/admin/students", page, result.pages, result.total, "students", query) : ""}`, session, request);
}

async function editStudentPage(session, request, studentId, values, errors) {
  const student = await one("students", { id: studentId });
  if (!student) return redirect("/admin/students", session, request, "That student was not found.", "error");
  const formValues = values || student;
  const active = String(formValues.is_active ?? 1);
  const body = `${pageHeading(student.student_id, "Edit student")}<article class="panel">${formError(errors)}<form class="stack-form" method="post" action="/admin/students/${studentId}/edit">${csrfInput(session)}${input("Full name", "full_name", formValues.full_name, { required: "required", maxlength: "80" }, fieldError(errors, "full_name"))}${input("Student ID", "student_id", formValues.student_id, { required: "required", maxlength: "20" }, fieldError(errors, "student_id"))}${input("Email", "email", formValues.email, { type: "email", required: "required", maxlength: "120" }, fieldError(errors, "email"))}<label for="department">Department</label><select id="department" name="department">${selectHtml("department", DEPARTMENTS.map((x) => [x, x]), formValues.department)}</select>${fieldError(errors, "department")}<label for="year_level">Year level</label><select id="year_level" name="year_level">${selectHtml("year_level", YEAR_LEVELS.map((x) => [x, x]), formValues.year_level)}</select>${fieldError(errors, "year_level")}<label for="is_active">Account status</label><select id="is_active" name="is_active">${selectHtml("is_active", [["1", "Active"], ["0", "Inactive"]], active)}</select>${fieldError(errors, "is_active")}${input("New password", "new_password", "", { type: "password", maxlength: "128", autocomplete: "new-password", placeholder: "Leave blank to keep current password" }, fieldError(errors, "new_password"))}<button class="button">Save changes</button></form></article>`;
  return adminShell("Edit student", body, session, request);
}

function validateStudent(values, edit = false) {
  const errors = {};
  const clean = {
    full_name: (values.full_name || "").trim(),
    student_id: (values.student_id || "").trim().toUpperCase(),
    email: (values.email || "").trim().toLowerCase(),
    department: (values.department || "").trim(),
    year_level: (values.year_level || "").trim(),
    is_active: Number(values.is_active),
  };
  if (!validName(clean.full_name)) errors.full_name = "Enter a name using letters, spaces, hyphens, or apostrophes.";
  if (!/^[A-Za-z0-9-]{4,20}$/.test(clean.student_id)) errors.student_id = "Use 4 to 20 letters, numbers, or hyphens.";
  if (!validEmail(clean.email)) errors.email = "Enter a valid email address.";
  if (!DEPARTMENTS.includes(clean.department)) errors.department = "Choose a department from the list.";
  if (!YEAR_LEVELS.includes(clean.year_level)) errors.year_level = "Choose a year level from the list.";
  if (edit && !["0", "1"].includes(String(values.is_active))) errors.is_active = "Choose an account status.";
  if (edit && values.new_password) {
    const problem = passwordError(values.new_password);
    if (problem) errors.new_password = problem;
  }
  return { clean, errors };
}

async function updateStudent(session, request, studentId, form) {
  const values = Object.fromEntries(form.entries());
  const { clean, errors } = validateStudent(values, true);
  if (!Object.keys(errors).length) {
    const email = await one("students", { email: clean.email });
    const code = await one("students", { student_id: clean.student_id });
    if (email && email.id !== Number(studentId)) errors.email = "Another student already uses that email.";
    else if (code && code.id !== Number(studentId)) errors.student_id = "Another student already uses that ID.";
  }
  if (Object.keys(errors).length) return editStudentPage(session, request, studentId, values, errors);
  const updates = {
    full_name: clean.full_name, student_id: clean.student_id, email: clean.email,
    department: clean.department, year_level: clean.year_level, is_active: clean.is_active,
  };
  if (values.new_password) updates.password_hash = passwordHash(values.new_password);
  await query(db().from("students").update(updates).eq("id", studentId));
  await addAudit(session.user_id, "update", "students", studentId, `Updated ${clean.full_name} (${clean.student_id}).`);
  return redirect("/admin/students", session, request, "Student account updated.", "success");
}

function validateEvent(values) {
  const clean = {
    title: (values.title || "").trim(),
    description: (values.description || "").trim(),
    location: (values.location || "").trim(),
    event_date: (values.event_date || "").trim(),
  };
  const errors = {};
  if (clean.title.length < 3 || clean.title.length > 120) errors.title = "Use a title between 3 and 120 characters.";
  if (clean.description.length < 5 || clean.description.length > 1000) errors.description = "Describe the event in 5 to 1000 characters.";
  if (clean.location.length < 2 || clean.location.length > 120) errors.location = "Enter a location.";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(clean.event_date) || Number.isNaN(Date.parse(clean.event_date))) errors.event_date = "Choose a valid date and time.";
  clean.event_date = clean.event_date.replace("T", " ");
  return { clean, errors };
}

async function adminEvents(session, request) {
  const { data: events } = await query(db().from("events").select("*").order("event_date", { ascending: true }));
  const rows = (events || []).map((event) => `<tr><td>${escapeHtml(event.event_date)}</td><td>${escapeHtml(event.title)}<br><small>${escapeHtml(event.description)}</small></td><td>${escapeHtml(event.location)}</td><td><a href="/admin/events/${event.id}/edit">Edit</a><form method="post" action="/admin/events/${event.id}/delete">${csrfInput(session)}<button class="button button-danger button-small">Delete</button></form></td></tr>`);
  return adminShell("Events", `${pageHeading("Board", "Event announcements")}<p><a class="button" href="/admin/events/new">Post an event</a></p>${table(["When", "Title", "Location", ""], rows, "No events posted yet.")}`, session, request);
}

async function eventFormPage(session, request, eventId, values, errors) {
  const event = eventId ? await one("events", { id: eventId }) : null;
  if (eventId && !event) return redirect("/admin/events", session, request, "That event was not found.", "error");
  const data = values || event || {};
  const date = String(data.event_date || "").replace(" ", "T").slice(0, 16);
  return adminShell(event ? "Edit event" : "New event", `${pageHeading("Announcement", event ? "Edit event" : "Post an event")}<article class="panel"><form class="stack-form" method="post" action="${event ? `/admin/events/${eventId}/edit` : "/admin/events/new"}">${csrfInput(session)}${input("Title", "title", data.title, { required: "required", maxlength: "120" }, fieldError(errors, "title"))}${input("Date and time", "event_date", date, { type: "datetime-local", required: "required" }, fieldError(errors, "event_date"))}${input("Location", "location", data.location, { required: "required", maxlength: "120" }, fieldError(errors, "location"))}<label for="description">Description</label><textarea id="description" name="description" required maxlength="1000">${escapeHtml(data.description || "")}</textarea>${fieldError(errors, "description")}<button class="button">${event ? "Save event" : "Post event"}</button></form></article>`, session, request);
}

async function adminRecords(session, request, url) {
  const page = pageNumber(url.searchParams.get("page"));
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || "";
  const dateFrom = url.searchParams.get("date_from") || "";
  const dateTo = url.searchParams.get("date_to") || "";
  const conditions = [];
  if (["success", "failed"].includes(status)) conditions.push(["status", status]);
  let statement = db().from("login_records").select("*", { count: "exact" });
  for (const [key, value] of conditions) statement = statement.eq(key, value);
  if (dateFrom) statement = statement.gte("created_at", dateFrom);
  if (dateTo) statement = statement.lte("created_at", `${dateTo} 23:59:59`);
  if (q) {
    const search = escapeFilterValue(`%${q}%`);
    const filters = ["attempted_identifier", "student_name", "student_code"]
      .map((column) => `${column}.ilike.${search}`);
    const studentSearch = await query(db().from("students").select("id")
      .or(["full_name", "email", "student_id"]
        .map((column) => `${column}.ilike.${search}`).join(","))
      .limit(500));
    if (studentSearch.data?.length) {
      filters.push(`student_id.in.(${studentSearch.data.map((student) => student.id).join(",")})`);
    }
    statement = statement.or(filters.join(","));
  }
  const { data: rows, count } = await query(statement.order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1));
  const total = count || 0;
  const result = { rows: rows || [], total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  const studentIds = [...new Set(rows.map((row) => row.student_id).filter(Boolean))];
  const { data: currentStudents } = studentIds.length ? await query(db().from("students").select("id,full_name,student_id").in("id", studentIds)) : { data: [] };
  const currentById = new Map((currentStudents || []).map((student) => [student.id, student]));
  const tableRows = rows.map((row) => {
    const current = currentById.get(row.student_id);
    return `<tr><td>${escapeHtml(row.created_at)}</td><td>${escapeHtml(current?.full_name || row.student_name || "Unknown account")}<br><small>${escapeHtml(current?.student_id || row.student_code || "")}</small></td><td>${escapeHtml(row.attempted_identifier)}</td><td><span class="badge ${row.status === "success" ? "badge-ok" : "badge-bad"}">${row.status === "success" ? "Successful" : "Failed"}</span></td><td>${escapeHtml(row.ip_address || "—")}</td><td>${escapeHtml(row.note || "—")}</td><td><a href="/admin/records/${row.id}/edit">Edit</a><form method="post" action="/admin/records/${row.id}/delete">${csrfInput(session)}<button class="button button-danger button-small">Delete</button></form></td></tr>`;
  });
  const queryParams = { q, status, date_from: dateFrom, date_to: dateTo };
  const filters = `<form class="filters" method="get"><div><label for="q">Search</label><input id="q" name="q" value="${escapeHtml(q)}"></div><div><label for="status">Result</label><select id="status" name="status"><option value="">All</option>${selectHtml("status", [["success", "Successful"], ["failed", "Failed"]], status)}</select></div><div><label for="date_from">From</label><input id="date_from" name="date_from" type="date" value="${escapeHtml(dateFrom)}"></div><div><label for="date_to">To</label><input id="date_to" name="date_to" type="date" value="${escapeHtml(dateTo)}"></div><div class="filter-actions"><button class="button button-small">Filter</button><a class="button button-ghost button-small" href="/admin/records">Reset</a></div></form>`;
  return adminShell("Login records", `${pageHeading("History", "Login records", "Student sign-in attempts, including failed attempts.")}${filters}${table(["When", "Student", "Tried", "Result", "IP", "Note", ""], tableRows, "No login attempts match those filters.")}${result.total ? pager("/admin/records", page, result.pages, result.total, "records", queryParams) : ""}`, session, request);
}

async function editRecordPage(session, request, recordId, values, errors) {
  const record = await one("login_records", { id: recordId });
  if (!record) return redirect("/admin/records", session, request, "That login record was not found.", "error");
  const data = values || record;
  return adminShell("Edit login record", `${pageHeading(record.created_at, "Edit login record")}<article class="panel"><dl class="detail-list"><dt>Student</dt><dd>${escapeHtml(record.student_name || "Unknown account")}</dd><dt>Typed</dt><dd>${escapeHtml(record.attempted_identifier)}</dd><dt>IP address</dt><dd>${escapeHtml(record.ip_address || "—")}</dd></dl><form class="stack-form" method="post" action="/admin/records/${recordId}/edit">${csrfInput(session)}<label for="status">Result</label><select id="status" name="status">${selectHtml("status", [["success", "Successful"], ["failed", "Failed"]], data.status)}</select>${fieldError(errors, "status")}<label for="note">Note</label><textarea id="note" name="note" maxlength="500">${escapeHtml(data.note || "")}</textarea>${fieldError(errors, "note")}<button class="button">Save record</button></form></article>`, session, request);
}

async function adminAudit(session, request, url) {
  const page = pageNumber(url.searchParams.get("page"));
  const result = await paged("admin_audit_logs", page, [], "", [], "created_at");
  const adminIds = [...new Set(result.rows.map((row) => row.admin_id))];
  const { data: admins } = adminIds.length ? await query(db().from("admins").select("id,full_name").in("id", adminIds)) : { data: [] };
  const names = new Map((admins || []).map((admin) => [admin.id, admin.full_name]));
  const rows = result.rows.map((row) => `<tr><td>${escapeHtml(row.created_at)}</td><td>${escapeHtml(names.get(row.admin_id) || "Unknown admin")}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.target_table)}${row.target_id ? ` #${row.target_id}` : ""}</td><td>${escapeHtml(row.details)}</td></tr>`);
  return adminShell("Audit log", `${pageHeading("Office activity", "Audit log")}${table(["When", "Admin", "Action", "Target", "Details"], rows, "No administrator actions have been recorded yet.")}${result.total ? pager("/admin/audit", page, result.pages, result.total, "entries") : ""}`, session, request);
}

async function parsePost(request, session) {
  const form = await request.formData();
  if (form.get("csrf_token") !== session.csrf) return false;
  return form;
}

async function registerStudent(form, session, request) {
  const values = {
    full_name: (form.get("full_name") || "").trim(),
    student_id: (form.get("student_id") || "").trim().toUpperCase(),
    email: (form.get("email") || "").trim().toLowerCase(),
    department: (form.get("department") || "").trim(),
    year_level: (form.get("year_level") || "").trim(),
  };
  const password = form.get("password") || "";
  const errors = {};
  if (!validName(values.full_name)) errors.full_name = "Enter your name using letters, spaces, hyphens, or apostrophes.";
  if (!/^[A-Za-z0-9-]{4,20}$/.test(values.student_id)) errors.student_id = "Use 4 to 20 letters, numbers, or hyphens.";
  if (!validEmail(values.email)) errors.email = "Enter a valid email address.";
  if (!DEPARTMENTS.includes(values.department)) errors.department = "Choose a department from the list.";
  if (!YEAR_LEVELS.includes(values.year_level)) errors.year_level = "Choose a year level from the list.";
  const passwordProblem = passwordError(password);
  if (passwordProblem) errors.password = passwordProblem;
  if (form.get("confirm_password") !== password) errors.confirm_password = "Those passwords do not match.";
  if (!Object.keys(errors).length) {
    const email = await one("students", { email: values.email });
    const studentId = await one("students", { student_id: values.student_id });
    if (email && studentId) errors.form = "That student ID and email are already registered.";
    else if (email) errors.email = "That email is already registered.";
    else if (studentId) errors.student_id = "That student ID is already registered.";
  }
  if (Object.keys(errors).length) return signupPage(session, request, values, errors);
  const { error } = await db().from("students").insert({
    ...values, password_hash: passwordHash(password), is_active: 1, created_at: now(),
  });
  if (error?.code === "23505") return signupPage(session, request, values, { form: "That student ID or email is already registered." });
  if (error) throw new Error(error.message);
  return redirect("/login", session, request, "Your account is ready. You can log in now.", "success");
}

async function adminLogin(form, session, request) {
  const email = (form.get("email") || "").trim().toLowerCase();
  const password = form.get("password") || "";
  if (!email || !password) return loginPage(session, request, { form: "Enter the admin email and password." }, email, true);
  const admin = await one("admins", { email });
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return loginPage(session, request, { form: "The email or password is not right." }, email, true);
  }
  Object.assign(session, makeSession({ role: "admin", user_id: admin.id, name: admin.full_name }));
  await addAudit(admin.id, "login", "admins", admin.id, "Signed in to the admin area.");
  return redirect("/admin/", session, request, `Signed in as ${admin.full_name}.`, "success");
}

async function route(request, session) {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const method = request.method.toUpperCase();
  const adminRoute = path === "/admin" || path.startsWith("/admin/");
  const studentRoute = ["/dashboard", "/my-logins"].includes(path);

  if (adminRoute && path !== "/admin/login") {
    if (session.role === "student") {
      return response("<main><h1>You can’t open this page.</h1><a href='/'>Back home</a></main>", session, request, 403);
    }
    if (session.role !== "admin") return redirect("/admin/login", session, request);
    if (!await one("admins", { id: session.user_id })) {
      session = makeSession({ csrf: session.csrf });
      return redirect("/admin/login", session, request);
    }
  }
  if (studentRoute) {
    if (session.role === "admin") {
      return response("<main><h1>The office account uses the admin dashboard.</h1><a href='/admin/'>Admin dashboard</a></main>", session, request, 403);
    }
    if (session.role !== "student") return redirect("/login", session, request);
    if (!await one("students", { id: session.user_id })) {
      session = makeSession({ csrf: session.csrf });
      return redirect("/login", session, request);
    }
  }

  if (path === "/signup" && session.role === "student") return redirect("/dashboard", session, request);

  if (method === "POST") {
    const form = await parsePost(request, session);
    if (!form) return response("<h1>Invalid or expired form. Go back and try again.</h1>", session, request, 403);
    if (path === "/login") {
      const identifier = (form.get("identifier") || "").trim();
      const password = form.get("password") || "";
      const errors = {};
      if (!identifier || identifier.length > 120) errors.identifier = "Enter your student ID or email.";
      if (!password || password.length > 128) errors.password = "Enter your password.";
      if (Object.keys(errors).length) return loginPage(session, request, errors, identifier);
      const result = await studentLogin(identifier, password, request);
      if (result.status === "ok") {
        session = makeSession({ role: "student", user_id: result.user.id, name: result.user.full_name });
        return redirect("/dashboard", session, request, `Welcome back, ${result.user.full_name}.`, "success");
      }
      const message = result.status === "inactive" ? "This account is deactivated. Contact the event office."
        : result.status === "locked" ? "Too many failed tries. Wait a few minutes and try again."
          : "The student ID or password is not right.";
      return loginPage(session, request, { form: message }, identifier);
    }
    if (path === "/signup") return registerStudent(form, session, request);
    if (path === "/admin/login") return adminLogin(form, session, request);
    if (path === "/logout") return redirect("/", makeSession(), request, "You have been logged out.", "info");

    let match = path.match(/^\/admin\/students\/(\d+)\/edit$/);
    if (match && session.role === "admin") return updateStudent(session, request, match[1], form);
    match = path.match(/^\/admin\/students\/(\d+)\/delete$/);
    if (match && session.role === "admin") {
      const student = await one("students", { id: match[1] });
      if (!student) return redirect("/admin/students", session, request, "That student was not found.", "error");
      await query(db().from("students").delete().eq("id", match[1]));
      await addAudit(session.user_id, "delete", "students", match[1], `Deleted ${student.full_name} (${student.student_id}).`);
      return redirect("/admin/students", session, request, "Student account deleted.", "success");
    }
    match = path.match(/^\/admin\/records\/(\d+)\/edit$/);
    if (match && session.role === "admin") {
      const values = { status: form.get("status") || "", note: (form.get("note") || "").trim() };
      const errors = {};
      if (!["success", "failed"].includes(values.status)) errors.status = "Choose successful or failed.";
      if (values.note.length > 500) errors.note = "Keep the note under 500 characters.";
      if (Object.keys(errors).length) return editRecordPage(session, request, match[1], values, errors);
      const record = await one("login_records", { id: match[1] });
      if (!record) return redirect("/admin/records", session, request, "That login record was not found.", "error");
      await query(db().from("login_records").update({ ...values, edited_at: now(), edited_by: session.user_id }).eq("id", match[1]));
      await addAudit(session.user_id, "update", "login_records", match[1], `Status ${record.status} -> ${values.status}.`);
      return redirect("/admin/records", session, request, "Login record updated.", "success");
    }
    match = path.match(/^\/admin\/records\/(\d+)\/delete$/);
    if (match && session.role === "admin") {
      const record = await one("login_records", { id: match[1] });
      if (!record) return redirect("/admin/records", session, request, "That login record was not found.", "error");
      await query(db().from("login_records").delete().eq("id", match[1]));
      await addAudit(session.user_id, "delete", "login_records", match[1], `Deleted attempt ${record.attempted_identifier} from ${record.created_at}.`);
      return redirect("/admin/records", session, request, "Login record deleted.", "success");
    }
    match = path.match(/^\/admin\/events\/new$/) || path.match(/^\/admin\/events\/(\d+)\/edit$/);
    if (match && session.role === "admin") {
      const eventId = path.includes("/new") ? null : match[1];
      const values = Object.fromEntries(form.entries());
      const { clean, errors } = validateEvent(values);
      if (Object.keys(errors).length) return eventFormPage(session, request, eventId, values, errors);
      if (eventId) {
        const { error } = await db().from("events").update(clean).eq("id", eventId);
        if (error) throw new Error(error.message);
        await addAudit(session.user_id, "update", "events", eventId, `Updated ${clean.title}.`);
      } else {
        const { data, error } = await db().from("events").insert({ ...clean, created_by: session.user_id, created_at: now() }).select().single();
        if (error) throw new Error(error.message);
        await addAudit(session.user_id, "create", "events", data.id, `Posted ${clean.title}.`);
      }
      return redirect("/admin/events", session, request, eventId ? "Event updated." : "Event posted.", "success");
    }
    match = path.match(/^\/admin\/events\/(\d+)\/delete$/);
    if (match && session.role === "admin") {
      const event = await one("events", { id: match[1] });
      if (!event) return redirect("/admin/events", session, request, "That event was not found.", "error");
      await query(db().from("events").delete().eq("id", match[1]));
      await addAudit(session.user_id, "delete", "events", match[1], `Removed ${event.title}.`);
      return redirect("/admin/events", session, request, "Event removed.", "success");
    }
    return response("<h1>Page not found</h1>", session, request, 404);
  }

  if (path === "/" && method === "GET") return renderWelcome(session, request);
  if (path === "/login" && method === "GET") {
    if (session.role === "student") return redirect("/dashboard", session, request);
    return loginPage(session, request);
  }
  if (path === "/signup" && method === "GET") return signupPage(session, request);
  if (path === "/admin/login" && method === "GET") {
    if (session.role === "admin") return redirect("/admin/", session, request);
    return loginPage(session, request, {}, "", true);
  }
  if (path === "/dashboard" && method === "GET") return studentDashboard(session, request);
  if (path === "/my-logins" && method === "GET") return studentRecords(session, request, url);
  if ((path === "/admin" || path === "/admin/") && method === "GET") return adminDashboard(session, request);
  if (path === "/admin/students" && method === "GET") return adminStudents(session, request, url);
  if (path === "/admin/events" && method === "GET") return adminEvents(session, request);
  if (path === "/admin/records" && method === "GET") return adminRecords(session, request, url);
  if (path === "/admin/audit" && method === "GET") return adminAudit(session, request, url);
  let match = path.match(/^\/admin\/students\/(\d+)\/edit$/);
  if (match && method === "GET") return editStudentPage(session, request, match[1]);
  match = path.match(/^\/admin\/records\/(\d+)\/edit$/);
  if (match && method === "GET") return editRecordPage(session, request, match[1]);
  match = path.match(/^\/admin\/events\/new$/);
  if (match && method === "GET") return eventFormPage(session, request, null);
  match = path.match(/^\/admin\/events\/(\d+)\/edit$/);
  if (match && method === "GET") return eventFormPage(session, request, match[1]);
  return response("<main><h1>Page not found</h1><a href='/'>Back home</a></main>", session, request, 404);
}

export default async (request) => {
  try {
    const session = readSession(request);
    return await route(request, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    console.error("Harborview request failed:", message);
    const isSecretConfigurationError = message.startsWith("SECRET_KEY ");
    const body = isSecretConfigurationError
      ? `<main><h1>Server configuration error</h1><p>${escapeHtml(message)}</p><p>In Vercel, set SECRET_KEY for this project, then redeploy.</p></main>`
      : "<main><h1>Service temporarily unavailable</h1><p>Please try again shortly.</p></main>";
    return new Response(body, {
      status: 500,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "same-origin",
      },
    });
  }
};

export { passwordHash, verifyPassword };
