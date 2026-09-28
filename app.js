"use strict";

const $ = (s, el = document) => el.querySelector(s);
// Site-ul public (GitHub Pages): fără server, datele vin din data/*.json prin static-api.js
const STATIC = !!window.STATIC_SITE;
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const MONTHS = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec"];
const WDAYS = ["dum", "lun", "mar", "mie", "joi", "vin", "sâm"];
const ORIGIN_NAMES = { TSR: "Timișoara", BUD: "Budapesta", OMR: "Oradea", CLJ: "Cluj-Napoca" };
const FLAGS = {
  SUB_MEDIE: { icon: "📉", label: "Mult sub prețul obișnuit", hot: true },
  MINIM: { icon: "🏆", label: "Cel mai mic preț văzut", hot: true },
  SCADERE: { icon: "⬇️", label: "Preț scăzut recent", hot: true },
  SUPER: { icon: "🔥", label: "Super ieftin" },
  LAST_MINUTE: { icon: "⏰", label: "Last minute" },
};

const state = {
  tab: "deals", origin: "ALL", trip: "ALL", max: "", q: "", sort: "score", days: 10,
  dep: "", ret: "", flex: 0, search: [], searchLoading: false, exotic: null, exRegion: "ALL",
  status: null, deals: [], lm: [], dest: [], posts: [], lastScanId: null, wasRunning: false,
};

