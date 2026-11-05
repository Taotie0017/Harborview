import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";

import app, { passwordHash, verifyPassword } from "../lib/app.mjs";
import vercelHandler, { config } from "../api/index.mjs";

const password = "HarborviewTest123!";
const werkzeugScryptHash = "scrypt:32768:8:1$hpHutzSNW8R1r8ql$02c58942ca56c79f7c13867c319275b3301d09de7eb19bfe709f31c22da45fc79fc32f92046c943389cc674f943835e1e0fc53c7b4b4e20de1b415a4c841d3bf";
const werkzeugPbkdf2Hash = "pbkdf2:sha256:600000$MlTyEYRFWIwEuCzS$f513959433188edcfca428ecfc57fc7945a3c1c01ac181b5a1f1ce0262a7dba2";
let database;
let databaseUrl;
let mockEventFlow = false;
let mockStudentLogin = false;
let mockStudentExists = false;
let insertedEvent;
let insertedStudent;

test.before(async () => {
  database = createServer(async (request, result) => {
    const url = new URL(request.url, databaseUrl);
    if (mockEventFlow && url.pathname === "/rest/v1/admins" && request.method === "GET") {
      result.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Range": "*/1",
      });
      result.end(JSON.stringify([{
        id: 17,
        full_name: "Test Administrator",
        email: "office@example.com",
        created_at: "2026-01-01 00:00:00",
      }]));
      return;
    }
    if (mockEventFlow && url.pathname === "/rest/v1/events" && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      insertedEvent = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      result.writeHead(201, {
        "Content-Type": "application/json",
        "Content-Range": "*/1",
      });
      result.end(JSON.stringify({ id: 42 }));
      return;
    }
    if (mockEventFlow && url.pathname === "/rest/v1/admin_audit_logs" && request.method === "POST") {
      result.writeHead(201, { "Content-Range": "*/1" });
      result.end();
      return;
    }
    if (mockStudentLogin && url.pathname === "/rest/v1/students" && request.method === "GET") {
      const student = mockStudentExists && (
        url.searchParams.get("student_id") === "eq.HV-1001"
        || url.searchParams.get("id") === "eq.42"
        || url.searchParams.get("email") === "eq.ada@example.com")
        ? [{
          id: 42,
          full_name: "Ada Lovelace",
          student_id: "HV-1001",
          email: "ada@example.com",
          password_hash: passwordHash(password),
          is_active: true,
        }]
        : [];
      result.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Range": `*/${student.length}`,
      });
      result.end(JSON.stringify(student));
      return;
    }
    if (mockStudentLogin && url.pathname === "/rest/v1/students" && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      insertedStudent = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      mockStudentExists = true;
      result.writeHead(201, {
        "Content-Type": "application/json",
        "Content-Range": "*/1",
      });
      result.end();
      return;
    }
    result.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Range": "*/0",
    });
    result.end("[]");
  });
  await new Promise((resolve) => database.listen(0, "127.0.0.1", resolve));
  databaseUrl = `http://127.0.0.1:${database.address().port}`;
  process.env.SECRET_KEY = "test-secret-key-with-at-least-thirty-two-characters";
  process.env.SUPABASE_URL = databaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

test.after(async () => {
  await new Promise((resolve, reject) => database.close((error) => error ? reject(error) : resolve()));
});

test("accepts existing Werkzeug scrypt and PBKDF2 hashes", () => {
  assert.equal(verifyPassword(password, werkzeugScryptHash), true);
  assert.equal(verifyPassword(password, werkzeugPbkdf2Hash), true);
});

test("rejects incorrect passwords and malformed hashes", () => {
  assert.equal(verifyPassword("incorrect", werkzeugScryptHash), false);
  assert.equal(verifyPassword(password, "unsupported$hash$value"), false);
});

test("creates a Werkzeug-compatible scrypt hash", () => {
  const hash = passwordHash(password);
  assert.match(hash, /^scrypt:32768:8:1\$/);
  assert.equal(verifyPassword(password, hash), true);
});

