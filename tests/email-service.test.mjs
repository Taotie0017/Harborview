import test from "node:test";
import assert from "node:assert/strict";

import { sendVerificationEmail } from "../lib/email-service.mjs";

const originalApiKey = process.env.RESEND_API_KEY;
const originalSender = process.env.EMAIL_FROM;
const originalFetch = globalThis.fetch;

function restoreEnvironment() {
  if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalApiKey;
  if (originalSender === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = originalSender;
  globalThis.fetch = originalFetch;
}

test.after(restoreEnvironment);

test("sends a signup verification through the Resend API", async () => {
  process.env.RESEND_API_KEY = " test-resend-key ";
  process.env.EMAIL_FROM = " Harborview <no-reply@example.com> ";
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(null, { status: 200 });
  };

  await sendVerificationEmail(
    { email: "ada@example.com", full_name: "Ada Lovelace" },
    "012345",
    "signup",
  );

  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer test-resend-key");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), {
    from: "Harborview <no-reply@example.com>",
    to: ["ada@example.com"],
    subject: "Your Harborview verification code",
    text: "Hello Ada Lovelace,\n\nUse this code to verify your email address: 012345\n\nThe code expires in 10 minutes. If you did not request it, ignore this email.",
  });
});

test("reports the Resend API rejection message", async () => {
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.EMAIL_FROM = "Harborview <no-reply@example.com>";
  let emailText;
  globalThis.fetch = async (_url, options) => {
    emailText = JSON.parse(options.body).text;
    return new Response(
      JSON.stringify({ message: "The sender domain is not verified" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  };

  await assert.rejects(
    sendVerificationEmail(
      { email: "ada@example.com", full_name: "Ada Lovelace" },
      "012345",
      "login",
    ),
    /Email delivery failed: The sender domain is not verified/,
  );
  assert.match(emailText, /finish signing in/);
});

test("reports missing Resend configuration before making a request", async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    return new Response(null, { status: 200 });
  };

  await assert.rejects(
    sendVerificationEmail(
      { email: "ada@example.com", full_name: "Ada Lovelace" },
      "012345",
      "signup",
    ),
    /Set RESEND_API_KEY and EMAIL_FROM/,
  );
  assert.equal(requested, false);
});
