"""
Inspeckt — automated label scan endpoint (real code, NOT wired up to the
frontend anywhere in this build).

Why this file exists: you asked for the Label Check flow to work the way
labelveda.com's does — upload your label (front/back/all sides), the
system scans it automatically, and you get an instant result instead of
ticking a checklist by hand yourself. That's a real, buildable feature —
this is the real, working code for it. It follows the exact same
three-precondition pattern as app/routers/lab_reports.py, for the exact
same reason: the published demo (dist-inspeckt-site.html) is one static
HTML file with no server, so it cannot call a vision-AI service without
shipping a secret API key in client-side JavaScript that anyone could
read out of the page source. This needs:

  1. This FastAPI app actually deployed somewhere reachable, and
  2. ANTHROPIC_API_KEY (see app/config.py) set to a real key there, and
  3. A real frontend pointed at that deployment instead of running
     everything client-side against localStorage.

Until all three are true, this endpoint returns a clear 501 rather than
pretending to have scanned a label it never saw.

WHAT THIS ENDPOINT DOES AND DOESN'T DO — read before wiring it up.
A vision-capable model reading a photo can tell you, with real
confidence, whether a given label element is PRESENT and LEGIBLE, and
transcribe the text it finds. It cannot reliably measure calibrated
physical quantities from a photo — exact font size in mm, precise
symbol placement against the regulation's stated minimums — the way a
device with a real ruler/reference scale could. LabelVeda's marketing
copy claims format/placement checking; this endpoint is honest about
the actual boundary: it extracts PRESENCE + TEXT + a qualitative
legibility note per element, nothing more. The pass/fail COMPLIANCE
VERDICT is still computed the same way it is everywhere else in this
app — by validation_engine.py's deterministic `_run_labelling()`
reading the same LABEL_ELEMENTS_ALL/LABEL_ELEMENTS_BY_CATEGORY schema —
never asserted directly by the model. That keeps this feature inside
the one rule the whole app is built on: never state a compliance result
that isn't backed by a real, traceable check.
"""
import base64
import json
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.config import settings
from app.dairy_bible import LABEL_ELEMENTS_ALL, LABEL_ELEMENTS_BY_CATEGORY

router = APIRouter(prefix="/api/v1/label-checks", tags=["label-checks"])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # per file
MAX_FILES = 6  # front/back/sides/nutrition-panel close-up — generous, not unbounded
ALLOWED_TYPES = ("application/pdf", "image/jpeg", "image/png", "image/webp")


def _elements_for(category: str) -> list[dict]:
    return LABEL_ELEMENTS_ALL + LABEL_ELEMENTS_BY_CATEGORY.get(category, [])


def _extraction_prompt(elements: list[dict]) -> str:
    element_list = "\n".join(f'- key: "{e["key"]}" — {e["label"]}' for e in elements)
    return f"""You are looking at one or more photos/scans of a single food product's
packaging (possibly multiple sides of the same package — front, back,
nutrition panel close-up). Check for exactly these label elements:

{element_list}

Return ONLY a single JSON object (no prose, no markdown fences) with this
shape:

{{
  "elements": [
    {{
      "key": string,               // must exactly match one of the keys above — include EVERY key, once each
      "detected": boolean,         // true only if you can actually see this element, legibly, in the image(s)
      "extracted_text": string | null,  // the actual text/value found, transcribed as printed — null if not detected
      "confidence": "high" | "medium" | "low",
      "note": string | null        // optional: a plain qualitative observation (e.g. "text very small, hard to read") — never a measured value
    }}
  ]
}}

Rules:
- "detected": true means you can actually see that element on the
  packaging in front of you — never mark something detected because it's
  normally required or because a similar product usually has it. If
  you're not sure, use "confidence": "low" rather than guessing true.
- "extracted_text" must be transcribed exactly as printed — never
  invent, complete, or correct text you can't fully read; if part of it
  is illegible, transcribe what you can and say so in "note".
- You are NOT being asked to judge font size in millimetres, exact
  symbol placement, or any other calibrated physical measurement — you
  cannot do that reliably from a photo. If something looks conspicuously
  too small or oddly placed, say so in "note" as a qualitative
  observation only, not a pass/fail judgment.
- Include every key from the list above exactly once, even if you found
  nothing for it (detected: false, extracted_text: null in that case)."""