test("serves the public homepage through the application handler", async () => {
  const result = await app(new Request("https://harborview.example/"));
  assert.equal(result.status, 200);
  const html = await result.text();
  assert.match(html, /Campus events, with a login that stays on record/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, /aria-label="Switch to dark mode"/);
  assert.match(html, /<svg viewBox="0 0 24 24"/);
  assert.match(html, /aria-controls="site-nav"/);
  assert.match(html, /harborview-theme/);
  assert.match(result.headers.get("set-cookie"), /HttpOnly/);
});

test("adapts Vercel requests and responses to the application handler", async () => {
  const req = Readable.from([]);
  req.url = "/api/";
  req.method = "GET";
  req.headers = { host: "harborview.example", "x-forwarded-proto": "https" };
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };

  await vercelHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.toString(), /Campus events, with a login that stays on record/);
  assert.match(headers["set-cookie"].join("; "), /HttpOnly/);
});

test("routes Vercel admin rewrites through the index function", async () => {
  const req = Readable.from([]);
  req.url = "/api/index?__path=%2Fadmin%2Flogin";
  req.method = "GET";
  req.headers = { host: "harborview.example", "x-forwarded-proto": "https" };
  const res = {
    setHeader() {},
    end(body) {
      this.body = body;
    },
  };

  await vercelHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.toString(), /Admin Login/);
});

test("routes the trailing-slash admin dashboard through the index function", async () => {
  const req = Readable.from([]);
  req.url = "/api/index?__path=%2Fadmin%2F";
  req.method = "GET";
  req.headers = { host: "harborview.example", "x-forwarded-proto": "https" };
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };

  await vercelHandler(req, res);

  assert.equal(res.statusCode, 303);
  assert.equal(headers.location, "/admin/login");
  assert.equal(res.body.toString(), "");
});

test("creates an event through the Vercel admin rewrite", async () => {
  const session = {
    csrf: "event-csrf-token",
    role: "admin",
    user_id: 17,
    name: "Test Administrator",
    expires: Math.floor(Date.now() / 1000) + 3600,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", process.env.SECRET_KEY)
    .update(payload)
    .digest("base64url");
  const cookie = `harborview_session=${payload}.${signature}`;
  const getRequest = Readable.from([]);
  getRequest.url = "/api/index?__path=%2Fadmin%2Fevents%2Fnew&path=events%2Fnew";
  getRequest.method = "GET";
  getRequest.headers = {
    host: "harborview.example",
    "x-forwarded-proto": "https",
    cookie,
  };
  const getResponse = {
    setHeader() {},
    end(body) {
      this.body = body;
    },
  };
  const form = new URLSearchParams({
    csrf_token: session.csrf,
    title: "Test Event",
    description: "A test event for the Vercel submission path.",
    location: "Main Hall",
    event_date: "2026-12-01T10:00",
    capacity: "25",
  });
  const req = Readable.from([Buffer.from(form.toString())]);
  req.url = "/api/index?__path=%2Fadmin%2Fevents%2Fnew&path=events%2Fnew";
  req.method = "POST";
  req.headers = {
    host: "harborview.example",
    "x-forwarded-proto": "https",
    "content-type": "application/x-www-form-urlencoded",
    cookie,
  };
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };

  mockEventFlow = true;
  insertedEvent = undefined;
  try {
    await vercelHandler(getRequest, getResponse);
    await vercelHandler(req, res);
  } finally {
    mockEventFlow = false;
  }

  assert.equal(getResponse.statusCode, 200);
  assert.match(getResponse.body.toString(), /Attendee capacity/);
  assert.equal(res.statusCode, 303);
  assert.equal(headers.location, "/admin/events");
  assert.equal(insertedEvent.title, "Test Event");
  assert.equal(insertedEvent.capacity, 25);
  assert.equal(insertedEvent.created_by, 17);
});

