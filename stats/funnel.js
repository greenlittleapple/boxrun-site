// The Funnel section's numbers (COUNT-6, docs/BOXRUN-MEASUREMENT.md 5.4 and 5.8), from the /v1/stats answer only:
// its funnel rows (one per first day: the steps once per install, back_d1, back_w2) and the per-day counts in days
// (active, active_wk, runs_*, kinds). No DOM here, so stats/test/test_funnel.mjs checks the same code the page runs.
// Days are Pacific calendar days as "YYYY-MM-DD"; weeks run Monday to Sunday, as the game's wk flag does.
"use strict";
const BoxRunFunnel = (() => {
  const DAY = 86400e3;
  // FIRST (COUNT-10, 2.3): the steps between the first load and the first run, sent only by installs whose first load
  // was on 2.3 or later, so a first day before 2.3 has none of them (FIRST_NONE: drawn as a dash, not 0)
  const FIRST = ["seen", "shot", "press", "go", "ready"];
  const STEPS = ["load", "menu", ...FIRST, "start", "finish", "count"];
  // V23 (COUNT-11): the same steps for installs whose step came from 2.3 or later, so FIRST reads against 2.3 loads.
  // The server sends a row's v23 (load, menu, start, finish, count) from 11-09; a row without 2.3 loads has v23 null.
  const V23 = ["load", "menu", ...FIRST, "start", "finish", "count"];
  const V23_FROM = "2026-11-10";      // the first whole day of the 2.3 cohort (the API counted it from 11-09 ~14:00 PST)
  const ms = (day) => Date.parse(day + "T12:00:00Z");
  const addDays = (day, n) => new Date(ms(day) + n * DAY).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const monday = (day) => addDays(day, -((new Date(ms(day)).getUTCDay() + 6) % 7));
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const share = (part, whole) => (whole > 0 ? part / whole : null);

  // A return's window for a first day: back_d1 is sent on day 1, back_w2 the first time the install plays on days
  // 7-13. Until the window's last day is over, the count can still grow, so it's pending, not a share.
  const WINDOWS = { back_d1: [1, 1], back_w2: [7, 13] };
  function windowOf(key, day, today) {
    const [from, to] = WINDOWS[key], age = daysBetween(day, today);
    return { state: age > to ? "closed" : age >= from ? "open" : "later", opens: addDays(day, from), closes: addDays(day, to) };
  }

  // Every first day from the first one counted to today, oldest first; a day with no row is a day with no first loads.
  function cohorts(b) {
    const today = b.today;
    const rows = new Map((Array.isArray(b.funnel) ? b.funnel : []).map((r) => [r.day, r]));
    if (!rows.size || !today) return [];
    const out = [];
    for (let day = [...rows.keys()].sort()[0]; day <= today; day = addDays(day, 1)) {
      const r = rows.get(day) || {};
      const c = { day, age: daysBetween(day, today), today: day === today, empty: !rows.has(day) };
      for (const s of STEPS) c[s] = n(r[s]);
      c.firstNone = FIRST.every((s) => !n(r[s]));
      const v = r.v23 || {};
      // V23_FROM: the cohort was deployed partway through 11-09, so that day's 2.3 loads are a fraction of its 2.3 steps
      c.v23 = n(v.load) && day >= V23_FROM ? Object.fromEntries(V23.map((s) => [s, n(FIRST.includes(s) ? r[s] : v[s])])) : null;
      for (const k of Object.keys(WINDOWS)) c[k] = { n: n(r[k]), ...windowOf(k, day, today) };
      out.push(c);
    }
    return out;
  }

  // A return over the last 7 first days whose window has closed, pooled (returns over first loads, so one big day
  // weighs as its players do), with the newest closed first day on its own.
  function pooled(rows, key) {
    const closed = rows.filter((r) => r[key].state === "closed");
    const last = closed.slice(-7);
    const back = last.reduce((s, r) => s + r[key].n, 0), load = last.reduce((s, r) => s + r.load, 0);
    const newest = closed[closed.length - 1] || null;
    const waiting = rows.filter((r) => r[key].state === "open");
    return { back, load, share: share(back, load), from: last.length ? last[0].day : null, to: newest ? newest.day : null,
             cohorts: last.length, newest: newest && { day: newest.day, back: newest[key].n, load: newest.load, share: share(newest[key].n, newest.load) },
             spark: closed.slice(-14).map((r) => share(r[key].n, r.load)),
             open: waiting.length ? { day: waiting[0].day, back: waiting[0][key].n, load: waiting[0].load, closes: waiting[0][key].closes } : null };
  }

  // Calendar weeks (Monday to Sunday) from the week of the first counted day to this week. Weekly actives add up
  // active_wk (an install sends wk once, on its first play day of the week), so they're distinct installs.
  function weeks(b) {
    const days = (Array.isArray(b.days) ? b.days : []).filter((d) => d.day <= b.today);
    const counted = days.filter((d) => n(d.active) || n(d.runs_start));
    if (!counted.length) return [];
    const out = new Map();
    for (let w = monday(counted[0].day); w <= b.today; w = addDays(w, 7)) {
      out.set(w, { week: w, end: addDays(w, 6), current: w === monday(b.today), days: 0, actives: 0, start: 0, finish: 0, count: 0, community: 0, pack: 0, kinds: 0 });
    }
    for (const d of days) {
      const w = out.get(monday(d.day));
      if (!w) continue;
      const k = d.kinds || {};
      w.days += 1;
      w.actives += n(d.active_wk);
      w.start += n(d.runs_start); w.finish += n(d.runs_finish); w.count += n(d.runs_count);
      w.community += n(k.community); w.pack += n(k.pack);
      w.kinds += n(k.sample) + n(k.pack) + n(k.community) + n(k.own);
    }
    return [...out.values()].map((w) => ({ ...w, perPlayer: share(w.count, w.actives), startedPer: share(w.start, w.actives),
      finishedPer: share(w.finish, w.actives), communityShare: share(w.community + w.pack, w.kinds) }));
  }

  // Back from the day before (the older measure, as tools/growth_snapshot.py's menu_return): a day's menu_back over
  // the day before's menu_players. Every player by scrambled address, not new installs only. Today is partial and
  // kept apart from the series.
  function menuReturn(b) {
    const days = (Array.isArray(b.days) ? b.days : []).filter((d) => d.day <= b.today);
    const pairs = [];
    for (let i = 1; i < days.length; i++) {
      const d = days[i], prev = days[i - 1], ok = Number.isFinite(d.menu_back) && Number.isFinite(prev.menu_players);
      pairs.push({ day: d.day, back: ok ? d.menu_back : null, before: ok ? prev.menu_players : null, share: ok ? share(d.menu_back, prev.menu_players) : null });
    }
    const full = pairs.filter((p) => p.day !== b.today && p.share !== null);
    const newest = full[full.length - 1] || { day: null, back: null, before: null, share: null };
    return { ...newest, spark: full.slice(-14).map((p) => p.share), today: pairs.find((p) => p.day === b.today) || null };
  }

  // Installs per download since 2.1 (as growth_snapshot.py's install bound): first loads from 2.1's Pacific day on,
  // over GameBanana's total downloads less PRE_21_DOWNLOADS. That's the total less the listed files' sum read
  // 2026-11-04 (3,800, then 3,804): the files removed before 2.1, whose downloads stay in the total (removing a file
  // doesn't lower it, as those removals show). It's a lower bound on installs per download (review 11-10): update
  // downloads inflate the downloads, and games with counts off or offline send no first load.
  const PRE_21_DOWNLOADS = 3800, DAY_2_1 = "2026-11-02";
  function installBound(b) {
    const gb = b.gamebanana || {};
    const loads = (Array.isArray(b.funnel) ? b.funnel : []).filter((r) => r.day >= DAY_2_1).reduce((s, r) => s + n(r.load), 0);
    const downloads = !gb.error && Number.isFinite(gb.downloads) ? gb.downloads - PRE_21_DOWNLOADS : null;
    return { error: !!gb.error, downloads, loads, share: downloads === null ? null : share(loads, downloads) };
  }

  function view(b) {
    if (!b || !Array.isArray(b.funnel) || !b.today) return null;
    const rows = cohorts(b);
    const today = rows.find((r) => r.today) || { load: 0 };
    const last7 = rows.filter((r) => r.age <= 6);
    const load7 = last7.reduce((s, r) => s + r.load, 0), count7 = last7.reduce((s, r) => s + r.count, 0);
    const ws = weeks(b);
    return {
      today: b.today, rows,
      firstLoads: { n: today.load, spark: rows.slice(-14).map((r) => r.load) },
      completion: { count: count7, load: load7, share: share(count7, load7), from: last7.length ? last7[0].day : null, to: b.today },
      nextDay: pooled(rows, "back_d1"),
      week1: pooled(rows, "back_w2"),
      thisWeek: ws.find((w) => w.current) || null,
      lastWeek: ws.filter((w) => !w.current).pop() || null,
      weeks: ws,
    };
  }

  // ---- the funnel as a picture (11-10): one bar per step on one scale, first loads = 1 ----
  // MAIN: every 2.1+ install, first loads to the next day. Week-1 return is its own row on other first days (its
  // window closes 13 days later). F23: the first minute, only installs first loaded on 2.3 (their own scale).
  const MAIN = [["load", "First loads"], ["start", "Started a run"], ["finish", "Finished a run"], ["count", "Counted finish"],
    ["back_d1", "Back the next day"]];
  const F23 = [["load", "Map load"], ["seen", "Menu seen"], ["shot", "Shot at it"], ["press", "Pressed a button"],
    ["go", "Went to a start"], ["ready", "READY"], ["start", "Started"]];
  // the first session (load to counted finish): the biggest loss is marked only among these
  const SESSION = ["start", "finish", "count"];
  // steps that don't need the one before (a shot needs no Menu seen, READY no GO TO START): no loss line into them
  const NO_LOSS = ["shot", "ready"];
  const LOST = { start: "didn't start", finish: "didn't finish", count: "finished, not counted", back_d1: "not back the next day",
    seen: "menu not seen", press: "pressed nothing", go: "didn't go to a start" };
  // The first days a picture covers, by age (days before today): the main bars 2 to 8 days ago, so every next-day
  // window has closed; week-1 return 14 to 20 days ago. The 7 days before each set are what a row's change is against.
  const MAIN_AGES = [2, 8], W1_AGES = [14, 20];
  const inAges = (rows, [a, b]) => rows.filter((r) => r.age >= a && r.age <= b);

  // Steps as bars: n, share of the first step (the bar's width, capped at 1), the loss from the step before (count and
  // points of the first step), and the change against `prev` (the same steps on the 7 first days before), in points.
  function bars(rows, steps, get, prev) {
    const sum = (rs, key) => rs.reduce((a, r) => a + n(get(r, key)), 0);
    const base = sum(rows, "load"), pbase = prev ? sum(prev, "load") : 0;
    const out = steps.map(([key, label]) => {
      const c = sum(rows, key), sh = share(c, base);
      return { key, label, n: c, share: sh, width: sh === null ? 0 : Math.min(1, sh), loss: null, lossN: null, biggest: false,
               change: key !== "load" && pbase ? (sh === null ? null : sh - share(sum(prev, key), pbase)) : null };
    });
    let worst = null;
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1], c = out[i];
      if (a.share === null || c.share === null || NO_LOSS.includes(c.key)) continue;
      c.loss = a.share - c.share; c.lossN = a.n - c.n; c.lost = LOST[c.key] || "lost";
      if (c.loss > 0 && (steps === MAIN ? SESSION.includes(c.key) : true) && (!worst || c.loss > worst.loss)) worst = c;
    }
    if (worst) worst.biggest = true;
    return out;
  }
  // Week-1 return as its own row: first days 14 to 20 days ago (or the one chosen day once its window has closed); none
  // closed yet: pending, with the count so far and the day the first numbers are complete.
  function week1(rows, day) {
    const pick = day ? rows.filter((r) => r.day === day && r.back_w2.state === "closed") : inAges(rows, W1_AGES);
    const load = pick.reduce((a, r) => a + r.load, 0), back = pick.reduce((a, r) => a + r.back_w2.n, 0);
    if (pick.length && load) {
      const prev = day ? [] : inAges(rows, [W1_AGES[0] + 7, W1_AGES[1] + 7]);
      const pl = prev.reduce((a, r) => a + r.load, 0), pb = prev.reduce((a, r) => a + r.back_w2.n, 0);
      const sh = share(back, load);
      return { key: "back_w2", label: "Back days 7-13", state: "closed", n: back, load, share: sh, width: Math.min(1, sh || 0),
               from: pick[0].day, to: pick[pick.length - 1].day, change: pl ? sh - share(pb, pl) : null };
    }
    const mine = day ? rows.filter((r) => r.day === day) : rows;
    const first = mine.length ? mine[0] : null;
    return { key: "back_w2", label: "Back days 7-13", state: "pending", n: mine.filter((r) => r.back_w2.state !== "later").reduce((a, r) => a + r.back_w2.n, 0),
             share: null, width: 0, ready: first ? addDays(first.back_w2.closes, 1) : null };
  }
  // The main picture, week-1 return and the 2.3 first minute, for the standard first days or one first day (`day`).
  function picture(b, day) {
    const rows = cohorts(b);
    const pick = day ? rows.filter((r) => r.day === day) : inAges(rows, MAIN_AGES);
    const prev = day ? null : inAges(rows, [MAIN_AGES[0] + 7, MAIN_AGES[1] + 7]);
    const load = pick.reduce((a, r) => a + r.load, 0);
    const span = (rs) => ({ rows: rs.length, from: rs.length ? rs[0].day : null, to: rs.length ? rs[rs.length - 1].day : null });
    const main = { ...span(pick), load, steps: load ? bars(pick, MAIN, (r, k) => (k === "back_d1" ? (r.back_d1.state === "closed" ? r.back_d1.n : 0) : r[k]), prev && prev.length ? prev : null) : [] };
    // a chosen first day whose next day isn't over yet: its return is pending, not 0
    if (day && pick.length && pick[0].back_d1.state !== "closed" && main.steps.length) {
      const s = main.steps[main.steps.length - 1];
      Object.assign(s, { state: "pending", share: null, width: 0, loss: null, lossN: null, biggest: false, n: pick[0].back_d1.n, ready: addDays(pick[0].back_d1.closes, 1) });
    }
    // the 2.3 first minute is over within minutes of a first load, so today's 2.3 installs count here: the last 7
    // first days with 2.3 counts, today included (they start on V23_FROM)
    const p23 = day ? pick.filter((r) => r.v23) : rows.filter((r) => r.v23 && r.age <= 6);
    const load23 = p23.reduce((a, r) => a + r.v23.load, 0);
    const first = { ...span(p23), today: p23.some((r) => r.today), load: load23, steps: load23 ? bars(p23, F23, (r, k) => r.v23[k], null) : [] };
    return { main, week1: week1(rows, day), first, days: rows.filter((r) => !r.empty).map((r) => r.day).reverse(), install: installBound(b) };
  }

  // 8.3% under 10%, else a whole percent; "–" when there's nothing to divide by.
  const pct = (x) => (x === null || x === undefined ? "–" : x > 0 && x < 0.1 ? (x * 100).toFixed(1) + "%" : Math.round(x * 100) + "%");
  const fDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const fDow = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const dayLabel = (day) => fDay.format(new Date(ms(day)));
  const dowLabel = (day) => fDow.format(new Date(ms(day)));
  // "Nov 12 to 18", or "Oct 30 to Nov 5" across a month
  const spanLabel = (a, b) => (a === b ? dayLabel(a) : dayLabel(a) + " to " + (a.slice(0, 7) === b.slice(0, 7) ? String(+b.slice(8)) : dayLabel(b)));

  return { view, cohorts, weeks, pooled, menuReturn, installBound, windowOf, picture, pct, dayLabel, dowLabel, spanLabel, addDays, monday,
           STEPS, FIRST, V23, MAIN, F23 };
})();
if (typeof module === "object" && module.exports) module.exports = BoxRunFunnel;
