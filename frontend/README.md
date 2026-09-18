# Inspeckt — frontend

A self-contained, no-build web app for FSSAI compliance — a platform, not
a dairy-only tool (see `../PLATFORM_PLAN_V2.md`). Dairy is the only live
platform category today; within it, Milk, Paneer, Cheese, Ghee/Butter,
Milk Powder and Yogurt/Dahi are checkable (Ghee/Butter, Milk Powder and
Yogurt/Dahi are composition-only — no microbiology panel yet), and the
rest of Dairy's own sub-categories (Ice Cream/Frozen Dessert) show as
"Coming soon" alongside every other FSSAI category on the homepage. No
server required — everything runs in the browser; submissions,
formulation drafts, and leads are all stored in `localStorage`.

## Run it locally

Any static file server works — there's no build step.

```bash
python3 -m http.server 8000
# open http://localhost:8000/index.html
```

or `npx serve .`, or just open `index.html` directly in a browser (module
imports need `http(s)://`, not `file://`, in most browsers — use a server).

## Deploy it

It's plain HTML/CSS/JS, so any static host works: Netlify, Vercel, GitHub
Pages, S3+CloudFront, or `python3 -m http.server` on an internal machine.
Point the host at this folder; `index.html` is the entry point.

## Structure

```
index.html          Landing / marketing page — platform-wide positioning
login.html            Log in (magic-link style, no password)
signup.html             Create account (email + business name + FSSAI license)
app.html                  Dashboard shell (new submission / Formulation Lab / history / results)
pricing.html                Pricing ladder (Starter / Mid / Higher / Full Consultation)
consult.html                   Human hand-off intake (doesn't-fit / license / custom bundle / escalation)
research.html                     Research-vs-formulation fork — FSSAI's own category definition,
                                   self-serve, before signup or a consult form (review item C17)

css/
  tokens.css              Design tokens: colour, type, spacing, shadow
  base.css                 Reset + base typography
  components.css            Buttons, cards, forms, badges, nav, report rows
  pages.css                  Page-specific layout (hero, dashboard, auth split, pricing, entry point)

js/
  data/dairyBible.js          FSSAI composition/microbiology/labelling data + platform category taxonomy
  data/pricing.js               Pricing ladder data
  validation.js                   The compliance-checking logic (+ scoreFormulation for the Lab)
  icons.js                         Small inline-SVG icon set (no emoji)
  auth.js                           localStorage-based identity (NOT real auth — magic-link simulated)
  storage.js                         localStorage-based submission history
  formulations.js                      localStorage-based Formulation Lab
  leads.js                              localStorage-based human hand-off capture
  ui/
    landing.js, auth-pages.js, dashboard.js, report.js, pricing-page.js, intake.js, research.js
```

## This is not real authentication

`js/auth.js` stores accounts and passwords in `localStorage`, in plain
text, with no server round-trip. It exists so a submission can be
attributed to a name/company and so the dashboard has something to
welcome you back to — not to keep anyone out. Don't point it at anything
that needs real access control.

The `/backend` folder next to this one has a real FastAPI + JWT + bcrypt
implementation. Wiring the frontend up to it means replacing `auth.js` and
`storage.js` with `fetch()` calls to `/api/v1/auth/*` and
`/api/v1/submissions` — the rest of the app (forms, results rendering)
doesn't need to change.

## Adding a new product category

1. Add composition/microbiology/labelling data for it in
   `js/data/dairyBible.js` (and set `live: true` in `CATEGORIES`).
2. Add its composition fields to `compositionSection()` in
   `js/ui/dashboard.js` (and the matching function in
   `build/demo-controller.js` if you rebuild the live-preview bundle).

`validation.js` and `report.js` are generic — they read from the data
module, so a well-formed category needs no changes there.

## Regulatory accuracy

The composition numbers here follow `INSPECKT_DAIRY_BIBLE_MASTER.md`,
which is more detailed and regulation-cited than the original build spec
and prototype — and disagrees with them on a few figures (Buffalo Milk
minimum fat, Mozzarella's limits, the paneer fat bands). See the root
`README.md` and `backend/README.md` for the specific corrections. These
still need Dipta's regulatory sign-off before any of this is used to make
a real release decision — the app says so on every report.
