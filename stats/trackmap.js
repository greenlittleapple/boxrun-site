// The roadmap page's map: the maths behind the tracks and sub-tracks, from the roadmap document's `map`
// (tools/stats_docs.py track_map). No DOM here, so stats/test/test_trackmap.mjs checks the same code the page runs.
// Days are calendar days as "YYYY-MM-DD".
"use strict";
const BoxRunTrackMap = (() => {
  const trackOf = (id) => id.split("/")[0];
  const nodesOf = (map) => map.tracks.flatMap((t) => [t, ...t.subs]);

  // Every track and sub-track by id.
  function index(map) {
    return new Map(nodesOf(map).map((n) => [n.id, n]));
  }

  // The time columns: one per checkpoint that is still ahead on `today`.
  function columns(checkpoints, today) {
    return (checkpoints || []).filter((c) => c.date && c.date >= today).map((c) => ({ date: c.date, name: c.name }));
  }

  // A node's goals by column: `cols[i]` holds the goals due after the column before and by column i's day (a goal
  // later than every column sits in the last), `soon` the goals with a condition in place of a day or a day that has passed.
  function goalsByColumn(node, cols, today) {
    const out = { soon: [], cols: cols.map(() => []) };
    for (const g of node.goals || []) {
      if (!g.date || g.date < today || !cols.length) { out.soon.push(g); continue; }
      const i = cols.findIndex((c) => c.date >= g.date);
      out.cols[i < 0 ? cols.length - 1 : i].push(g);
    }
    return out;
  }

  // The one goal a sub-track shows under its name: the next still ahead on `today` in the doc's order (a goal with a
  // condition in place of a day counts as ahead), and a goal of its own before the look at a decision
  // ("decision 2's look: ..."), which the decision's pin already marks. null when none is ahead.
  function nextGoal(node, today) {
    const ahead = (node.goals || []).filter((g) => !g.date || g.date >= today);
    return ahead.find((g) => !/^decision \d+'s look\b/i.test(g.text || "")) || ahead[0] || null;
  }

  // A track's numbers that are measured against a goal: its Now lines filled from a key the scorecard holds a target
  // for, each with that target and the share of it reached (0 to 1, null without a number). The rest of its Now
  // lines have no goal to read them against.
  function goalNumbers(node, scorecard) {
    const out = [];
    for (const n of node.now || []) {
      const s = n.auto ? (scorecard || []).find((x) => x.auto === n.auto) : null;
      if (!s || !s.next || !(s.next.value > 0)) continue;
      out.push({ value: n.value, label: n.label, auto: n.auto, next: s.next,
                 share: typeof s.now === "number" ? Math.max(0, Math.min(1, s.now / s.next.value)) : null });
    }
    return out;
  }

  // What feeds each node: Map(id -> [{from, why}]) in the doc's order. A feed to every track ("*") reaches each other track.
  function fedBy(map) {
    const out = new Map();
    const add = (to, from, why) => { if (!out.has(to)) out.set(to, []); out.get(to).push({ from, why }); };
    for (const n of nodesOf(map)) for (const f of n.feeds || []) {
      if (f.to === "*") { for (const t of map.tracks) if (t.id !== trackOf(n.id)) add(t.id, n.id, f.why); }
      else add(f.to, n.id, f.why);
    }
    return out;
  }

  // The connections between tracks for the overview: the tracks' own Feeds lines, in the doc's order. `all` marks a
  // feed to every track; `rows` are the first and last track row the connection spans.
  function trackEdges(map) {
    const row = new Map(map.tracks.map((t, i) => [t.id, i]));
    const edges = [];
    for (const t of map.tracks) for (const f of t.feeds || []) {
      if (f.to !== "*" && !row.has(f.to)) continue;
      edges.push({ from: t.id, to: f.to, why: f.why, all: f.to === "*",
                   rows: f.to === "*" ? [0, map.tracks.length - 1] : [row.get(t.id), row.get(f.to)].sort((a, b) => a - b) });
    }
    return edges;
  }

  // Where each connection between two tracks runs when the tracks sit side by side in a row: a feed to a later track
  // above the row, a feed to an earlier one below it, each in a slot (0 nearest the row) that no overlapping connection
  // on its side shares. `xa` and `xb` are where its ends sit along the two tracks' edges (0 to 1): those going left
  // first, shortest outermost, so two ends never meet and a longer connection doesn't cross a shorter one.
  function edgeLayout(map) {
    const row = new Map(map.tracks.map((t, i) => [t.id, i]));
    const list = trackEdges(map).filter((e) => !e.all && e.rows[0] !== e.rows[1]).map((e) => ({
      from: e.from, to: e.to, why: e.why, a: row.get(e.from), b: row.get(e.to), lo: e.rows[0], hi: e.rows[1],
      side: row.get(e.to) > row.get(e.from) ? "up" : "down", slot: 0, xa: 0.5, xb: 0.5 }));
    for (const side of ["up", "down"]) {
      const mine = list.filter((e) => e.side === side), placed = [];
      for (const e of [...mine].sort((x, y) => (x.hi - x.lo) - (y.hi - y.lo) || x.lo - y.lo)) {
        while (placed.some((p) => p.slot === e.slot && p.lo < e.hi && e.lo < p.hi)) e.slot++;
        placed.push(e);
      }
      for (let i = 0; i < map.tracks.length; i++) {
        const ends = mine.filter((e) => e.a === i || e.b === i).map((e) => ({ e, other: e.a === i ? e.b : e.a }));
        const left = (p) => p.other < i, far = (p) => Math.abs(p.other - i);
        ends.sort((p, q) => (left(p) ? 0 : 1) - (left(q) ? 0 : 1) || (left(p) ? far(p) - far(q) : far(q) - far(p)));
        ends.forEach((p, k) => { p.e[p.e.a === i ? "xa" : "xb"] = (k + 1) / (ends.length + 1); });
      }
    }
    return list;
  }

  // How many feeds there are in all (every Feeds line of every track and sub-track).
  const feedCount = (map) => nodesOf(map).reduce((n, x) => n + (x.feeds || []).length, 0);

  // A sub-track's items in the groups the page lists them in. `items` is Map(id -> item) from the id tables.
  // now and next keep the order of the doc's Items now and Items next lines; the rest keep the Items line's order.
  function itemGroups(sub, items) {
    const now = sub.items_now || [], next = sub.items_next || [];
    const g = { now: [], next: [], later: [], parked: [], done: [] };
    for (const id of sub.items || []) {
      const cls = items.has(id) ? items.get(id).state_class : "other";
      if (cls === "done") g.done.push(id);
      else if (now.includes(id) || next.includes(id)) continue;
      else if (cls === "parked") g.parked.push(id);
      else g.later.push(id);
    }
    const open = (id) => (sub.items || []).includes(id) && !(items.has(id) && items.get(id).state_class === "done");
    g.now = now.filter(open);
    g.next = next.filter((id) => open(id) && !now.includes(id));
    return g;
  }

  // The same groups counted over a track's sub-tracks.
  function trackCounts(track, items) {
    const c = { now: 0, next: 0, later: 0, parked: 0, done: 0, all: 0 };
    for (const s of track.subs) {
      const g = itemGroups(s, items);
      for (const k of Object.keys(g)) { c[k] += g[k].length; c.all += g[k].length; }
    }
    return c;
  }

  // The scorecard rows the page leads with (decision 9: returning players a day, players since launch, creators with
  // a video), each with the share of its next target reached (0 to 1, null without a number or a target).
  const LEAD = ["returning_7d", "players_since_launch", "creators"];
  function leadNumbers(scorecard) {
    return LEAD.map((key) => (scorecard || []).find((s) => s.auto === key)).filter(Boolean).map((s) => ({
      measure: s.measure, text: s.now_text, now: s.now, next: s.next || null,
      share: s.next && s.next.value > 0 && typeof s.now === "number" ? Math.max(0, Math.min(1, s.now / s.next.value)) : null,
    }));
  }

  // The ids of items named in a line of Today (inline spans or text), for showing the line on their sub-tracks.
  function idsIn(line) {
    const text = typeof line === "string" ? line : (line || []).map((s) => s[1]).join("");
    return [...new Set(text.match(/\b[A-Z]{3,7}-\d+\b/g) || [])];
  }

  // Map(sub-track id -> [line, ...]) for the lines of a Today list that name one of the sub-track's items.
  function linesBySub(map, lines) {
    const home = new Map();
    for (const t of map.tracks) for (const s of t.subs) for (const id of s.items || []) home.set(id, s.id);
    const out = new Map();
    for (const line of lines || []) {
      for (const sid of new Set(idsIn(line).map((id) => home.get(id)).filter(Boolean))) {
        if (!out.has(sid)) out.set(sid, []);
        out.get(sid).push(line);
      }
    }
    return out;
  }

  return { index, trackOf, nodesOf, columns, goalsByColumn, nextGoal, goalNumbers, fedBy, trackEdges, edgeLayout, feedCount, itemGroups, trackCounts, leadNumbers,
           idsIn, linesBySub };
})();
if (typeof module === "object" && module.exports) module.exports = BoxRunTrackMap;
