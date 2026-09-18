"""
Pluggable email sending for the magic-link flow — Fix Plan Part 3, §1.

The legacy `/api/v1/auth/magic-link` endpoint (still present in
routers/auth.py, still used by most of this backend's own test suite as
a signup shortcut) issues a session token immediately, with no email
step at all — clearly documented there as a simulation. The
`/magic-link/request` + `/magic-link/verify` pair added alongside it is
the REAL flow: a one-time link is generated and "sent" through an
adapter, and a session token is only ever issued when that link is
actually redeemed.

No email provider is configured in this environment — no SendGrid/
Postmark API key, and no guarantee of an outbound network path to one.
That's a constraint of the sandbox this was built in, not a design
choice, and it's exactly why this is one small, swappable interface
instead of an inline `requests.post(...)` call buried in the router:
everything upstream of "actually deliver an email" (token generation,
hashed-at-rest storage, expiry, single-use redemption) is real. Wiring a
real provider later means writing one adapter class here and pointing
EMAIL_PROVIDER at it — not touching the auth flow itself.
"""
from abc import ABC, abstractmethod
import logging

logger = logging.getLogger("inspeckt.email")


class EmailAdapter(ABC):
    @abstractmethod
    def send_magic_link(self, to_email: str, link_url: str) -> None:
        """Send (or, for a dev adapter, surface) a one-time sign-in link."""
        raise NotImplementedError

    @abstractmethod
    def send_lead_notification(self, lead: "LeadNotification") -> None:
        """Notify the consultant team that a founder needs a human —
        every AI-to-human hand-off in the product (routers/leads.py) goes
        through this. Same reasoning as send_magic_link above: this is
        the one thing standing between "a founder asked for help" and
        "nobody finds out until someone happens to query the leads
        table" — see routers/leads.py's own comment on why a delivery
        failure here must never fail the API call that created the lead."""
        raise NotImplementedError


class LeadNotification:
    """Plain data carrier so adapters don't need to import the SQLAlchemy
    Lead model (keeps this module free of a DB dependency, same as
    send_magic_link takes plain strings rather than a User row)."""

    def __init__(self, kind, contact_name=None, contact_email=None, contact_phone=None,
                 company_name=None, message=None, lead_id=None):
        self.kind = kind
        self.contact_name = contact_name
        self.contact_email = contact_email
        self.contact_phone = contact_phone
        self.company_name = company_name
        self.message = message
        self.lead_id = lead_id


class ConsoleEmailAdapter(EmailAdapter):
    """Default adapter (EMAIL_PROVIDER=console). Logs the link instead of
    sending it, so the flow is fully testable and demoable with zero
    external credentials. Also appends every "sent" link to
    `sent_links` — a small in-process list a test, or a developer poking
    at the API directly, can read instead of grepping logs. Lead
    notifications get the same treatment via `sent_notifications`."""

    def __init__(self):
        self.sent_links = []
        self.sent_notifications = []

    def send_magic_link(self, to_email: str, link_url: str) -> None:
        self.sent_links.append({"to": to_email, "link": link_url})
        logger.info("Magic link for %s: %s", to_email, link_url)
        print(f"[email:console] Magic link for {to_email}: {link_url}")

    def send_lead_notification(self, lead: "LeadNotification") -> None:
        self.sent_notifications.append(lead.__dict__)
        logger.info("Lead notification (%s): %s", lead.kind, lead.__dict__)
        print(f"[email:console] Lead notification ({lead.kind}) from {lead.contact_email or 'no email given'}: {lead.message!r}")


class UnconfiguredProviderEmailAdapter(EmailAdapter):
    """What an unrecognized EMAIL_PROVIDER value resolves to. Fails loudly
    at send time instead of silently pretending to deliver — dropping a
    real sign-in email (or a consultant hand-off notification) on the
    floor without an error would be worse than this exception."""

    def __init__(self, provider_name: str):
        self.provider_name = provider_name

    def _unconfigured(self, method_name: str):
        raise NotImplementedError(
            f"EMAIL_PROVIDER={self.provider_name!r} is set but no adapter is implemented for it. "
            f"Add a class here implementing EmailAdapter ({method_name} — see ConsoleEmailAdapter "
            "or ResendEmailAdapter above for the shape), call the provider's SDK/API from it, add "
            "its API key to app/config.py (read from an environment variable, the way JWT_SECRET "
            "already is), and register the provider name in get_email_adapter() below."
        )

    def send_magic_link(self, to_email: str, link_url: str) -> None:
        self._unconfigured("send_magic_link(to_email, link_url)")

    def send_lead_notification(self, lead: "LeadNotification") -> None:
        self._unconfigured("send_lead_notification(lead)")