test("routes login and signup pages and rejects a POST without a CSRF token", async () => {
  const login = await app(new Request("https://harborview.example/login"));
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Student ID or email/);

  const signup = await app(new Request("https://harborview.example/signup", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "full_name=Ada",
  }));
  assert.equal(signup.status, 403);
});

test("accepts a signed CSRF token and renders signup validation errors", async () => {
  const page = await app(new Request("https://harborview.example/signup"));
  const html = await page.text();
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  const cookie = page.headers.get("set-cookie").split(";")[0];
  assert.ok(csrf);

  const result = await app(new Request("https://harborview.example/signup", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: new URLSearchParams({
      csrf_token: csrf,
      full_name: "Ada Lovelace",
      student_id: "HV-1001",
      email: "ada@example.com",
      department: "Computer Science",
      year_level: "2nd Year",
      password: "weak",
      confirm_password: "weak",
    }),
  }));
  assert.equal(result.status, 200);
  assert.match(await result.text(), /at least 8 characters/);
});

test("signup creates an account and signs in without email configuration", async () => {
  const page = await app(new Request("https://harborview.example/signup"));
  const html = await page.text();
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  const cookie = page.headers.get("set-cookie").split(";")[0];
  assert.ok(csrf);

  mockStudentLogin = true;
  mockStudentExists = false;
  insertedStudent = undefined;
  try {
    const result = await app(new Request("https://harborview.example/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
      },
      body: new URLSearchParams({
        csrf_token: csrf,
        full_name: "Ada Lovelace",
        student_id: "HV-1001",
        email: "ada@example.com",
        department: "Computer Science",
        year_level: "2nd Year",
        password,
        confirm_password: password,
      }),
    }));
    assert.equal(result.status, 303, await result.text());
    assert.equal(result.headers.get("location"), "/dashboard");
    assert.equal(insertedStudent.student_id, "HV-1001");
    assert.equal("email_verified" in insertedStudent, false);
  } finally {
    mockStudentLogin = false;
    mockStudentExists = false;
  }
});

test("student ID login completes without calling email verification", async () => {
  const page = await app(new Request("https://harborview.example/login"));
  const html = await page.text();
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  const cookie = page.headers.get("set-cookie").split(";")[0];
  assert.ok(csrf);
  assert.match(html, /class="password-toggle"/);

  mockStudentLogin = true;
  mockStudentExists = true;
  try {
    const result = await app(new Request("https://harborview.example/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
      },
      body: new URLSearchParams({
        csrf_token: csrf,
        identifier: "HV-1001",
        password,
      }),
    }));
    assert.equal(result.status, 303);
    assert.equal(result.headers.get("location"), "/dashboard");
  } finally {
    mockStudentLogin = false;
    mockStudentExists = false;
  }
});

test("verification routes are no longer available", async () => {
  const result = await app(new Request("https://harborview.example/verify-email"));
  assert.equal(result.status, 404);
});

test("reports a missing runtime secret without failing while generating an error response", async () => {
  const secret = process.env.SECRET_KEY;
  delete process.env.SECRET_KEY;
  try {
    const result = await app(new Request("https://harborview.example/"));
    assert.equal(result.status, 500);
    assert.match(await result.text(), /SECRET_KEY is missing from the Vercel Function runtime/);
    assert.equal(result.headers.has("set-cookie"), false);
  } finally {
    process.env.SECRET_KEY = secret;
  }
});

test("distinguishes a short runtime secret from a missing one", async () => {
  const secret = process.env.SECRET_KEY;
  process.env.SECRET_KEY = "too-short";
  try {
    const result = await app(new Request("https://harborview.example/"));
    assert.equal(result.status, 500);
    assert.match(await result.text(), /available to the Function but has fewer than 32 characters/);
  } finally {
    process.env.SECRET_KEY = secret;
  }
});

test("disables Vercel's body parser to preserve form request streams", () => {
  assert.deepEqual(config.api, { bodyParser: false });
});