/* ---------- datele călătoriei ---------- */
function isoAdd(iso, n) {
  const d = d0(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateWindow() {
  if (!state.dep) return null;
  const f = state.flex;
  const w = { depFrom: isoAdd(state.dep, -f), depTo: isoAdd(state.dep, f), retFrom: "", retTo: "" };
  if (w.depFrom < todayIso()) w.depFrom = todayIso();
  if (state.ret) { w.retFrom = isoAdd(state.ret, -f); w.retTo = isoAdd(state.ret, f); }
  return w;
}
function datesInvalid() { return state.dep && state.ret && state.ret < state.dep; }
function datesLabel() {
  if (!state.dep) return "";
  const fx = state.flex ? ` (±${state.flex} ${state.flex === 1 ? "zi" : "zile"})` : "";
  return state.ret ? `${fmtDate(state.dep)} → ${fmtDate(state.ret)}${fx}` : `${fmtDate(state.dep)}${fx}, doar dus`;
}

/* ---------- utilitare ---------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function d0(iso) { return new Date(iso.slice(0, 10) + "T00:00:00"); }
function fmtDate(iso, withDay = true) {
  if (!iso) return "";
  const d = d0(iso);
  const s = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withDay ? `${WDAYS[d.getDay()]} ${s}` : s;
}
function eur(v) {
  if (v == null) return "–";
  return (v < 100 ? v.toFixed(2).replace(".", ",") : Math.round(v).toLocaleString("ro-RO")) + " €";
}
function fmtLei(v) {
  if (v == null) return "–";
  return v.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " lei";
}
function lei(vEur) { return fmtLei(vEur * (state.status?.eur_ron || 5)); }
function bnrLabel() {
  const f = state.status?.fx;
  return f?.date ? `cursul BNR din ${fmtDate(f.date, false)} (1 € = ${f.eur_ron.toLocaleString("ro-RO", { minimumFractionDigits: 4 })} lei)` : "cursul BNR";
}
function leiSpan(r) {
  const v = r.price_ron ?? (r.price_eur * (state.status?.eur_ron || 5));
  const title = r.lei_exact ? "Prețul oficial în lei al companiei aeriene" : `Convertit la ${bnrLabel()}`;
  return `<span class="lei num" title="${esc(title)}">${fmtLei(v)}${r.lei_exact ? " ✓" : ""}</span>`;
}
function inDays(n) {
  if (n <= 0) return "azi";
  if (n === 1) return "mâine";
  return `în ${n} zile`;
}
function ago(ts) {
  if (!ts) return "";
  const m = Math.round((Date.now() - new Date(ts.replace(" ", "T")).getTime()) / 60000);
  if (m < 1) return "acum";
  if (m < 60) return `acum ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `acum ${h} ${h === 1 ? "oră" : "ore"}`;
  const d = Math.round(h / 24);
  return `acum ${d} ${d === 1 ? "zi" : "zile"}`;
}
function hhmm(ts) { return ts ? ts.slice(11, 16) : ""; }
function tripLabel(r) { return r.trip === "RT" ? "dus-întors" : "dus"; }
function whenText(r) {
  if (r.trip === "RT") return `${fmtDate(r.dep_date)} → ${fmtDate(r.ret_date)} · ${r.nights} ${r.nights === 1 ? "noapte" : "nopți"}`;
  return `${fmtDate(r.dep_date)}${r.dep_time ? " · " + r.dep_time : ""}`;
}
async function api(path) {
  if (STATIC) return window.staticApi(path);
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function post(path) {
  const r = await fetch(path, { method: "POST", headers: { "X-Zboruri": "1" } });
  return r.json();
}
function badges(flags, isNew) {
  const out = [];
  if (isNew) out.push(`<span class="badge new">NOU</span>`);
  for (const f of (flags || "").split(",").filter(Boolean)) {
    const x = FLAGS[f];
    if (x) out.push(`<span class="badge${x.hot ? " hot" : ""}">${x.icon} ${x.label}</span>`);
  }
  return out.join("");
}

/* ---------- verificare live și ora verificării ---------- */
function checkedLabel(ts) {
  if (!ts) return "";
  const d = ts.slice(0, 10), t = ts.slice(11, 16);
  const day = d === todayIso() ? "azi" : d === isoAdd(todayIso(), -1) ? "ieri" : fmtDate(d, false);
  return `🕒 verificat ${day} la ${t}`;
}
function legsFor(r) {
  if (r.out) {
    const legs = [{ source: r.out.source, origin: r.origin, dest: r.dest, date: r.out.date }];
    if (r.back) legs.push({ source: r.back.source, origin: r.dest, dest: r.origin, date: r.back.date });
    return legs;
  }
  const legs = [{ source: r.source, origin: r.origin, dest: r.dest, date: r.dep_date }];
  if (r.ret_date) legs.push({ source: r.source, origin: r.dest, dest: r.origin, date: r.ret_date });
  return legs;
}
function verifyBtn(r) {
  if (STATIC) return "";
  const legs = legsFor(r);
  if (!legs.every(l => l.source === "wizzair" || l.source === "ryanair")) return "";
  return `<button class="btn small ghost verify" data-verify="${esc(JSON.stringify(legs))}" title="Întreabă compania acum dacă prețul e același">🔄 Verifică prețul acum</button>`;
}
function srcName(src) {
  return src === "wizzair" ? "Wizz Air" : src === "ryanair" ? "Ryanair" : src === "mixed" ? "companii" : "companie";
}
function freshness(r) {
  const src = r.source || r.out?.source;
  if (src === "aviasales" || r.out?.source === "aviasales") {
    return `<div class="fresh warn" title="Aviasales afișează prețuri găsite recent de alți utilizatori; confirmă-l pe site înainte de rezervare">ℹ️ Preț orientativ (Aviasales), verifică-l pe site</div>`;
  }
  const ts = r.last_seen || r.checked_at;
  return ts ? `<div class="fresh">${checkedLabel(ts)} direct la ${esc(srcName(src))}</div>` : "";
}
async function runVerify(btn) {
  const box = btn.closest(".card, tr, .list-row");
  let res = box.querySelector(".verify-res");
  if (!res) {
    res = document.createElement("div");
    res.className = "verify-res";
    (btn.closest("td") || box).appendChild(res);
  }
  btn.disabled = true; btn.textContent = "Se verifică…";
  res.className = "verify-res"; res.textContent = "Întreb compania…";
  try {
    const r = await fetch("/api/verify", {
      method: "POST", headers: { "X-Zboruri": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ legs: JSON.parse(btn.dataset.verify) }),
    }).then(x => x.json());
    const now = new Date().toTimeString().slice(0, 5);
    if (!r.ok) {
      res.className = "verify-res warn"; res.textContent = "Nu am putut verifica acest bilet acum. Încearcă din nou peste un minut.";
    } else if (!r.available) {
      res.className = "verify-res bad"; res.textContent = `❌ Verificat la ${now}: zborul nu mai e disponibil la această dată.`;
    } else {
      const pEl = box.querySelector(".price, .strong, .list-row .p");
      const leiEl = box.querySelector(".lei");
      if (pEl && pEl.classList.contains("p")) pEl.innerHTML = `${eur(r.price_eur)}<br><span class="muted" style="font-size:12px;font-weight:600">${fmtLei(r.price_ron)}</span>`;
      else if (pEl) pEl.textContent = eur(r.price_eur);
      if (leiEl) leiEl.textContent = fmtLei(r.price_ron) + (r.lei_exact ? " ✓" : "");
      const fresh = box.querySelector(".fresh");
      if (fresh) fresh.textContent = `🕒 verificat azi la ${now}, direct la companie`;
      if (r.changed && r.old_price_eur != null) {
        const up = r.price_eur > r.old_price_eur;
        res.className = "verify-res " + (up ? "warn" : "good");
        res.textContent = `${up ? "⚠️ S-a scumpit" : "🎉 S-a ieftinit"}: acum ${eur(r.price_eur)} · ${fmtLei(r.price_ron)} (era ${eur(r.old_price_eur)}). Verificat la ${now}.`;
      } else {
        res.className = "verify-res good";
        res.textContent = `✅ Verificat la ${now} direct la companie: ${eur(r.price_eur)} · ${fmtLei(r.price_ron)}, preț neschimbat.`;
      }
    }
  } catch (e) {
    res.className = "verify-res warn"; res.textContent = "Aplicația nu a răspuns. E pornită?";
  }
  btn.disabled = false; btn.textContent = "🔄 Verifică din nou";
}

/* ---------- filtre ---------- */
function applyFilters(rows, ignoreDates = false, ignoreTrip = false) {
  const q = state.q.trim().toLowerCase();
  const max = parseFloat(state.max);
  const w = ignoreDates || datesInvalid() ? null : dateWindow();
  return rows.filter(r =>
    (state.origin === "ALL" || r.origin === state.origin || state.tab === "exotic") &&
    (ignoreTrip || (w ? (w.retFrom ? r.trip === "RT" : true) : (state.trip === "ALL" || r.trip === state.trip))) &&
    (!max || r.price_eur <= max) &&
    (!q || `${r.dest_name} ${r.country} ${r.dest}`.toLowerCase().includes(q)) &&
    (!w || (r.dep_date >= w.depFrom && r.dep_date <= w.depTo &&
            (!w.retFrom || (r.ret_date >= w.retFrom && r.ret_date <= w.retTo)))));
}
function datesBanner(what) {
  if (!state.dep || datesInvalid()) return "";
  return `<div class="banner">📅 <div>${what} filtrate pe datele tale: <b>${datesLabel()}</b>. <button class="linkish" data-clear-dates>Arată toate datele</button></div></div>`;
}

/* ---------- randare: căutare pe date ---------- */
function sortByChoice(rows) {
  return state.sort === "discount" ? [...rows].sort((a, b) => (b.discount_pct ?? -99) - (a.discount_pct ?? -99))
    : state.sort === "date" ? [...rows].sort((a, b) => a.dep_date.localeCompare(b.dep_date) || a.price_eur - b.price_eur)
    : [...rows].sort((a, b) => a.price_eur - b.price_eur);
}
function renderSearch() {
  const el = $("#tab-search");
  if (datesInvalid()) { el.innerHTML = `<div class="empty">Data întoarcerii trebuie să fie după data plecării.</div>`; return; }
  if (state.searchLoading && !state.search.length) { el.innerHTML = `<div class="empty">Caut zborurile…</div>`; return; }
  if (!state.search.length && !state.dep) { $("#c-search").textContent = ""; el.innerHTML = emptyState(); return; }
  const minDisc = state.status?.settings?.rules?.min_discount_pct ?? 40;
  // Fără date se aplică filtrul Dus / Dus-întors; cu date, tipul rezultă din datele alese
  const rows = sortByChoice(applyFilters(state.search, true, !!state.dep));
  $("#c-search").textContent = rows.length;
  const head = state.dep
    ? `<div class="banner">📅 <div><b>${datesLabel()}</b>: cel mai ieftin zbor ${state.ret ? "dus-întors" : "dus"} spre fiecare destinație.
        ${state.ret ? "Dusul și întorsul pot fi cu companii diferite (bilete separate)." : "Adaugă o dată de întoarcere pentru prețuri dus-întors."}
        <button class="linkish" data-clear-dates>Arată toate datele</button></div></div>`
    : `<div class="banner">✈️ <div>Cel mai ieftin zbor spre fiecare destinație, pe <b>oricare dată</b> din următoarele ${state.status?.settings?.months_ahead ?? 4} luni.
        Dacă ai date fixe, alege-le în chenarul de mai sus și lista se filtrează.</div></div>`;
  if (!rows.length) {
    el.innerHTML = head + `<div class="empty">Nu am găsit zboruri${state.dep ? " pe aceste date" : ""}${state.origin !== "ALL" ? " din " + ORIGIN_NAMES[state.origin] : ""}.${state.dep ? " Încearcă „Flexibil ± 3 zile”." : ""}</div>`;
    return;
  }
  el.innerHTML = head + `<div class="grid">${rows.slice(0, 300).map(r => searchCard(r, minDisc)).join("")}</div>` +
    (rows.length > 300 ? `<p class="muted">Se afișează primele 300 din ${rows.length}. Folosește filtrele.</p>` : "");
}
function legLine(icon, leg) {
  return `<div class="leg"><span>${icon}</span><span>${fmtDate(leg.date)}${leg.time ? " · " + leg.time : ""}</span>
    <span class="muted">${esc(leg.airline)}</span>${leg.price_eur != null ? `<span class="lp">${eur(leg.price_eur)} · ${fmtLei(leg.price_ron)}</span>` : ""}</div>`;
}
function searchCard(r, minDisc) {
  const deal = r.discount_pct != null && r.discount_pct >= minDisc;
  const links = r.link
    ? `<a class="btn small" href="${esc(r.link)}" target="_blank" rel="noopener">Rezervă ↗</a>`
    : `<a class="btn small" href="${esc(r.out.link)}" target="_blank" rel="noopener">Rezervă dus ↗</a>
       <a class="btn small" href="${esc(r.back.link)}" target="_blank" rel="noopener">Rezervă întors ↗</a>`;
  return `<article class="card">
    <span class="kind">${tripLabel(r)}</span>
    <div class="route">${esc(r.origin_name)} <span class="arrow">→</span> ${esc(r.dest_name)} <span class="country">${esc(r.country)}</span></div>
    <div class="price-row">
      <span class="price num">${eur(r.price_eur)}</span>
      ${leiSpan(r)}
      ${r.discount_pct >= 5 ? `<span class="disc num">−${Math.round(r.discount_pct)}%</span>` : ""}
    </div>
    <div class="legs">${legLine("🛫", r.out)}${r.back ? legLine("🛬", r.back) : ""}</div>
    ${r.nights ? `<div class="meta">${r.nights} ${r.nights === 1 ? "noapte" : "nopți"} la destinație</div>` : ""}
    <div class="badges">${deal ? `<span class="badge hot">📉 Ofertă: mult sub prețul obișnuit</span>` : ""}${r.typical_eur ? `<span class="badge">obișnuit ~${eur(r.typical_eur)}</span>` : ""}</div>
    <div class="actions">
      ${links}
      <a class="btn small ghost" href="${esc(r.gf_link)}" target="_blank" rel="noopener">Google Flights ↗</a>
      <button class="btn small ghost" data-route="${r.origin}|${r.dest}|${r.trip}">📅 Calendar</button>
      ${verifyBtn(r)}
    </div>
    ${freshness(r)}
  </article>`;
}
function dateQuery() {
  const w = datesInvalid() ? null : dateWindow();
  const qs = new URLSearchParams();
  if (w) {
    qs.set("dep_from", w.depFrom); qs.set("dep_to", w.depTo);
    if (w.retFrom) { qs.set("ret_from", w.retFrom); qs.set("ret_to", w.retTo); }
  }
  return qs;
}
let searchSeq = 0;
async function loadSearch() {
  if (datesInvalid()) { renderSearch(); renderDest(); return; }
  const seq = ++searchSeq;
  state.searchLoading = true; renderSearch();
  try {
    const res = await api(`/api/search?${dateQuery()}`);
    if (seq !== searchSeq) return;
    state.search = res;
  } catch (e) { if (seq === searchSeq) state.search = []; }
  state.searchLoading = false;
  renderSearch(); renderDest();
}
let exoticSeq = 0;
async function loadExotic() {
  if (datesInvalid()) { renderExotic(); return; }
  const seq = ++exoticSeq;
  try {
    const res = await api(`/api/exotic?${dateQuery()}`);
    if (seq === exoticSeq) state.exotic = res;
  } catch (e) { /* ignorat */ }
  renderExotic();
}

/* ---------- randare: exotice ---------- */
function renderExotic() {
  const el = $("#tab-exotic");
  const ex = state.exotic;
  if (!ex) { el.innerHTML = `<div class="empty">Se încarcă…</div>`; return; }
  const regions = ex.regions || {};
  const minDisc = state.status?.settings?.rules?.min_discount_pct ?? 40;
  const all = applyFilters(ex.fares, true, !!state.dep).filter(r => state.exRegion === "ALL" || r.region === state.exRegion);
  // câte un rând pe destinație (dus-întors înaintea lui „doar dus” când ambele există)
  const rows = sortByChoice(all);
  const present = new Set(ex.fares.map(r => r.region));
  $("#c-exotic").textContent = ex.fares.length ? new Set(all.map(r => r.dest)).size : "";
  const chips = `<div class="chips" style="margin-bottom:12px">${["ALL", ...Object.keys(regions)].filter(k => k === "ALL" || present.has(k))
    .map(k => `<button class="chip${state.exRegion === k ? " on" : ""}" data-exregion="${k}">${k === "ALL" ? "🌍 Toate regiunile" : esc(regions[k])}</button>`).join("")}</div>`;
  const head = `<div class="banner">🌴 <div>Destinații <b>din afara Europei</b> cu plecare din <b>${esc(ex.origin_name)}</b>: orice companie, direct sau cu escală, sejururi de ${state.status?.settings?.exotic?.min_nights ?? 5}–${state.status?.settings?.exotic?.max_nights ?? 28} nopți la dus-întors.
    ${state.dep ? `Filtrate pe datele tale: <b>${datesLabel()}</b>.` : "Cel mai ieftin preț găsit pe oricare dată."}</div></div>`;
  const cards = rows.length
    ? `<div class="grid">${rows.slice(0, 300).map(r => exoticCard(r, minDisc)).join("")}</div>`
    : `<div class="empty">Niciun zbor exotic pentru filtrele alese.</div>`;
  const posts = ex.posts.filter(p => !state.q || `${p.title} ${p.summary}`.toLowerCase().includes(state.q.toLowerCase()));
  const postsHtml = `<h3 style="font-size:15px;margin:22px 0 10px">📰 Oferte exotice din ${esc(ex.origin_name)} pe site-urile de specialitate <span class="count">${posts.length}</span></h3>` +
    (posts.length ? `<div class="posts">${posts.map(postHtml).join("")}</div>`
      : `<div class="empty">Încă nu au apărut articole cu destinații exotice din ${esc(ex.origin_name)}. Site-urile sunt verificate la ${state.status?.settings?.feeds_interval_minutes || 30} de minute.</div>`);
  el.innerHTML = head + chips + cards + postsHtml;
}
function exoticCard(r, minDisc) {
  const deal = r.discount_pct != null && r.discount_pct >= minDisc;
  return `<article class="card">
    <span class="kind">${tripLabel(r)}</span>
    <div class="route">${esc(r.origin_name)} <span class="arrow">→</span> ${esc(r.dest_name)} <span class="country">${esc(r.country)}</span></div>
    <div class="meta">${esc(r.region_label)}</div>
    <div class="price-row">
      <span class="price num">${eur(r.price_eur)}</span>
      ${leiSpan(r)}
      ${r.discount_pct >= 5 ? `<span class="disc num">−${Math.round(r.discount_pct)}%</span>` : ""}
    </div>
    <div class="when">${whenText(r)} <span class="muted">(${inDays(r.days_to_dep)})</span></div>
    <div class="meta">${esc(r.airline || "")}</div>
    <div class="badges">${deal ? `<span class="badge hot">📉 Mult sub prețul obișnuit</span>` : ""}${r.typical_eur ? `<span class="badge">obișnuit ~${eur(r.typical_eur)}</span>` : ""}</div>
    ${r.other_dates ? `<div><button class="linkish" data-route="${r.origin}|${r.dest}|${r.trip}">+${r.other_dates} alte date pe această rută</button></div>` : ""}
    <div class="actions">
      <a class="btn small" href="${esc(r.link || r.gf_link)}" target="_blank" rel="noopener">Rezervă ↗</a>
      <a class="btn small ghost" href="${esc(r.gf_link)}" target="_blank" rel="noopener">Google Flights ↗</a>
      <button class="btn small ghost" data-route="${r.origin}|${r.dest}|${r.trip}">📅 Calendar</button>
      ${verifyBtn(r)}
    </div>
    ${freshness(r)}
  </article>`;
}
function postHtml(p) {
  return `<article class="post">
    <div class="meta">${esc(p.feed)} · din ${(p.cities || "").split(",").map(c => ORIGIN_NAMES[c] || c).join(", ")} · ${esc(p.published || p.first_seen)}</div>
    <a class="title" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)} ↗</a>
    ${p.summary ? `<div class="summary">${esc(p.summary)}</div>` : ""}
  </article>`;
}
function onDatesChanged() {
  const hint = $("#f-dates-hint");
  $("#f-dates-clear").hidden = !state.dep && !state.ret;
  hint.classList.remove("err");
  if (datesInvalid()) { hint.textContent = "Data întoarcerii trebuie să fie după data plecării."; hint.classList.add("err"); }
  else if (!state.dep && state.ret) hint.textContent = "Alege și data plecării.";
  else if (state.dep) hint.textContent = `Rezultate pentru ${datesLabel()}.`;
  else hint.textContent = "Opțional: dacă ai date fixe, alege-le și toate listele se filtrează pe ele.";
  $("#f-trip").style.opacity = state.dep ? ".45" : "";
  $("#f-trip").title = state.dep ? "Tipul biletului rezultă din date (cu sau fără întoarcere)" : "";
  loadSearch();
  loadExotic();
  renderDeals(); renderLM(); renderDest();
}
function sortRows(rows) {
  const s = state.sort;
  const by = {
    score: (a, b) => b.score - a.score || a.price_eur - b.price_eur,
    price: (a, b) => a.price_eur - b.price_eur,
    date: (a, b) => a.dep_date.localeCompare(b.dep_date) || a.price_eur - b.price_eur,
    discount: (a, b) => (b.discount_pct ?? -99) - (a.discount_pct ?? -99),
  }[s];
  return [...rows].sort(by);
}

/* ---------- randare: oferte ---------- */
function renderDeals() {
  const el = $("#tab-deals");
  const rows = sortRows(applyFilters(state.deals));
  $("#c-deals").textContent = state.deals.length ? rows.length : "";
  if (!state.deals.length) { el.innerHTML = emptyState(); return; }
  if (!rows.length) {
    el.innerHTML = datesBanner("Ofertele sunt") + `<div class="empty">Nicio ofertă pentru filtrele alese.${state.dep ? ` Vezi toate zborurile pe datele tale în tab-ul <button class="linkish" data-tab="search">📅 Caută pe date</button>.` : ""}</div>`;
    return;
  }
  el.innerHTML = datesBanner("Ofertele sunt") + `<div class="grid">${rows.slice(0, 300).map(dealCard).join("")}</div>` +
    (rows.length > 300 ? `<p class="muted">Se afișează primele 300 din ${rows.length}. Folosește filtrele.</p>` : "");
}
function dealCard(r) {
  const why = [];
  if (r.typical_eur && r.discount_pct > 0) why.push(`obișnuit ~${eur(r.typical_eur)}`);
  if (r.prev_price_eur) why.push(`era ${eur(r.prev_price_eur)}`);
  if ((r.flags || "").includes("MINIM") && r.min_prev_eur) why.push(`minimul anterior ${eur(r.min_prev_eur)}`);
  return `<article class="card">
    <span class="kind">${tripLabel(r)}</span>
    <div class="route">${esc(r.origin_name)} <span class="arrow">→</span> ${esc(r.dest_name)} <span class="country">${esc(r.country)}</span></div>
    <div class="price-row">
      <span class="price num">${eur(r.price_eur)}</span>
      ${leiSpan(r)}
      ${r.discount_pct >= 5 ? `<span class="disc num">−${Math.round(r.discount_pct)}%</span>` : ""}
    </div>
    <div class="when">${whenText(r)} <span class="muted">(${inDays(r.days_to_dep)})</span></div>
    <div class="badges">${badges(r.flags, r.is_new)}</div>
    <div class="meta">${esc(r.airline || "")}${why.length ? " · " + why.join(" · ") : ""}</div>
    ${r.other_dates ? `<div><button class="linkish" data-route="${r.origin}|${r.dest}|${r.trip}">+${r.other_dates} alte date bune pe această rută</button></div>` : ""}
    <div class="actions">
      <a class="btn small" href="${esc(r.link || r.gf_link)}" target="_blank" rel="noopener">Rezervă ↗</a>
      <a class="btn small ghost" href="${esc(r.gf_link)}" target="_blank" rel="noopener">Google Flights ↗</a>
      <button class="btn small ghost" data-route="${r.origin}|${r.dest}|${r.trip}">📅 Calendar</button>
      ${verifyBtn(r)}
    </div>
    ${freshness(r)}
  </article>`;
}
function emptyState() {
  const st = state.status;
  if (st?.running) return `<div class="empty"><div class="big">🔎</div><p><b>Prima scanare e în curs…</b></p><p>Caut prețuri la Ryanair și Wizz Air pentru toate cele 4 orașe. Durează 10–20 de minute; pagina se actualizează singură.</p></div>`;
  return `<div class="empty"><div class="big">✈️</div><p>Încă nu există oferte. Apasă <b>Scanează acum</b>.</p></div>`;
}

/* ---------- randare: last minute ---------- */
function renderLM() {
  const el = $("#tab-lm");
  const rows = applyFilters(state.lm).sort((a, b) =>
    state.sort === "date" ? a.dep_date.localeCompare(b.dep_date) || a.price_eur - b.price_eur
      : state.sort === "discount" ? (b.discount_pct ?? -99) - (a.discount_pct ?? -99)
      : a.price_eur - b.price_eur);
  $("#c-lm").textContent = state.lm.length ? rows.length : "";
  if (!state.lm.length) { el.innerHTML = emptyState(); return; }
  if (!rows.length) { el.innerHTML = datesBanner("Zborurile sunt") + `<div class="empty">Niciun zbor pentru filtrele alese.</div>`; return; }
  el.innerHTML = datesBanner("Zborurile sunt") + `<div class="banner">⏰ <div>Zboruri cu plecare în următoarele <b>${state.days} zile</b>, de la cel mai ieftin. Ideal pentru escapade spontane.</div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Plecare</th><th>Destinație</th><th>Când</th><th>Tip</th><th class="r">Preț</th><th class="r">vs. obișnuit</th><th>Companie</th><th></th></tr></thead>
    <tbody>${rows.slice(0, 400).map(r => `<tr>
      <td>${esc(r.origin_name)}</td>
      <td><button class="cell-btn" data-route="${r.origin}|${r.dest}|${r.trip}"><b>${esc(r.dest_name)}</b></button> <span class="muted">${esc(r.country)}</span></td>
      <td>${whenText(r)} <span class="muted">(${inDays(r.days_to_dep)})</span></td>
      <td>${tripLabel(r)}</td>
      <td class="r num"><span class="strong">${eur(r.price_eur)}</span><br><span class="muted" style="font-size:12px">${fmtLei(r.price_ron)}</span></td>
      <td class="r num">${r.discount_pct == null ? "–" : r.discount_pct > 0 ? `<span style="color:var(--good-text);font-weight:700">−${Math.round(r.discount_pct)}%</span>` : `<span class="muted">+${Math.round(-r.discount_pct)}%</span>`}</td>
      <td class="muted">${esc(r.airline || "")}</td>
      <td><a class="btn small" href="${esc(r.link || r.gf_link)}" target="_blank" rel="noopener">Rezervă ↗</a> ${verifyBtn(r)}
        <div class="muted" style="font-size:11px;margin-top:3px">${r.source === "aviasales" ? "preț orientativ" : checkedLabel(r.last_seen)}</div></td>
    </tr>`).join("")}</tbody></table></div>`;
}

/* ---------- randare: destinații ---------- */
function renderDest() {
  const el = $("#tab-dest");
  const origins = (state.status?.origins || []).map(o => o.code).filter(c => state.origin === "ALL" || c === state.origin);
  const q = state.q.trim().toLowerCase();
  const max = parseFloat(state.max);
  const byDates = !!state.dep && !datesInvalid();
  const tripKey = byDates ? (state.ret ? "RT" : "OW") : (state.trip === "RT" ? "RT" : "OW");
  let rows = (byDates ? destFromSearch() : state.dest)
    .filter(d => !q || `${d.dest_name} ${d.country} ${d.dest}`.toLowerCase().includes(q));
  rows = rows.map(d => {
    const cells = origins.map(o => d[tripKey][o]);
    const vals = cells.filter(Boolean).map(c => c.min_eur);
    return { ...d, cells, best: vals.length ? Math.min(...vals) : null };
  }).filter(d => d.best != null && (!max || d.best <= max)).sort((a, b) => a.best - b.best);
  $("#c-dest").textContent = state.dest.length ? rows.length : "";
  if (!state.dest.length) { el.innerHTML = emptyState(); return; }
  const head = byDates
    ? `<div class="banner">📅 <div>Cel mai mic preț <b>${tripKey === "RT" ? "dus-întors" : "doar dus"}</b> pe datele tale (<b>${datesLabel()}</b>), spre fiecare destinație, din fiecare oraș. <button class="linkish" data-clear-dates>Arată toate datele</button></div></div>`
    : `<div class="banner">🌍 <div>Cel mai mic preț <b>${tripKey === "RT" ? "dus-întors" : "doar dus"}</b> găsit spre fiecare destinație, din fiecare oraș. Apasă pe un preț pentru calendarul complet.</div></div>`;
  if (!rows.length) { el.innerHTML = head + `<div class="empty">Nicio destinație pentru filtrele alese.</div>`; return; }
  el.innerHTML = head + `<div class="table-wrap"><table>
    <thead><tr><th>Destinație</th>${origins.map(o => `<th class="r">din ${ORIGIN_NAMES[o] || o}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(d => `<tr>
      <td><b>${esc(d.dest_name)}</b> <span class="muted">${esc(d.country)} · ${d.dest}</span></td>
      ${d.cells.map((c, i) => `<td class="r">${c ? `<button class="cell-btn${c.min_eur === d.best ? " best" : ""}" data-route="${origins[i]}|${d.dest}|${tripKey}" title="${c.date ? fmtDate(c.date) + (c.ret ? " → " + fmtDate(c.ret) : "") + " · " : ""}${lei(c.min_eur)} · Prețul obișnuit: ${eur(c.typical_eur)}">${eur(c.min_eur)}</button>` : `<span class="muted">–</span>`}</td>`).join("")}
    </tr>`).join("")}</tbody></table></div>`;
}
function destFromSearch() {
  const out = {};
  for (const r of state.search) {
    const d = out[r.dest] || (out[r.dest] = { dest: r.dest, dest_name: r.dest_name, country: r.country, OW: {}, RT: {} });
    const cur = d[r.trip][r.origin];
    if (!cur || r.price_eur < cur.min_eur) {
      d[r.trip][r.origin] = { min_eur: r.price_eur, typical_eur: r.typical_eur, date: r.dep_date, ret: r.ret_date };
    }
  }
  return Object.values(out);
}

/* ---------- randare: articole ---------- */
function renderPosts() {
  const el = $("#tab-posts");
  const rows = state.posts.filter(p => state.origin === "ALL" || (p.cities || "").split(",").includes(state.origin))
    .filter(p => !state.q || `${p.title} ${p.summary}`.toLowerCase().includes(state.q.toLowerCase()));
  $("#c-posts").textContent = state.posts.length ? rows.length : "";
  const fl = state.status?.feeds_last;
  const head = `<div class="banner">📰 <div>Oferte publicate de site-uri de specialitate (Fly4free, TravelFree, Utazómajom, Piraten etc.) care pleacă din orașele tale — inclusiv pachete și last minute.
    ${fl ? `Ultima verificare: <b>${ago(fl.at)}</b>.` : ""} ${STATIC ? "" : `<button class="linkish" id="btn-feeds">Verifică acum</button>`}</div></div>`;
  if (!rows.length) { el.innerHTML = head + `<div class="empty">Încă nu au apărut articole cu plecare din orașele tale. Site-urile sunt verificate la fiecare ${state.status?.settings?.feeds_interval_minutes || 30} de minute.</div>`; return; }
  el.innerHTML = head + `<div class="posts">${rows.map(p => `<article class="post">
    <div class="meta">${esc(p.feed)} · din ${(p.cities || "").split(",").map(c => ORIGIN_NAMES[c] || c).join(", ")} · ${esc(p.published || p.first_seen)}</div>
    <a class="title" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)} ↗</a>
    ${p.summary ? `<div class="summary">${esc(p.summary)}</div>` : ""}
  </article>`).join("")}</div>`;
}

/* ---------- ajutor ---------- */
function renderHelp() {
  const s = state.status?.settings || {};
  const r = s.rules || {};
  $("#tab-help").innerHTML = `
  <h2>De unde vin prețurile</h2>
  <ul>
    <li><b>Wizz Air</b> și <b>Ryanair</b> — prețurile oficiale, direct de la companii, pentru fiecare zi, pe toate rutele din Timișoara, Budapesta, Oradea și Cluj. Acestea sunt majoritatea biletelor ieftine din zonă.</li>
    <li><b>Aviasales</b> — prețuri recente pentru toate companiile (TAROM, HiSky, Lufthansa, Turkish, Qatar, Emirates…), inclusiv zborurile lungi cu escală spre destinațiile exotice. Verificat la fiecare oră.</li>
    <li><b>Site-uri de oferte</b> — Fly4free, TravelFree, Utazómajom, Piraten etc., verificate la ${s.feeds_interval_minutes || 30} de minute; se păstrează doar ofertele cu plecare din orașele tale.</li>
  </ul>
  <h2>Datele călătoriei (opțional)</h2>
  <p>Fără date, fiecare tab arată toate zborurile. Dacă ai date fixe, alege-le în chenarul 📅 și toate listele se filtrează pe ele. Cu „Flexibil ±” prinzi și zilele vecine. Cu dată de întoarcere, „Caută pe date” și „Toate destinațiile” combină cel mai ieftin dus cu cel mai ieftin întors, chiar dacă sunt companii diferite.</p>
  <h2>🌴 Exotice din Budapesta</h2>
  <p>Destinații din afara Europei (Asia, insulele din Oceanul Indian, Orientul Mijlociu, Africa, America, Oceania), orice companie, direct sau cu escală, dus-întors cu sejururi de ${s.exotic?.min_nights ?? 5}–${s.exotic?.max_nights ?? 28} nopți, pe următoarele ${s.exotic?.months_ahead ?? 8} luni. Zborurile lungi cu escală vin din Aviasales. Pentru ele, pragul de ofertă e mai mare: până la ${s.exotic?.max_price_rt_eur ?? 1400} € dus-întors, iar sub ${s.exotic?.super_cheap_rt_eur ?? 400} € e „super ieftin”.</p>
  <h2>Cum se decide că e o ofertă</h2>
  <p>Pentru fiecare rută se salvează zilnic prețul minim și cel median. <b>Prețul obișnuit</b> este mediana ultimelor zile/luni. Un bilet apare la Oferte dacă:</p>
  <ul>
    <li>📉 e cu cel puțin <b>${r.min_discount_pct ?? 40}%</b> sub prețul obișnuit al rutei;</li>
    <li>🏆 e cel mai mic preț văzut vreodată pe rută (după minim 2 zile de istoric);</li>
    <li>⬇️ prețul a scăzut cu cel puțin <b>${r.drop_pct ?? 20}%</b> de la verificarea anterioară;</li>
    <li>🔥 costă sub <b>${r.super_cheap_ow_eur ?? 20} €</b> dus sau <b>${r.super_cheap_rt_eur ?? 50} €</b> dus-întors;</li>
    <li>⏰ pleacă în maxim ${s.last_minute_days ?? 10} zile și e ieftin (last minute).</li>
  </ul>
  <p>În prima zi comparația se face cu celelalte zile din calendarul rutei. Cu cât aplicația rulează mai mult, cu atât istoricul devine mai precis.</p>
  <h2>Când se verifică</h2>
  <p>Prețurile se verifică complet la fiecare <b>${s.scan_interval_hours ?? 4} ore</b>, pe următoarele <b>${s.months_ahead ?? 4} luni</b>. Dus-întors înseamnă ${s.round_trip?.min_nights ?? 2}–${s.round_trip?.max_nights ?? 10} nopți la destinație. Verificările mai dese riscă blocarea de către companii.</p>
  ${STATIC ? `<h2>Despre această pagină</h2>
  <p>Aceasta este pagina publică <b>FlyCenterHub S.R.</b>. Prețurile sunt căutate automat și publicate aici după fiecare verificare. Sus vezi când au fost actualizate ultima dată.</p>` : `
  <h2>Notificări Telegram</h2>
  <p>${state.status?.telegram ? "✅ Active." : "Inactive."} Pentru configurare rulează <code>Configurare-Telegram.bat</code> din folderul aplicației.
  ${state.status?.telegram ? `<button class="btn small ghost" id="btn-tg-test">Trimite un mesaj de test</button>` : ""}</p>
  <h2>Setări</h2>
  <p>Toate pragurile (reduceri, prețuri maxime, orașe, interval) sunt în <code>config.json</code>. După modificare, repornește aplicația.</p>`}
  <p class="muted">Prețurile sunt pentru 1 adult, fără bagaj de cală, și pot varia la rezervare. Verifică întotdeauna prețul final pe site-ul companiei.</p>`;
}

/* ---------- status ---------- */
function renderStatus() {
  const st = state.status;
  const el = $("#status");
  const btn = $("#btn-scan");
  if (!st) return;
  el.classList.toggle("busy", st.running);
  const last = st.last_scan;
  el.classList.toggle("err", !st.running && last?.status === "error");
  const bar = $("#scanbar");
  bar.hidden = !st.running;
  if (st.running) {
    const p = st.progress.length ? st.progress.join(" · ") : "pornesc…";
    const kind = st.scan_kind === "quick" ? "Verificare rapidă" : "Scanare";
    const pct = st.progress_pct != null ? ` ${st.progress_pct}%` : "";
    const eta = st.eta_min != null ? ` · ~${st.eta_min < 1 ? "sub 1" : st.eta_min} min rămase` : "";
    el.innerHTML = `<span class="dot"></span><b>${kind}${pct}</b>${eta} · ${esc(p)}`;
    $(".fill", bar).style.width = (st.progress_pct || 2) + "%";
  } else if (last && STATIC) {
    const hours = (Date.now() - new Date(last.finished_at.replace(" ", "T")).getTime()) / 36e5;
    el.innerHTML = `<span class="dot"></span>Prețuri actualizate ${ago(last.finished_at)}` +
      (hours > 6 ? " · se reactualizează automat când pornește căutarea" : " · se actualizează automat");
  } else if (last) {
    const lab = last.status === "ok" ? "Actualizat" : last.status === "partial" ? "Actualizat parțial" : "Eroare la scanare";
    el.innerHTML = `<span class="dot"></span>${lab} ${ago(last.finished_at)} · următoarea verificare la ${hhmm(st.next_check_at || st.next_scan_at)}${st.telegram ? " · Telegram ✓" : ""}`;
    el.title = JSON.stringify(last.info?.sources || last.info || {}, null, 1);
  } else {
    el.innerHTML = `<span class="dot"></span>Nicio scanare încă`;
  }
  const f = st.fx;
  $("#fx-line").textContent = f?.eur_ron
    ? `Curs ${f.source}${f.date ? " " + fmtDate(f.date, false) : ""}: 1 € = ${f.eur_ron.toLocaleString("ro-RO", { minimumFractionDigits: 4 })} lei` +
      (f.huf100_ron ? ` · 100 Ft = ${f.huf100_ron.toLocaleString("ro-RO", { minimumFractionDigits: 4 })} lei` : "")
    : "";
  const ps = st.public_site;
  $("#public-line").innerHTML = !STATIC && ps?.url
    ? `🌐 Site public: <a href="${esc(ps.url)}" target="_blank" rel="noopener">${esc(ps.url.replace("https://", ""))}</a>
       <button class="linkish" id="btn-copy-link" data-url="${esc(ps.url)}">Copiază linkul</button>${ps.error ? ` · <span style="color:var(--hot-text)">${esc(ps.error)}</span>` : ""}`
    : "";
  btn.disabled = st.running;
  btn.textContent = st.running ? "Se scanează…" : "Scanează acum";
  $("#btn-quick").disabled = st.running;
  if (st.settings?.months_ahead) {
    $("#f-dep").max = $("#f-ret").max = isoAdd(todayIso(), Math.round(st.settings.months_ahead * 30.5) + 10);
  }

  const h = st.counts?.history_days || 0;
  $("#banner").innerHTML = (h > 0 && h < 3 && !st.running)
    ? `<div class="banner">📈 <div><b>Istoricul prețurilor abia începe (${h} ${h === 1 ? "zi" : "zile"}).</b> Deocamdată prețurile sunt comparate cu celelalte zile din calendarul fiecărei rute. De la 3 zile de istoric, comparațiile cu „ultimele zile și luni” devin tot mai precise.</div></div>`
    : "";
}

/* ---------- încărcare ---------- */
async function loadStatus() {
  try {
    state.status = await api("/api/status");
    renderStatus();
    const id = state.status.last_scan?.id;
    const ver = state.status.data_version;
    if ((id && id !== state.lastScanId) || (state.wasRunning && !state.status.running) ||
        (state.dataVersion != null && ver !== state.dataVersion)) {
      state.lastScanId = id;
      state.dataVersion = ver;
      await loadData();
    }
    state.dataVersion = ver;
    state.wasRunning = state.status.running;
  } catch (e) {
    $("#status").innerHTML = `<span class="dot"></span>Aplicația nu răspunde — e pornită?`;
    $("#status").classList.add("err");
  }
}
async function loadData() {
  const [deals, lm, dest, posts] = await Promise.all([
    api("/api/deals"), api(`/api/lastminute?days=${state.days}`), api("/api/destinations"), api("/api/posts"),
  ]);
  Object.assign(state, { deals, lm, dest, posts });
  renderAll();
  loadSearch();
  loadExotic();
}
function renderAll() {
  renderDeals(); renderSearch(); renderLM(); renderDest(); renderExotic(); renderPosts(); renderHelp();
}

/* ---------- modal rută ---------- */
async function openRoute(origin, dest, trip) {
  const dlg = $("#route-modal");
  $("#rm-title").textContent = `${ORIGIN_NAMES[origin] || origin} → …`;
  $("#rm-sub").textContent = "";
  $("#rm-body").innerHTML = `<p class="muted">Se încarcă…</p>`;
  if (!dlg.open) dlg.showModal();
  const [r, dd] = await Promise.all([
    api(`/api/route?origin=${origin}&dest=${dest}`),
    api(`/api/route-deals?origin=${origin}&dest=${dest}&trip=${trip}`),
  ]);
  $("#rm-title").textContent = `${r.origin_name} → ${r.dest_name}`;
  $("#rm-sub").textContent = `${r.country ? r.country + " · " : ""}${origin} → ${dest}`;
  const minDisc = state.status?.settings?.rules?.min_discount_pct ?? 40;
  const stOW = r.stats.OW || {}, stRT = r.stats.RT || {};
  const minOW = r.calendar_ow.length ? Math.min(...r.calendar_ow.map(x => x.price_eur)) : null;
  const minRT = r.calendar_rt.length ? Math.min(...r.calendar_rt.map(x => x.price_eur)) : null;
  $("#rm-body").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">Cel mai ieftin dus</div><div class="v num">${eur(minOW)}</div></div>
      <div class="stat"><div class="k">Obișnuit (dus)</div><div class="v num">${eur(stOW.typical_eur)}</div></div>
      <div class="stat"><div class="k">Cel mai ieftin dus-întors</div><div class="v num">${eur(minRT)}</div></div>
      <div class="stat"><div class="k">Istoric</div><div class="v num">${stOW.history_days || 0} ${(stOW.history_days || 0) === 1 ? "zi" : "zile"}</div></div>
    </div>
    <div class="chart-card">
      <h3>Prețul pe zile de plecare · doar dus</h3>
      <p class="sub">Cel mai mic preț pentru fiecare zi. Barele închise la culoare sunt cu ≥${minDisc}% sub prețul obișnuit.</p>
      <div class="legend"><span><i style="background:var(--series-1)"></i>Ofertă</span><span><i style="background:var(--series-1-soft)"></i>Alte zile</span><span><i class="dash"></i>Preț obișnuit</span></div>
      <div class="chart" id="ch-ow"></div>
    </div>
    ${r.calendar_rt.length ? `<div class="chart-card">
      <h3>Dus-întors, după ziua plecării</h3>
      <p class="sub">Cel mai ieftin retur între ${state.status?.settings?.round_trip?.min_nights ?? 2} și ${state.status?.settings?.round_trip?.max_nights ?? 10} nopți.</p>
      <div class="legend"><span><i style="background:var(--series-1)"></i>Ofertă</span><span><i style="background:var(--series-1-soft)"></i>Alte zile</span><span><i class="dash"></i>Preț obișnuit</span></div>
      <div class="chart" id="ch-rt"></div>
    </div>` : ""}
    <div class="chart-card">
      <h3>Istoricul prețului pe rută · doar dus</h3>
      <p class="sub">Cum au evoluat prețurile de la o zi la alta (minimul și mediana tuturor datelor de plecare).</p>
      <div id="ch-hist-wrap"></div>
    </div>
    <h3 style="font-size:14px;margin:4px 0 8px">${dd.length ? `Datele cu oferte (${tripLabel({ trip })})` : "Cele mai ieftine bilete"}</h3>
    <div class="list">${(dd.length ? dd : r.cheapest.filter(x => x.trip === trip)).slice(0, 30).map(x => `
      <div class="list-row">
        <span class="p num">${eur(x.price_eur)}<br><span class="muted" style="font-size:12px;font-weight:600">${fmtLei(x.price_ron)}</span></span>
        <span style="flex:1 1 200px">${whenText(x)} <span class="muted">· ${esc(x.airline || "")}</span></span>
        <span class="badges">${badges(x.flags)}</span>
        <a class="btn small" href="${esc(x.link || x.gf_link)}" target="_blank" rel="noopener">Rezervă ↗</a>
        ${verifyBtn(x)}
      </div>`).join("") || `<p class="muted">Nu există bilete.</p>`}</div>`;

  barChart($("#ch-ow"), r.calendar_ow.map(x => ({ x: x.dep_date, y: x.price_eur })), stOW.typical_eur, minDisc);
  if (r.calendar_rt.length) barChart($("#ch-rt"), r.calendar_rt.map(x => ({ x: x.dep_date, y: x.price_eur })), stRT.typical_eur, minDisc);
  const hist = r.history.filter(h => h.trip === "OW");
  if (hist.length >= 2) {
    $("#ch-hist-wrap").innerHTML = `<div class="legend"><span><i class="line" style="background:var(--series-1)"></i>Cel mai mic preț</span><span><i class="line" style="background:var(--series-2)"></i>Prețul median</span></div><div class="chart" id="ch-hist"></div>`;
    lineChart($("#ch-hist"), hist);
  } else {
    $("#ch-hist-wrap").innerHTML = `<p class="muted">Graficul apare după cel puțin 2 zile de monitorizare.</p>`;
  }
}