class ResendEmailAdapter(EmailAdapter):
    """Real provider (EMAIL_PROVIDER=resend) using Resend's HTTP API
    (https://resend.com/docs/api-reference/emails/send-email) — chosen
    because it needs no SDK dependency beyond the `httpx` this backend
    already requires, and its API is a single POST with a bearer token.
    Never constructed until EMAIL_PROVIDER=resend AND RESEND_API_KEY is
    set (see get_email_adapter() below); a missing API key at that point
    is a deployment misconfiguration, so it fails loudly at send time
    rather than silently swallowing the error, matching
    UnconfiguredProviderEmailAdapter's philosophy above.

    NOT exercised by this backend's test suite against the real Resend
    API (that would require live network access and a real account) —
    only ConsoleEmailAdapter is used in tests. Verify this class against
    a real RESEND_API_KEY once one is available before relying on it in
    production; do not assume it works untested."""

    _API_URL = "https://api.resend.com/emails"

    def __init__(self, api_key: str, from_email: str, consultant_notify_email: str = None):
        if not api_key:
            raise RuntimeError("EMAIL_PROVIDER=resend requires RESEND_API_KEY to be set.")
        if not from_email:
            raise RuntimeError("EMAIL_PROVIDER=resend requires RESEND_FROM_EMAIL to be set.")
        self.api_key = api_key
        self.from_email = from_email
        self.consultant_notify_email = consultant_notify_email

    def _send(self, to_email: str, subject: str, html: str) -> None:
        import httpx
        resp = httpx.post(
            self._API_URL,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"from": self.from_email, "to": [to_email], "subject": subject, "html": html},
            timeout=10.0,
        )
        resp.raise_for_status()

    def send_magic_link(self, to_email: str, link_url: str) -> None:
        self._send(
            to_email,
            "Your Inspeckt sign-in link",
            f'<p>Click to sign in: <a href="{link_url}">{link_url}</a></p>'
            f"<p>This link expires shortly and can only be used once. If you didn't request this, ignore this email.</p>",
        )

    def send_lead_notification(self, lead: "LeadNotification") -> None:
        if not self.consultant_notify_email:
            raise RuntimeError("EMAIL_PROVIDER=resend requires CONSULTANT_NOTIFY_EMAIL to be set to deliver lead notifications.")
        body = (
            f"<p><strong>Kind:</strong> {lead.kind}</p>"
            f"<p><strong>Contact:</strong> {lead.contact_name or '—'} "
            f"({lead.contact_email or 'no email'}, {lead.contact_phone or 'no phone'})</p>"
            f"<p><strong>Company:</strong> {lead.company_name or '—'}</p>"
            f"<p><strong>Message:</strong> {lead.message or '—'}</p>"
            f"<p><strong>Lead ID:</strong> {lead.lead_id or '—'}</p>"
        )
        self._send(self.consultant_notify_email, f"New Inspeckt lead — {lead.kind}", body)


_adapter_instance = None


def get_email_adapter() -> EmailAdapter:
    """Process-wide singleton so ConsoleEmailAdapter's `sent_links`/
    `sent_notifications` are one stable place to look across a request,
    rather than a fresh empty list on every call."""
    global _adapter_instance
    if _adapter_instance is None:
        from app.config import settings
        provider = settings.EMAIL_PROVIDER
        if provider == "console":
            _adapter_instance = ConsoleEmailAdapter()
        elif provider == "resend":
            _adapter_instance = ResendEmailAdapter(
                settings.RESEND_API_KEY, settings.RESEND_FROM_EMAIL, settings.CONSULTANT_NOTIFY_EMAIL
            )
        else:
            _adapter_instance = UnconfiguredProviderEmailAdapter(provider)
    return _adapter_instance


def reset_email_adapter() -> None:
    """Test helper — forces the next get_email_adapter() call to build a
    fresh adapter (a fresh, empty ConsoleEmailAdapter.sent_links)."""
    global _adapter_instance
    _adapter_instance = None
