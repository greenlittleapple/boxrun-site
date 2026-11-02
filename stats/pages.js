// The stats subpages' shared parts: the key (the same one /stats keeps), loading a private document from
// GET /v1/stats/docs, and building text into the page. Every piece of a document goes in by textContent.
"use strict";
const Stats = (() => {
  const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const SYNTH = LOCAL && location.search.includes("synth=1");
  const STORE = "boxrunStatsKey";
  const TZ = "America/Los_Angeles";
  const REFRESH = 5 * 60e3;
  const ID = /\b((?:SHOW|FIND|EASE|LOOK|COUNT|SAFE|MAKE|PLAY|REACH|LISTEN|GOAL)-\d+)\b/g;
  let sessionKey = "";
  const $ = (id) => document.getElementById(id);

  function getKey() { try { return localStorage.getItem(STORE) || sessionKey; } catch (e) { return sessionKey; } }
  function setKey(k) { sessionKey = k; try { k ? localStorage.setItem(STORE, k) : localStorage.removeItem(STORE); } catch (e) {} }

  // el("td", {className: "num", text: "12"}, child, ...): text always as textContent; attributes by setAttribute.
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "text") n.textContent = String(v);
      else if (k === "className") n.className = v;
      else if (k === "on") for (const [ev, f] of Object.entries(v)) n.addEventListener(ev, f);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  const safeUrl = (u) => (typeof u === "string" && /^https:\/\/[^\s"<>]+$/.test(u) ? u : null);
  const fmt = (n) => (n === null || n === undefined || n === "" ? "–" : Number(n).toLocaleString("en-US"));
  const compact = (n) => (n >= 1e6 ? +(n / 1e6).toFixed(1) + "M" : n >= 1000 ? +(n / 1000).toFixed(1) + "K" : String(n));
  const fWhen = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fDay = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
  const when = (t) => { const d = new Date(t); return isNaN(d) ? String(t || "") : fWhen.format(d); };
  // A plain YYYY-MM-DD is a calendar day: read it at noon UTC so it's the same day in Pacific time.
  const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? fDay.format(new Date(s + "T12:00:00Z")) : String(s || "–"));

  // Text with roadmap ids made into links: href(id) gives the link, or null to leave the id as text.
  function linkIds(parent, text, href) {
    let last = 0;
    for (const m of text.matchAll(ID)) {
      const h = href(m[1]);
      if (!h) continue;
      if (m.index > last) parent.append(text.slice(last, m.index));
      parent.append(el("a", { href: h, className: "idlink", text: m[1] }));
      last = m.index + m[1].length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }
  // Inline spans from tools/stats_docs.py: [["t"|"b"|"c", text], ...]
  function spans(parent, list, href) {
    for (const [kind, text] of list || []) {
      if (kind === "c") parent.append(el("code", { text }));
      else if (kind === "b") { const b = el("strong"); linkIds(b, String(text), href); parent.append(b); }
      else linkIds(parent, String(text), href);
    }
    return parent;
  }
  function blocks(parent, list, href) {
    for (const b of list || []) {
      if (b.type === "p") parent.append(spans(el("p"), b.inl, href));
      else if (b.type === "ul" || b.type === "ol") {
        const l = el(b.type);
        for (const it of b.items || []) {
          const li = spans(el("li"), it.inl, href);
          if (it.sub && it.sub.length) li.append(el("ul", null, it.sub.map((s) => spans(el("li"), s, href))));
          l.append(li);
        }
        parent.append(l);
      }
    }
    return parent;
  }
  const roadmapHref = (id) => "/stats/roadmap/#" + id;

  // Sortable table headers: cols [{key, label, num, sort(row) -> value}], state {key, dir}, onChange().
  function sortHead(tr, cols, state, onChange) {
    tr.replaceChildren(...cols.map((c) => {
      const th = el("th", { className: c.num ? "num" : null, scope: "col" });
      if (c.sort) {
        th.setAttribute("aria-sort", state.key === c.key ? (state.dir > 0 ? "ascending" : "descending") : "none");
        th.append(el("button", { type: "button", text: c.label, on: { click: () => {
          state.dir = state.key === c.key ? -state.dir : (c.num ? -1 : 1);
          state.key = c.key; onChange();
        } } }));
      } else th.textContent = c.label;
      return th;
    }));
  }
  function sortRows(rows, cols, state) {
    const c = cols.find((x) => x.key === state.key);
    if (!c || !c.sort) return rows;
    return rows.slice().sort((a, b) => {
      const x = c.sort(a), y = c.sort(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;           // empty values last either way
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * state.dir;
    });
  }

  // A segmented control: options [[value, label, count?]], current value, onPick(value).
  function seg(box, options, current, onPick) {
    box.replaceChildren(...options.map(([v, label, count]) => el("button", {
      type: "button", "aria-pressed": String(v === current), "data-v": v,
      on: { click: () => onPick(v) } }, label, count !== undefined ? el("span", { className: "c", text: count }) : null)));
  }
  function prefs(name, defaults) {
    const p = Object.assign({}, defaults);
    try { Object.assign(p, JSON.parse(localStorage.getItem(name) || "{}")); } catch (e) {}
    return { p, save: () => { try { localStorage.setItem(name, JSON.stringify(p)); } catch (e) {} } };
  }

  // The page's load cycle: key form, fetch, render(body), refresh every 5 minutes while visible.
  function start(name, render) {
    let timer = null, got = null;
    const url = (LOCAL ? "" : "https://api.boxrun.gg") + "/v1/stats/docs?name=" + name + (SYNTH ? "&synth=1" : "");
    function showAsk(message) {
      $("main").hidden = true; $("live").hidden = true; $("ask").hidden = false;
      $("keyerror").textContent = message || "";
      clearTimeout(timer);
      $("key").focus();
    }
    function schedule() { clearTimeout(timer); if (!document.hidden) timer = setTimeout(load, REFRESH); }
    async function load() {
      const key = getKey();
      if (!key) return showAsk();
      try {
        const r = await fetch(url, { headers: { authorization: "Bearer " + key }, cache: "no-store" });
        if (r.status === 404 || r.status === 401) { setKey(""); return showAsk("That key didn't work."); }
        if (!r.ok) throw new Error("the server answered " + r.status);
        const body = await r.json();
        got = Date.now();
        $("ask").hidden = true; $("main").hidden = false; $("live").hidden = false;
        $("dot").classList.remove("stale");
        $("error").textContent = "";
        if (!body.doc) {
          $("main").replaceChildren(el("p", { className: "empty", text: "Not uploaded yet. The coordinator uploads it with python tools/stats_docs.py push." }));
        } else render(body);
        $("updated").textContent = "Uploaded " + when(body.uploaded);
      } catch (e) {
        $("error").textContent = "Couldn't load this page's data (" + e.message + "). Trying again in 5 minutes.";
        $("dot").classList.add("stale");
      }
      schedule();
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearTimeout(timer); return; }
      if (!got || Date.now() - got > REFRESH) load(); else schedule();
    });
    $("keyform").addEventListener("submit", (e) => { e.preventDefault(); setKey($("key").value.trim()); $("key").value = ""; load(); });
    $("forget").addEventListener("click", () => { setKey(""); got = null; showAsk(); });
    load();
  }
  return { el, $, safeUrl, fmt, compact, when, day, spans, blocks, linkIds, roadmapHref, sortHead, sortRows, seg, prefs, start, TZ };
})();