class LabelElementScanResult(BaseModel):
    key: str
    label: str
    detected: bool
    extracted_text: Optional[str] = None
    confidence: str = "low"
    note: Optional[str] = None


class LabelScanOut(BaseModel):
    category: str
    elements: List[LabelElementScanResult]
    declared_count: int
    total_count: int
    # Explicit, so a caller never mistakes "we found nothing" for "we
    # never actually ran the scan" — every real response sets this true.
    scan_ran: bool = True
    disclaimer: str = (
        "This scan extracted which elements are present and legible, and "
        "transcribed their text — it did not measure font size, symbol "
        "placement, or any other calibrated physical quantity, and it is "
        "not itself the compliance verdict. The pass/fail result for each "
        "element is computed separately by the same deterministic check "
        "every other Inspeckt result uses (see validation_engine.py's "
        "_run_labelling()), reading this scan's detected/not-detected "
        "answers as input."
    )


@router.post("/scan", response_model=LabelScanOut)
async def scan_label(category: str = Form(...), files: List[UploadFile] = File(...)):
    """Reads 1+ uploaded label photos/scans with a vision-capable model and
    returns, per required label element for this category, whether it was
    detected and what text was found. Requires ANTHROPIC_API_KEY — see the
    module docstring above for why this can't run from the static demo
    link directly, and for the real boundary of what this endpoint can
    and can't determine from a photo."""
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "Automated label scanning isn't configured on this deployment — "
                "ANTHROPIC_API_KEY is unset. This is a real, working endpoint, "
                "not a placeholder, but it needs a real API key before it can "
                "actually read a photo. See backend/README.md's 'Automated "
                "label scan' section."
            ),
        )
    elements = _elements_for(category)
    if not elements:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Unknown or unsupported category: {category!r}")
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="At least one label photo or scan is required.")
    if len(files) > MAX_FILES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"At most {MAX_FILES} files per scan.")

    content_blocks = []
    for f in files:
        if f.content_type not in ALLOWED_TYPES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Unsupported file type: {f.content_type}")
        raw = await f.read()
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"{f.filename} exceeds {MAX_UPLOAD_BYTES // (1024*1024)} MB limit.")
        media_type = f.content_type
        block_type = "document" if media_type == "application/pdf" else "image"
        content_blocks.append({"type": block_type, "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(raw).decode("ascii")}})

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
    prompt_text = _extraction_prompt(elements)

    try:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=2048,
            messages=[{"role": "user", "content": [*content_blocks, {"type": "text", "text": prompt_text}]}],
        )
        text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="The scanning model didn't return valid JSON — try again, or tick the checklist manually.") from exc
    except Exception as exc:  # noqa: BLE001 - surface the provider's own error message to the caller
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"Scan request failed: {exc}") from exc

    by_key = {row.get("key"): row for row in parsed.get("elements", []) if isinstance(row, dict)}
    label_lookup = {e["key"]: e["label"] for e in elements}
    results = []
    for e in elements:
        row = by_key.get(e["key"], {})
        results.append(LabelElementScanResult(
            key=e["key"],
            label=label_lookup[e["key"]],
            detected=bool(row.get("detected", False)),
            extracted_text=row.get("extracted_text"),
            confidence=row.get("confidence") or "low",
            note=row.get("note"),
        ))

    declared_count = sum(1 for r in results if r.detected)
    return LabelScanOut(category=category, elements=results, declared_count=declared_count, total_count=len(results))
