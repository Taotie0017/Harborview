import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

def send_email(recipient, name, code, purpose):
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    sender = os.environ.get("EMAIL_FROM", "").strip()
    if not api_key or not sender:
        raise RuntimeError(
            "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM."
        )

    action = "verify your email address" if purpose == "signup" else "finish signing in"
    payload = {
        "from": sender,
        "to": [recipient],
        "subject": "Your Harborview verification code",
        "text": (
            f"Hello {name},\n\nUse this code to {action}: {code}\n\n"
            "The code expires in 10 minutes. If you did not request it, ignore this email."
        ),
    }
    request = Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError(f"Email delivery failed with HTTP {response.status}.")
    except HTTPError as error:
        raise RuntimeError(f"Email delivery failed with HTTP {error.code}.") from error
    except (TimeoutError, URLError) as error:
        raise RuntimeError("Email delivery failed. Check the Resend connection and try again.") from error
