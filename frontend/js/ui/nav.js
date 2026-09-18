/**
 * Mobile nav toggle — shared across index.html, pricing.html, and
 * consult.html. Builds the toggle button + slide-down menu from
 * whatever .nav-links/.nav-actions links already exist on the page, so
 * each page's own link set is mirrored automatically rather than
 * hard-coded here.
 *
 * Previously .nav-links (and, below 420px, the "Log in" link too) were
 * simply `display: none` under 780px with nothing to replace them —
 * Pricing, Categories and Log in were unreachable from the header on a
 * phone. This restores all of them behind a hamburger menu.
 */
import { ICONS } from "../icons.js";

const inner = document.querySelector(".topnav-inner");
const header = document.querySelector(".topnav");

if (inner && header) {
  const navLinks = [...inner.querySelectorAll(".nav-links a")];
  const actionLinks = [...inner.querySelectorAll(".nav-actions a")];
  const allLinks = [...navLinks, ...actionLinks];

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nav-toggle";
  toggle.id = "nav-toggle";
  toggle.setAttribute("aria-label", "Menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = `<span class="icon-inline" style="width:18px;height:18px">${ICONS.menu}</span>`;
  inner.querySelector(".nav-actions")?.appendChild(toggle);

  const menu = document.createElement("nav");
  menu.className = "nav-mobile-menu";
  menu.id = "nav-mobile-menu";
  menu.setAttribute("aria-label", "Primary, mobile");
  menu.innerHTML = allLinks.map((a) => `<a href="${a.getAttribute("href")}">${a.textContent}</a>`).join("");
  header.appendChild(menu);

  const setOpen = (open) => {
    menu.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.innerHTML = `<span class="icon-inline" style="width:18px;height:18px">${open ? ICONS.close : ICONS.menu}</span>`;
  };
  toggle.addEventListener("click", () => setOpen(!menu.classList.contains("open")));
  menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
}
