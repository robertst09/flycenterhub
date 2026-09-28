"use strict";
/* Site-ul public (GitHub Pages) nu are server: aceleași răspunsuri ca /api/*, calculate în browser
   din fișierele data/*.json publicate de aplicația de pe calculator. Oglindește app/queries.py. */
(function () {
  const SRC = ["ryanair", "wizzair", "aviasales"];
  const NAMES = { TSR: "Timișoara", BUD: "Budapesta", OMR: "Oradea", CLJ: "Cluj-Napoca" };
  const REGIONS = {
    asia: "Asia", insule: "Insule exotice (Oceanul Indian)", orient: "Orientul Mijlociu & Caucaz", africa: "Africa",
    america_n: "America de Nord", caraibe: "Caraibe & America Centrală", america_s: "America de Sud", oceania: "Oceania & Pacific",
  };
  let cache = {};
  let generated = null;

  function load(name) {
    if (!cache[name]) cache[name] = fetch(`data/${name}.json?v=${window.DATA_VERSION || ""}`).then(r => r.json());
    return cache[name];
  }
  const pad = n => String(n).padStart(2, "0");
  function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function addDays(iso, n) {
    const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const days = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);

  function link(f) {
    if (f.source === "wizzair") return `https://www.wizzair.com/ro-ro/booking/select-flight/${f.origin}/${f.dest}/${f.dep_date}/${f.ret_date || "null"}/1/0/0/null`;
    if (f.source === "ryanair") return "https://www.ryanair.com/ro/ro/trip/flights/select?adults=1&teens=0&children=0&infants=0" +
      `&dateOut=${f.dep_date}&dateIn=${f.ret_date || ""}&isConnectedFlight=false&discount=0&isReturn=${f.ret_date ? "true" : "false"}` +
      `&originIata=${f.origin}&destinationIata=${f.dest}`;
    return f.link || "";
  }
  function gf(o, d, dep, ret) {
    const q = ret ? `Flights from ${o} to ${d} on ${dep} returning ${ret}` : `Flights from ${o} to ${d} on ${dep} one way`;
    return "https://www.google.com/travel/flights?hl=ro&curr=EUR&q=" + encodeURIComponent(q);
  }

  let faresP = null;
  function fares() {
    if (!faresP) {
      faresP = load("fares").then(({ airlines, rows }) => rows.map(r => {
        const f = {
          source: SRC[r[0]], origin: r[1], dest: r[2], dep_date: r[3], ret_date: r[4], price_eur: r[5], price_ron: r[6],
          lei_exact: !!r[7], dep_time: r[8], ret_time: r[9], airline: airlines[r[10]], link: r[11] || "", last_seen: r[12],
        };
        f.trip = f.ret_date ? "RT" : "OW";
        f.link = link(f);
        return f;
      }));
    }
    return faresP;
  }

  async function enrich(rows) {
    const places = await load("places");
    for (const r of rows) {
      r.trip = r.trip || (r.ret_date ? "RT" : "OW");
      const p = places[r.dest] || [];
      r.origin_name = NAMES[r.origin] || (places[r.origin] || [])[0] || r.origin;
      r.dest_name = NAMES[r.dest] || p[0] || r.dest;
      r.country = p[1] || "";
      r.nights = r.ret_date ? days(r.dep_date, r.ret_date) : null;
      r.gf_link = gf(r.origin, r.dest, r.dep_date, r.ret_date);
    }
    return rows;
  }
  async function typicalOf(o, d, t) { return ((await load("stats"))[`${o}|${d}|${t}`] || [])[0] ?? null; }

  const leg = f => ({ date: f.dep_date, time: f.dep_time, airline: f.airline, price_eur: f.price_eur, price_ron: f.price_ron,
    link: f.link, source: f.source, last_seen: f.last_seen });

  async function origins() { return ((await load("status")).origins || []).map(o => o.code); }

  // ---------- /api/lastminute ----------
  async function lastminute(q) {
    const orig = await origins(), all = await fares(), t0 = today(), until = addDays(t0, +q.days || 10);
    const stats = await load("stats");
    const rows = all.filter(f => orig.includes(f.origin) && f.dep_date >= t0 && f.dep_date <= until)
      .sort((a, b) => a.price_eur - b.price_eur).slice(0, 600).map(f => ({ ...f }));
    for (const r of rows) {
      const t = (stats[`${r.origin}|${r.dest}|${r.trip}`] || [])[0];
      r.typical_eur = t ?? null;
      r.discount_pct = t ? Math.round((t - r.price_eur) / t * 1000) / 10 : null;
      r.days_to_dep = days(t0, r.dep_date);
    }
    return enrich(rows);
  }

  // ---------- /api/search ----------
  async function search(q) {
    const orig = await origins(), all = await fares(), stats = await load("stats");
    const noDates = !q.dep_from;
    const depFrom = q.dep_from || today(), depTo = q.dep_to || (noDates ? "9999-12-31" : depFrom);
    const retFrom = q.ret_from || "", retTo = q.ret_to || retFrom;
    const outs = all.filter(f => orig.includes(f.origin) && !f.ret_date && f.dep_date >= depFrom && f.dep_date <= depTo);
    const best = new Map();
    const put = (k, item) => { const c = best.get(k); if (!c || item.price_eur < c.price_eur) best.set(k, item); };
    if (!retFrom) {
      for (const f of outs) put(`${f.origin}|${f.dest}|OW`, { origin: f.origin, dest: f.dest, trip: "OW", dep_date: f.dep_date,
        ret_date: "", price_eur: f.price_eur, price_ron: f.price_ron, lei_exact: f.lei_exact, out: leg(f), back: null,
        link: f.link, airline: f.airline, source: f.source, last_seen: f.last_seen });
    }
    const rtItem = f => ({ origin: f.origin, dest: f.dest, trip: "RT", dep_date: f.dep_date, ret_date: f.ret_date,
      price_eur: f.price_eur, price_ron: f.price_ron, lei_exact: f.lei_exact, link: f.link, airline: f.airline,
      source: f.source, last_seen: f.last_seen,
      out: { date: f.dep_date, time: f.dep_time, airline: f.airline, price_eur: null, link: "", source: f.source },
      back: { date: f.ret_date, time: f.ret_time, airline: f.airline, price_eur: null, link: "", source: f.source } });
    if (noDates) {
      const idx = new Map(all.filter(f => !f.ret_date).map(f => [`${f.source}|${f.origin}|${f.dest}|${f.dep_date}`, f]));
      for (const f of all) {
        if (!f.ret_date || !orig.includes(f.origin) || f.dep_date < depFrom) continue;
        const k = `${f.origin}|${f.dest}|RT`, c = best.get(k);
        if (c && f.price_eur >= c.price_eur) continue;
        const item = rtItem(f);
        const o = idx.get(`${f.source}|${f.origin}|${f.dest}|${f.dep_date}`), b = idx.get(`${f.source}|${f.dest}|${f.origin}|${f.ret_date}`);
        if (o && b && f.source !== "aviasales") { item.out = leg(o); item.back = leg(b); }
        best.set(k, item);
      }
    } else if (retFrom) {
      const backs = new Map();
      for (const f of all) {
        if (f.ret_date || !orig.includes(f.dest) || f.dep_date < retFrom || f.dep_date > retTo) continue;
        const k = `${f.dest}|${f.origin}`;
        (backs.get(k) || backs.set(k, []).get(k)).push(f);
      }
      for (const o of outs) {
        for (const b of backs.get(`${o.origin}|${o.dest}`) || []) {
          if (b.dep_date <= o.dep_date) continue;
          const total = Math.round((o.price_eur + b.price_eur) * 100) / 100;
          const k = `${o.origin}|${o.dest}|RT`, c = best.get(k);
          if (c && total >= c.price_eur) continue;
          const same = o.source === b.source;
          best.set(k, { origin: o.origin, dest: o.dest, trip: "RT", dep_date: o.dep_date, ret_date: b.dep_date, price_eur: total,
            price_ron: Math.round((o.price_ron + b.price_ron) * 100) / 100, lei_exact: o.lei_exact && b.lei_exact,
            out: leg(o), back: leg(b), link: same && o.source !== "aviasales" ? link({ ...o, ret_date: b.dep_date }) : "",
            airline: same ? o.airline : `${o.airline} + ${b.airline}`, source: same ? o.source : "mixed",
            last_seen: [o.last_seen, b.last_seen].sort()[0] });
        }
      }
      for (const f of all) {
        if (f.source !== "aviasales" || !f.ret_date || !orig.includes(f.origin)) continue;
        if (f.dep_date < depFrom || f.dep_date > depTo || f.ret_date < retFrom || f.ret_date > retTo) continue;
        put(`${f.origin}|${f.dest}|RT`, rtItem(f));
      }
    }
    const minDisc = (await load("status")).settings?.rules?.min_discount_pct ?? 40;
    const rows = [...best.values()];
    for (const r of rows) {
      const t = (stats[`${r.origin}|${r.dest}|${r.trip}`] || [])[0] ?? null;
      r.typical_eur = t;
      r.discount_pct = t ? Math.round((t - r.price_eur) / t * 1000) / 10 : null;
      r.is_deal = r.discount_pct != null && r.discount_pct >= minDisc;
      r.days_to_dep = days(today(), r.dep_date);
    }
    rows.sort((a, b) => a.price_eur - b.price_eur);
    return enrich(rows);
  }

  // ---------- /api/exotic ----------
  async function exotic(q) {
    const st = await load("status"), ex = st.settings?.exotic || { origin: "BUD", min_nights: 5, max_nights: 28 };
    const all = await fares(), places = await load("places"), stats = await load("stats"), t0 = today();
    const best = new Map(), counts = new Map();
    for (const f of all) {
      if (f.origin !== ex.origin || f.dep_date < t0) continue;
      const reg = (places[f.dest] || [])[2];
      if (!reg) continue;
      if (f.ret_date) { const n = days(f.dep_date, f.ret_date); if (n < ex.min_nights || n > ex.max_nights) continue; }
      if (q.dep_from && (f.dep_date < q.dep_from || f.dep_date > (q.dep_to || q.dep_from))) continue;
      if (q.ret_from && (!f.ret_date || f.ret_date < q.ret_from || f.ret_date > (q.ret_to || q.ret_from))) continue;
      const k = `${f.dest}|${f.trip}`;
      counts.set(k, (counts.get(k) || 0) + 1);
      const c = best.get(k);
      if (!c || f.price_eur < c.price_eur) best.set(k, { ...f, region: reg });
    }
    const items = [...best.entries()].map(([k, r]) => {
      const t = (stats[`${r.origin}|${r.dest}|${r.trip}`] || [])[0] ?? null;
      return { ...r, typical_eur: t, discount_pct: t ? Math.round((t - r.price_eur) / t * 1000) / 10 : null,
        region_label: REGIONS[r.region], other_dates: counts.get(k) - 1, days_to_dep: days(t0, r.dep_date) };
    }).sort((a, b) => a.price_eur - b.price_eur);
    return { origin: ex.origin, origin_name: NAMES[ex.origin] || ex.origin, aviasales: !!st.settings?.aviasales,
      regions: REGIONS, fares: await enrich(items), posts: await load("exotic_posts") };
  }

  // ---------- /api/route și /api/route-deals ----------
  async function route(q) {
    const o = q.origin, d = q.dest, all = await fares(), places = await load("places"), stats = await load("stats");
    const mine = all.filter(f => f.origin === o && f.dest === d);
    const cal = rt => {
      const m = new Map();
      for (const f of mine) if (!!f.ret_date === rt) { const c = m.get(f.dep_date); if (c == null || f.price_eur < c) m.set(f.dep_date, f.price_eur); }
      return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dep_date, price_eur]) => ({ dep_date, price_eur }));
    };
    const st = {};
    for (const t of ["OW", "RT"]) {
      const s = stats[`${o}|${d}|${t}`];
      if (s) st[t] = { typical_eur: s[0], min_prev_eur: s[1], history_days: s[2] };
    }
    const hist = ((await load("hist"))[`${o}|${d}`] || []).map(h => ({ day: h[0], trip: "OW", min_eur: h[1], p50_eur: h[2] }));
    const cheapest = mine.slice().sort((a, b) => a.price_eur - b.price_eur).slice(0, 60).map(f => ({ ...f }));
    return { origin: o, dest: d, origin_name: NAMES[o] || o, dest_name: (places[d] || [])[0] || d, country: (places[d] || [])[1] || "",
      calendar_ow: cal(false), calendar_rt: cal(true), history: hist, cheapest: await enrich(cheapest), stats: st };
  }
  async function routeDeals(q) {
    const all = await fares(), deals = await load("deals_all");
    const idx = new Map(all.map(f => [`${f.source}|${f.origin}|${f.dest}|${f.dep_date}|${f.ret_date}`, f]));
    const rows = deals.filter(x => x[1] === q.origin && x[2] === q.dest && x[3] === (q.trip || "OW"))
      .map(x => { const f = idx.get(`${SRC[x[0]]}|${x[1]}|${x[2]}|${x[4]}|${x[5]}`); return f ? { ...f, flags: x[6], score: x[7] } : null; })
      .filter(Boolean).sort((a, b) => a.price_eur - b.price_eur || a.dep_date.localeCompare(b.dep_date));
    return enrich(rows);
  }

  window.staticApi = async function (path) {
    const u = new URL(path, location.origin);
    const q = Object.fromEntries(u.searchParams);
    switch (u.pathname.replace(/^.*\/api\//, "")) {
      case "status": {
        const s = await fetch(`data/status.json?t=${Date.now()}`).then(r => r.json());
        if (generated && s.generated_at !== generated) { cache = {}; faresP = null; window.DATA_VERSION = s.generated_at; }
        generated = s.generated_at;
        cache.status = Promise.resolve(s);
        return s;
      }
      case "deals": return load("deals");
      case "destinations": return load("destinations");
      case "posts": return load("posts");
      case "lastminute": return lastminute(q);
      case "search": return search(q);
      case "exotic": return exotic(q);
      case "route": return route(q);
      case "route-deals": return routeDeals(q);
      default: throw new Error("necunoscut: " + path);
    }
  };
})();
