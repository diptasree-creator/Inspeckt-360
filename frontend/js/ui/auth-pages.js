import { signIn, signUp, getCurrentUser } from "../auth.js";

// If the visitor already typed a product description on the homepage
// before landing here, carry it through to the dashboard so it isn't
// lost — see js/ui/landing.js for where this gets set.
const params = new URLSearchParams(location.search);
const prefillQ = params.get("q");
// "next" carries the homepage triage's "I'm already formulating" intent
// through signup/login straight to the Formulation Lab, instead of
// dropping a signed-up visitor on the generic New Submission screen
// they didn't ask for — see landing.js's triage click handler.
const nextRoute = params.get("next");
const destAfterAuth = "app.html" + (prefillQ ? `?q=${encodeURIComponent(prefillQ)}` : "") + (nextRoute ? `#/${nextRoute}` : "");

// If already logged in, no reason to see the auth pages.
if (getCurrentUser()) {
  window.location.replace(destAfterAuth);
}

function showAlert(message, kind = "danger") {
  const el = document.getElementById("form-alert");
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${kind}" style="margin-bottom: var(--space-4)">${message}</div>`;
}

function setBusy(btn, busy, idleLabel) {
  btn.disabled = busy;
  btn.innerHTML = busy ? '<span class="spinner"></span> Signing in…' : idleLabel;
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("login-submit");
    const idle = btn.textContent;
    setBusy(btn, true, idle);
    try {
      await signIn({ email: document.getElementById("email").value.trim() });
      window.location.href = destAfterAuth;
    } catch (err) {
      showAlert(err.message);
      setBusy(btn, false, idle);
    }
  });
}

const signupForm = document.getElementById("signup-form");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("signup-submit");
    const idle = btn.textContent;
    setBusy(btn, true, idle);
    try {
      await signUp({
        name: document.getElementById("name").value.trim(),
        company: document.getElementById("company").value.trim(),
        license: document.getElementById("license").value.trim(),
        email: document.getElementById("email").value.trim(),
      });
      window.location.href = destAfterAuth;
    } catch (err) {
      showAlert(err.message);
      setBusy(btn, false, idle);
    }
  });
}
