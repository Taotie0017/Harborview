export async function sendVerificationEmail(student, code, purpose) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const sender = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !sender) {
    throw new Error("Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.");
  }

  const action = purpose === "signup" ? "verify your email address" : "finish signing in";
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sender,
      to: [student.email],
      subject: "Your Harborview verification code",
      text: `Hello ${student.full_name},\n\nUse this code to ${action}: ${code}\n\nThe code expires in 10 minutes. If you did not request it, ignore this email.`,
    }),
  });
  if (result.ok) return;

  const responseBody = await result.text();
  let detail = "";
  if (responseBody) {
    try {
      const payload = JSON.parse(responseBody);
      if (payload && typeof payload === "object" && typeof payload.message === "string") {
        detail = payload.message;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error(detail
    ? `Email delivery failed: ${detail}`
    : `Email delivery failed with HTTP ${result.status}.`);
}
