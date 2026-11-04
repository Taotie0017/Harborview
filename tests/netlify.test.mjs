import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import handler, { config, passwordHash, verifyPassword } from "../netlify/functions/app.mjs";

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

test("serves the public homepage through the Netlify request handler", async () => {
  const result = await handler(new Request("https://harborview.example/"));
  assert.equal(result.status, 200);
  assert.match(await result.text(), /Campus events, with a login that stays on record/);
  assert.match(result.headers.get("set-cookie"), /HttpOnly/);
});

test("routes login and signup pages and rejects a POST without a CSRF token", async () => {
  const login = await handler(new Request("https://harborview.example/login"));
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Student ID or email/);

  const signup = await handler(new Request("https://harborview.example/signup", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "full_name=Ada",
  }));
  assert.equal(signup.status, 403);
});

test("accepts a signed CSRF token and renders signup validation errors", async () => {
  const page = await handler(new Request("https://harborview.example/signup"));
  const html = await page.text();
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  const cookie = page.headers.get("set-cookie").split(";")[0];
  assert.ok(csrf);

  const result = await handler(new Request("https://harborview.example/signup", {
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

test("reports a missing runtime secret without failing while generating an error response", async () => {
  const secret = process.env.SECRET_KEY;
  delete process.env.SECRET_KEY;
  try {
    const result = await handler(new Request("https://harborview.example/"));
    assert.equal(result.status, 500);
    assert.match(await result.text(), /SECRET_KEY is missing from the Netlify Function runtime/);
    assert.equal(result.headers.has("set-cookie"), false);
  } finally {
    process.env.SECRET_KEY = secret;
  }
});

test("distinguishes a short runtime secret from a missing one", async () => {
  const secret = process.env.SECRET_KEY;
  process.env.SECRET_KEY = "too-short";
  try {
    const result = await handler(new Request("https://harborview.example/"));
    assert.equal(result.status, 500);
    assert.match(await result.text(), /available to the Function but has fewer than 32 characters/);
  } finally {
    process.env.SECRET_KEY = secret;
  }
});

test("registers root and catch-all Netlify function routes", () => {
  assert.deepEqual(config.path, ["/", "/*"]);
  assert.deepEqual(config.excludedPath, ["/static/*"]);
});
