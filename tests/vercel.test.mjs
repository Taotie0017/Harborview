import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";

import app, { passwordHash, verifyPassword } from "../lib/app.mjs";
import vercelHandler, { config } from "../api/index.mjs";

const password = "HarborviewTest123!";
const werkzeugScryptHash = "scrypt:32768:8:1$hpHutzSNW8R1r8ql$02c58942ca56c79f7c13867c319275b3301d09de7eb19bfe709f31c22da45fc79fc32f92046c943389cc674f943835e1e0fc53c7b4b4e20de1b415a4c841d3bf";
const werkzeugPbkdf2Hash = "pbkdf2:sha256:600000$MlTyEYRFWIwEuCzS$f513959433188edcfca428ecfc57fc7945a3c1c01ac181b5a1f1ce0262a7dba2";
let database;
let databaseUrl;

test.before(async () => {
  database = createServer((_request, result) => {
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
  assert.match(await result.text(), /Campus events, with a login that stays on record/);
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

test("requires a pending student verification before opening the code form", async () => {
  const result = await app(new Request("https://harborview.example/verify-email"));
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("location"), "/login");
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
