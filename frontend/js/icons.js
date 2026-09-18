/**
 * Small inline icon set — line icons, single source of truth, used
 * instead of emoji throughout the app. 20x20 viewBox, 1.6 stroke,
 * currentColor so they inherit whatever text color they're placed in.
 */
export const ICONS = {
  flask: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5h4M8.4 2.5v4.8L4 15.2a1.5 1.5 0 0 0 1.3 2.3h9.4a1.5 1.5 0 0 0 1.3-2.3l-4.4-7.9V2.5"/><path d="M6.3 12.5h7.4"/></svg>`,
  tag: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 2.8H4.6a1.8 1.8 0 0 0-1.8 1.8v6l8.1 8.1a1.8 1.8 0 0 0 2.5 0l4.9-4.9a1.8 1.8 0 0 0 0-2.5z"/><circle cx="7.3" cy="7.3" r="1.3"/></svg>`,
  thermometer: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 11.2V4.3a1.5 1.5 0 0 0-3 0v6.9a3.2 3.2 0 1 0 3 0Z"/></svg>`,
  warning: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.3 2.6 16.4h14.8Z"/><path d="M10 8.2v3.6"/><circle cx="10" cy="14" r="0.15" fill="currentColor" stroke-width="1"/></svg>`,
  clock: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.2"/><path d="M10 6v4.2l2.8 1.8"/></svg>`,
  plus: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>`,
  clipboard: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="3.8" width="11" height="14" rx="1.6"/><path d="M7.5 3.3h5a.9.9 0 0 1 .9.9v1H6.6v-1a.9.9 0 0 1 .9-.9Z"/><path d="M7.3 9.5h5.4M7.3 12.3h5.4M7.3 15.1h3.2"/></svg>`,
  search: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.8" cy="8.8" r="5.3"/><path d="M17 17l-3.8-3.8"/></svg>`,
  message: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.8h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8.2L4 18.2V14.8H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/></svg>`,
  certificate: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7.5" r="4.3"/><path d="M7.4 11.2 6 18l4-2.2 4 2.2-1.4-6.8"/></svg>`,
  users: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.2" cy="6.8" r="2.6"/><path d="M2.4 17c0-3 2.1-5 4.8-5s4.8 2 4.8 5"/><circle cx="14.6" cy="7.6" r="2.1"/><path d="M13 12.2c2 .2 3.6 1.9 3.6 4.3"/></svg>`,
  shield: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5 16.5 5v5.2c0 4-2.8 6.6-6.5 7.8-3.7-1.2-6.5-3.8-6.5-7.8V5Z"/><path d="M7.3 9.8l1.9 1.9 3.5-3.9"/></svg>`,
  arrowRight: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h12M11 5l5 5-5 5"/></svg>`,
  layers: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.8 17.2 7 10 11.2 2.8 7Z"/><path d="M2.8 10.6 10 14.8l7.2-4.2"/><path d="M2.8 14.2 10 18.4l7.2-4.2"/></svg>`,
  compass: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.3"/><path d="m12.6 7.4-1.6 4.2-4.2 1.6 1.6-4.2z"/></svg>`,
  checkCircle: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.3"/><path d="m6.8 10.2 2.1 2.1 4.3-4.6"/></svg>`,
  menu: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg>`,
  close: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>`,
};

export function icon(name, size = 18) {
  return `<span class="icon-inline" style="width:${size}px;height:${size}px">${ICONS[name] || ""}</span>`;
}

/** Fills every `[data-icon]` element in the document with its SVG.
 *  Used on static pages (index.html, app.html) that can't easily
 *  build the icon markup ahead of time. */
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.getAttribute("data-icon");
    if (ICONS[name]) el.innerHTML = ICONS[name];
  });
}