/* ---------- grafice (SVG) ---------- */
const tip = $("#tooltip");
function showTip(html, ev) {
  tip.innerHTML = html; tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY - h - 10;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
  if (y < 8) y = ev.clientY + 16;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function hideTip() { tip.hidden = true; }
function niceMax(v) {
  if (v <= 0) return { max: 10, step: 2.5 };
  const raw = v / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  return { max: step * 4, step };
}
function barChart(el, pts, typical, minDisc) {
  if (!pts.length) { el.innerHTML = `<p class="muted">Nu există bilete.</p>`; return; }
  const W = Math.max(el.clientWidth, 300), H = 200, m = { t: 10, r: 8, b: 24, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const { max, step } = niceMax(Math.max(...pts.map(p => p.y), typical || 0));
  const first = d0(pts[0].x), last = d0(pts[pts.length - 1].x);
  const days = Math.round((last - first) / 864e5) + 1;
  const slot = iw / days;
  const bw = Math.max(1, Math.min(18, slot - 2));
  const y = v => m.t + ih - (v / max) * ih;
  const xOf = iso => m.l + Math.round((d0(iso) - first) / 864e5) * slot + (slot - bw) / 2;
  const thr = typical ? typical * (1 - minDisc / 100) : -1;
  let s = "";
  for (let v = 0; v <= max + 1e-9; v += step) {
    s += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)} €</text>`;
  }
  // etichete lună
  const d = new Date(first);
  d.setDate(1);
  while (d <= last) {
    if (d >= first) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      const x = m.l + Math.round((d - first) / 864e5) * slot;
      s += `<line class="grid-line" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ih}"/><text x="${x + 3}" y="${H - 6}">${MONTHS[d.getMonth()]}</text>`;
    } else {
      s += `<text x="${m.l}" y="${H - 6}">${MONTHS[first.getMonth()]}</text>`;
    }
    d.setMonth(d.getMonth() + 1);
  }
  pts.forEach((p, i) => {
    const x = xOf(p.x), top = y(p.y), h = m.t + ih - top, r = Math.min(4, bw / 2, h);
    const deal = p.y <= thr;
    s += `<path class="bar${deal ? " deal" : ""}" data-i="${i}" d="M${x},${m.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${m.t + ih} Z"/>`;
  });
  if (typical) s += `<line class="ref-line" x1="${m.l}" x2="${W - m.r}" y1="${y(typical)}" y2="${y(typical)}"/>`;
  pts.forEach((p, i) => {
    const x = m.l + Math.round((d0(p.x) - first) / 864e5) * slot;
    s += `<rect class="hit" data-i="${i}" x="${x}" y="${m.t}" width="${Math.max(slot, 4)}" height="${ih}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Prețuri pe zile">${s}</svg>`;
  const bars = $$(".bar", el);
  $$(".hit", el).forEach(hit => {
    const i = +hit.dataset.i, p = pts[i];
    hit.addEventListener("mousemove", ev => {
      bars.forEach(b => b.classList.toggle("hover", +b.dataset.i === i));
      const diff = typical ? Math.round((typical - p.y) / typical * 100) : null;
      showTip(`<b>${eur(p.y)}</b> · ${lei(p.y)}<br>${fmtDate(p.x)}${diff != null ? `<br>${diff > 0 ? "−" + diff + "% sub" : "+" + (-diff) + "% peste"} obișnuit` : ""}`, ev);
    });
    hit.addEventListener("mouseleave", () => { hideTip(); bars.forEach(b => b.classList.remove("hover")); });
  });
}
function lineChart(el, rows) {
  const W = Math.max(el.clientWidth, 300), H = 180, m = { t: 12, r: 70, b: 24, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const { max, step } = niceMax(Math.max(...rows.map(r => r.p50_eur)));
  const n = rows.length;
  const x = i => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = v => m.t + ih - (v / max) * ih;
  let s = "";
  for (let v = 0; v <= max + 1e-9; v += step) {
    s += `<line class="grid-line" x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)} €</text>`;
  }
  const every = Math.max(1, Math.ceil(n / 8));
  rows.forEach((r, i) => { if (i % every === 0 || i === n - 1) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${fmtDate(r.day, false)}</text>`; });
  const path = key => rows.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r[key])}`).join(" ");
  s += `<path class="line-2" d="${path("p50_eur")}"/><path class="line-1" d="${path("min_eur")}"/>`;
  const lr = rows[n - 1];
  s += `<text class="dlabel" x="${x(n - 1) + 8}" y="${y(lr.min_eur) + 4}">${eur(lr.min_eur)}</text>`;
  s += `<text class="dlabel" x="${x(n - 1) + 8}" y="${y(lr.p50_eur) + 4}">${eur(lr.p50_eur)}</text>`;
  s += `<line class="cross" id="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  s += `<circle class="dot-1" id="dot1" r="4" visibility="hidden"/><circle class="dot-2" id="dot2" r="4" visibility="hidden"/>`;
  s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Istoric prețuri">${s}</svg>`;
  const svg = $("svg", el), cross = $("#cross", el), d1 = $("#dot1", el), d2 = $("#dot2", el);
  $(".hit", el).addEventListener("mousemove", ev => {
    const rect = svg.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (W / rect.width);
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
    const r = rows[i];
    [cross, d1, d2].forEach(e => e.setAttribute("visibility", "visible"));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    d1.setAttribute("cx", x(i)); d1.setAttribute("cy", y(r.min_eur));
    d2.setAttribute("cx", x(i)); d2.setAttribute("cy", y(r.p50_eur));
    showTip(`<b>${fmtDate(r.day)}</b><br>Minim: ${eur(r.min_eur)}<br>Median: ${eur(r.p50_eur)}`, ev);
  });
  $(".hit", el).addEventListener("mouseleave", () => { hideTip(); [cross, d1, d2].forEach(e => e.setAttribute("visibility", "hidden")); });
}

/* ---------- evenimente ---------- */
function setTab(t) {
  if (!$(`#tab-${t}`)) t = "deals";
  state.tab = t;
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
  for (const id of ["deals", "search", "lm", "dest", "exotic", "posts", "help"]) $(`#tab-${id}`).hidden = id !== t;
  $("#filters").hidden = t === "help";
  $("#f-sort-wrap").hidden = !(t === "deals" || t === "lm" || t === "search" || t === "exotic");
  $("#f-origin").hidden = t === "exotic";
  $("#f-days-wrap").hidden = t !== "lm";
  try { localStorage.setItem("tab", t); } catch (e) { /* ignorat */ }
}
function initFilters() {
  const origins = [{ code: "ALL", name: "Toate orașele" }, ...Object.entries(ORIGIN_NAMES).map(([code, name]) => ({ code, name }))];
  $("#f-origin").innerHTML = origins.map(o => `<button class="chip${o.code === "ALL" ? " on" : ""}" data-v="${o.code}">${o.name}</button>`).join("");
  $("#f-origin").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    state.origin = b.dataset.v;
    $$(".chip").forEach(c => c.classList.toggle("on", c === b));
    renderAll();
  });
  $("#f-trip").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.trip = b.dataset.v;
    $$("#f-trip button").forEach(c => c.classList.toggle("on", c === b));
    renderAll();
  });
  $("#f-max").addEventListener("input", e => { state.max = e.target.value; renderAll(); });
  $("#f-q").addEventListener("input", e => { state.q = e.target.value; renderAll(); });
  $("#f-sort").addEventListener("change", e => { state.sort = e.target.value; renderAll(); });
  const dep = $("#f-dep"), ret = $("#f-ret");
  dep.min = ret.min = todayIso();
  dep.addEventListener("change", () => {
    state.dep = dep.value;
    if (state.dep) ret.min = isoAdd(state.dep, 1);
    onDatesChanged();
  });
  ret.addEventListener("change", () => { state.ret = ret.value; onDatesChanged(); });
  $("#f-flex").addEventListener("change", e => { state.flex = +e.target.value; onDatesChanged(); });
  $("#f-dates-clear").addEventListener("click", clearDates);
  $("#f-days").addEventListener("change", async e => {
    state.days = +e.target.value;
    state.lm = await api(`/api/lastminute?days=${state.days}`);
    renderLM();
  });
}
function clearDates() {
  state.dep = state.ret = "";
  $("#f-dep").value = $("#f-ret").value = "";
  $("#f-ret").min = todayIso();
  onDatesChanged();
}
document.addEventListener("click", async e => {
  if (e.target.id === "btn-copy-link") {
    try { await navigator.clipboard.writeText(e.target.dataset.url); e.target.textContent = "Copiat ✓"; }
    catch (err) { prompt("Copiază linkul:", e.target.dataset.url); }
    setTimeout(() => { e.target.textContent = "Copiază linkul"; }, 2500);
    return;
  }
  const vb = e.target.closest("[data-verify]");
  if (vb) { runVerify(vb); return; }
  if (e.target.closest("[data-clear-dates]")) { clearDates(); return; }
  const exr = e.target.closest("[data-exregion]");
  if (exr) { state.exRegion = exr.dataset.exregion; renderExotic(); return; }
  const t = e.target.closest("[data-tab]");
  if (t) { setTab(t.dataset.tab); return; }
  const r = e.target.closest("[data-route]");
  if (r) { const [o, d, trip] = r.dataset.route.split("|"); openRoute(o, d, trip); return; }
  if (e.target.id === "btn-feeds") {
    e.target.textContent = "Se verifică…";
    await post("/api/feeds");
    state.posts = await api("/api/posts");
    await loadStatus();
    renderPosts();
    return;
  }
  if (e.target.id === "btn-tg-test") {
    const res = await post("/api/telegram-test");
    e.target.textContent = res.ok ? "Trimis ✓" : (res.message || "Eroare");
  }
});
$("#btn-quick").addEventListener("click", async () => {
  const res = await post("/api/scan?quick=1");
  if (!res.ok && res.message) alert(res.message);
  setTimeout(loadStatus, 800);
});
$("#btn-scan").addEventListener("click", async () => {
  const res = await post("/api/scan");
  if (!res.ok && res.message) alert(res.message);
  setTimeout(loadStatus, 800);
});
$("#rm-close").addEventListener("click", () => $("#route-modal").close());
$("#route-modal").addEventListener("click", e => { if (e.target.id === "route-modal") e.target.close(); });
$("#btn-theme").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (e) { /* ignorat */ }
});

(function init() {
  try {
    const th = localStorage.getItem("theme"); if (th) document.documentElement.dataset.theme = th;
    const tb = localStorage.getItem("tab"); if (tb) state.tab = tb;
  } catch (e) { /* ignorat */ }
  initFilters();
  setTab(state.tab);
  loadStatus().then(() => { if (!state.lastScanId) loadData(); });
  if (STATIC) { $("#btn-scan").hidden = true; $("#btn-quick").hidden = true; }
  setInterval(loadStatus, STATIC ? 60000 : 8000);
})();
