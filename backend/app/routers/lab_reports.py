"""
Inspeckt — NABL lab-report extraction endpoint (real code, NOT wired up
to the frontend anywhere in this build).

Why this file exists: the published demo (dist-inspeckt-site.html) is a
single static HTML file with no server behind it — it cannot call an
OCR/document-AI service without embedding a secret API key in
client-side JavaScript, which anyone could read out of the page source
and abuse on your account's dime. Real PDF extraction has to happen on
a real backend, with the key held server-side. This file is that
backend piece — written and ready, but only useful once:

  1. This FastAPI app is actually deployed somewhere reachable (Render,
     Railway, your own server — anywhere with a stable URL), and
  2. ANTHROPIC_API_KEY (see app/config.py) is set to a real key there, and
  3. The frontend (wherever it ends up living, once it's more than a
     demo Artifact) is pointed at that deployment's URL instead of
     running everything client-side against localStorage.

Until all three are true, calling this endpoint returns a clear 501
explaining exactly what's missing — it never pretends to have read a
file it didn't actually read. See backend/README.md's "Lab report
extraction" section for the full reasoning, including why automated
NABL accreditation verification is a best-effort feature at most (no
official NABL API exists — see verify_lab() below).
"""
import base64
import json
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.config import settings

router = APIRouter(prefix="/api/v1/lab-reports", tags=["lab-reports"])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB — generous for a scanned report, small enough to hold in memory here

# What we ask the model to pull out, and nothing more. Every field is
# nullable in the response — a field the report doesn't contain (or
# that the model can't read confidently) comes back null, never guessed.
EXTRACTION_SCHEMA_PROMPT = """You are extracting structured data from a NABL laboratory test report (an
Indian food-testing lab report). Read the attached document and return ONLY a
single JSON object (no prose, no markdown fences) with exactly this shape:

{
  "laboratory_name": string | null,
  "nabl_accreditation_number": string | null,
  "report_number": string | null,
  "report_date": string | null,           // as printed, don't reformat
  "sample_or_product_name": string | null,
  "sample_id": string | null,
  "test_results": [
    {
      "parameter": string,                // e.g. "Milk Fat", "Aerobic Plate Count"
      "result": string,                   // as printed, e.g. "6.2", "Absent", "<10"
      "unit": string | null,
      "test_method": string | null,
      "detection_limit": string | null
    }
  ]
}

Rules:
- If you cannot find a field, use null (for test_results, omit that row rather
  than inventing one) — never fabricate a value that isn't actually printed on
  the document.
- Transcribe numbers and units exactly as printed; do not convert units or
  round numbers.
- If the document is not a lab report at all, return every top-level field as
  null and an empty test_results array."""


class TestResultOut(BaseModel):
    parameter: str
    result: str
    unit: Optional[str] = None
    test_method: Optional[str] = None
    detection_limit: Optional[str] = None


class LabReportExtractionOut(BaseModel):
    laboratory_name: Optional[str] = None
    nabl_accreditation_number: Optional[str] = None
    report_number: Optional[str] = None
    report_date: Optional[str] = None
    sample_or_product_name: Optional[str] = None
    sample_id: Optional[str] = None
    test_results: list[TestResultOut] = []
    # Explicit, so a caller never mistakes "we didn't find this field" for
    # "we didn't run extraction at all" — every real response sets this true.
    extraction_ran: bool = True


@router.post("/extract", response_model=LabReportExtractionOut)
async def extract_lab_report(file: UploadFile = File(...)):
    """Reads an uploaded PDF/image lab report with a vision-capable model and
    returns whatever structured fields it can confidently find. Requires
    ANTHROPIC_API_KEY to be configured — see the module docstring above for
    why this can never run from the static demo link directly."""
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "Lab report extraction isn't configured on this deployment — "
                "ANTHROPIC_API_KEY is unset. This is a real, working endpoint, "
                "not a placeholder, but it needs a real API key before it can "
                "actually read a document. See backend/README.md's 'Lab report "
                "extraction' section."
            ),
        )
    if file.content_type not in ("application/pdf", "image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Unsupported file type: {file.content_type}")

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"File exceeds {MAX_UPLOAD_BYTES // (1024*1024)} MB limit.")

    # Lazy import: `anthropic` is an optional dependency (see
    # requirements.txt's comment) — a deployment that never sets
    # ANTHROPIC_API_KEY shouldn't need it installed at all, and the 501
    # above already short-circuits before this line runs in that case.
    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover - exercised only when the optional dep is missing
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            detail="ANTHROPIC_API_KEY is set but the `anthropic` package isn't installed — run `pip install anthropic`.",
        ) from exc

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    media_type = "application/pdf" if file.content_type == "application/pdf" else file.content_type
    doc_block = (
        {"type": "document", "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(raw).decode("ascii")}}
        if media_type == "application/pdf"
        else {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(raw).decode("ascii")}}
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=2048,
            messages=[{"role": "user", "content": [doc_block, {"type": "text", "text": EXTRACTION_SCHEMA_PROMPT}]}],
        )
        text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="The extraction model didn't return valid JSON — try again, or enter the values manually.") from exc
    except Exception as exc:  # noqa: BLE001 - surface the provider's own error message to the caller
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"Extraction request failed: {exc}") from exc

    return LabReportExtractionOut(**parsed, extraction_ran=True)


class LabVerificationRequest(BaseModel):
    laboratory_name: str
    nabl_accreditation_number: Optional[str] = None


class LabVerificationOut(BaseModel):
    status: str  # "manual_verification_required" — see note
    note: str
    search_url: str


@router.post("/verify-lab", response_model=LabVerificationOut)
def verify_lab(payload: LabVerificationRequest):
    """Deliberately does NOT claim to verify anything automatically.

    NABL (under QCI) publishes no official API or open-data feed for
    accreditation status — only a manual HTML search form
    (https://nablwp.qci.org.in/laboratorysearchone) and periodic static PDF
    directories. Scraping that form is possible but unofficial, with no
    ToS/rate-limit guarantee and no stable request contract to build
    against reliably — exactly the "fragile, best-effort, not guaranteed"
    category this app doesn't ship silently. This endpoint instead hands
    back the real search tool so a human can do the one-click check
    themselves, rather than a green checkmark this codebase can't actually
    back up."""
    return LabVerificationOut(
        status="manual_verification_required",
        note=(
            f"Automated NABL verification isn't available — there's no official NABL API. "
            f"Search for '{payload.laboratory_name}' on NABL's own accredited-laboratory search "
            "to confirm accreditation status before relying on this report."
        ),
        search_url="https://nablwp.qci.org.in/laboratorysearchone",
    )
