// The roadmap page's Big picture: the maths behind its four pictures, from the roadmap document's `picture`
// (tools/stats_docs.py). No DOM here, so stats/test/test_picture.mjs checks the same code the page runs.
// Days are calendar days as "YYYY-MM-DD", read at noon UTC so they stay the same day in Pacific time.
"use strict";
const BoxRunPicture = (() => {
  const DAY = 86400e3;
  const ms = (day) => Date.parse(day + "T12:00:00Z");
  const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const addDays = (day, n) => new Date(ms(day) + n * DAY).toISOString().slice(0, 10);
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // "Mon 11-16"
  const dowDay = (day) => DOW[new Date(ms(day)).getUTCDay()] + " " + day.slice(5);
  // "Dec 31", with the year when it isn't `year` ("Mar 31, 2027")
  const monthDay = (day, year) => MON[+day.slice(5, 7) - 1] + " " + +day.slice(8) + (year && day.slice(0, 4) !== String(year) ? ", " + day.slice(0, 4) : "");
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  // The route's scale: each stretch between two checkpoints the same width, time even within a stretch, like a
  // route's splits. A day before the first checkpoint is 0, after the last 1.
  function stretchPos(checkpoints, day) {
    const ds = checkpoints.map((c) => c.date).filter(Boolean);
    if (ds.length < 2 || !day) return 0;
    if (day <= ds[0]) return 0;
    if (day >= ds[ds.length - 1]) return 1;
    const n = ds.length - 1;
    for (let i = 0; i < n; i++) {
      if (day <= ds[i + 1]) return (i + daysBetween(ds[i], day) / daysBetween(ds[i], ds[i + 1])) / n;
    }
    return 1;
  }

  // Lanes for marks on one axis that mustn't overlap: items [{pos, size}] (centre and length, same units), each put in the
  // lowest lane where it keeps `gap` from every mark there. With stems (a pin's line down to the route), a mark in
  // lane k also needs its stem clear of the marks in the lanes under it, and no stem from above may cross it; a mark
  // that can't have both (a pin right over a label) takes the lowest lane free of marks. Items go in by position, or in
  // the order given with `ordered` (labels first, then pins). Returns each item's lane.
  function packLanes(items, gap = 0, opts = {}) {
    const placed = [], out = new Array(items.length);
    const order = items.map((it, i) => [it, i]);
    if (!opts.ordered) order.sort((a, b) => a[0].pos - b[0].pos);
    const hit = (a, as, b, bs) => Math.abs(a - b) < (as + bs) / 2 + gap;
    const free = (it, k, stems) => !placed.some((o) =>
      (o.lane === k && hit(o.pos, o.size, it.pos, it.size)) ||
      (stems && o.lane > k && hit(o.pos, 2, it.pos, it.size)) ||          // a stem from above through it
      (stems && o.lane < k && hit(o.pos, o.size, it.pos, 2)));            // its stem through a lower mark
    for (const [it, i] of order) {
      let k = 0;
      while (k < 12 && !free(it, k, opts.stems)) k++;
      if (k === 12) for (k = 0; !free(it, k, false); k++);
      placed.push({ pos: it.pos, size: it.size, lane: k });
      out[i] = k;
    }
    return out;
  }

  // A decision's date chip against the viewer's day: "Mon 11-16, in 5 days", "Mon 11-16, today", or due once passed.
  function dateChip(day, today) {
    if (!day) return { text: "", due: false, days: null };
    const n = daysBetween(today, day);
    if (n < 0) return { text: dowDay(day) + ", due", due: true, days: n };
    return { text: dowDay(day) + ", " + (n === 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days"), due: false, days: n };
  }

  // Decisions by look-again date; those without one ("two weeks after it ships") after, in number order.
  function sortDecisions(list) {
    const dated = list.filter((d) => d.look_again).sort((a, b) => (a.look_again < b.look_again ? -1 : a.look_again > b.look_again ? 1 : a.n - b.n));
    return { dated, undated: list.filter((d) => !d.look_again).sort((a, b) => a.n - b.n) };
  }

  // A circle's radius with its area in proportion to views; the biggest gets rMax. Unknown views get null.
  function radius(views, maxViews, rMax, rMin = 2.5) {
    if (views === null || views === undefined || !(maxViews > 0)) return null;
    return Math.max(rMin, rMax * Math.sqrt(views / maxViews));
  }

  // Own Shorts as the chart's circles: YouTube and TikTok of the same day and hook as one, views added up (null when
  // none of them has a number).
  function groupShorts(posts) {
    const m = new Map();
    for (const p of posts || []) {
      if (!p.day) continue;
      const k = p.day + "|" + (p.hook || p.title || "");
      if (!m.has(k)) m.set(k, { day: p.day, hook: p.hook || null, views: null, posts: [] });
      const g = m.get(k);
      g.posts.push(p);
      if (typeof p.views === "number") g.views = (g.views || 0) + p.views;
    }
    return [...m.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }

  // "+1,680 ahead of pace", "−11 behind pace", "on pace", or null without a pace.
  function deltaLabel(delta) {
    if (delta === null || delta === undefined) return null;
    const r = Math.round(delta);
    if (r === 0) return { text: "on pace", tone: "even" };
    return r > 0 ? { text: "+" + fmt(r) + " ahead of pace", tone: "ahead" } : { text: "\u2212" + fmt(-r) + " behind pace", tone: "behind" };
  }

  // A splits row's bar runs from 0 to its next target: where Now and the pace fall on it (0 to 1).
  function splitBar(row) {
    if (!row.next || !(row.next.value > 0)) return null;
    const at = (v) => (v === null || v === undefined ? null : Math.max(0, Math.min(1, v / row.next.value)));
    return { fill: at(row.now), pace: at(row.pace) };
  }

  // "65% of runs on the 7 samples" -> ["65%", "of runs on the 7 samples"]: the number in the display font, the rest small.
  function splitNumber(text) {
    const m = String(text || "").match(/^(\d[\d,.]*%?K?M?)(?:\s+(.*))?$/);
    return m ? [m[1], m[2] || ""] : [null, String(text || "")];
  }

  // The engine's layout: a column per flow stage, Releases and Valve (work, goal) in a row under them. Within a column
  // a part fed from a later column (the weekly board feeding Own Shorts) comes first, so the arc over the top reaches it;
  // the rest follow their Feeds to each other (a part fed by another in its column comes after it), else table order.
  const FLOW = ["find", "install", "play", "stay"];
  function engine(parts) {
    const stageOf = new Map(parts.map((p) => [p.id, FLOW.indexOf(p.stage)]));
    const fedBack = new Set(parts.flatMap((p) => p.feeds.filter((f) => stageOf.get(f) >= 0 && stageOf.get(f) < stageOf.get(p.id))));
    const cols = FLOW.map((s) => {
      const all = parts.filter((p) => p.stage === s);
      const first = all.filter((p) => fedBack.has(p.id));
      const here = all.filter((p) => !fedBack.has(p.id)), ids = new Set(here.map((p) => p.id));
      const indeg = new Map(here.map((p) => [p.id, 0]));
      for (const p of here) for (const f of p.feeds) if (ids.has(f) && f !== p.id) indeg.set(f, indeg.get(f) + 1);
      const out = first.slice(), left = here.slice();
      while (left.length) {
        let i = left.findIndex((p) => indeg.get(p.id) === 0);
        if (i < 0) i = 0;                               // a loop: take the first left
        const [p] = left.splice(i, 1);
        out.push(p);
        for (const f of p.feeds) if (indeg.has(f)) indeg.set(f, indeg.get(f) - 1);
      }
      return { stage: s, parts: out };
    });
    const col = new Map();
    cols.forEach((c, i) => c.parts.forEach((p, j) => col.set(p.id, [i, j])));
    const edges = [];
    for (const p of parts) for (const f of p.feeds) {
      if (!col.has(p.id) || !col.has(f)) continue;
      const [a, ai] = col.get(p.id), [b, bi] = col.get(f);
      edges.push({ from: p.id, to: f, kind: b > a ? "forward" : b < a ? "back" : bi - ai === 1 ? "down" : "side" });
    }
    return { cols, below: parts.filter((p) => !FLOW.includes(p.stage)), edges };
  }

  return { stretchPos, packLanes, dateChip, sortDecisions, radius, groupShorts, deltaLabel, splitBar, splitNumber, engine,
           dowDay, monthDay, daysBetween, addDays, fmt, FLOW };
})();
if (typeof module === "object" && module.exports) module.exports = BoxRunPicture;
