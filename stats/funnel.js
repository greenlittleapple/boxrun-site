// The Funnel section's numbers (COUNT-6, docs/BOXRUN-MEASUREMENT.md 5.4 and 5.8), from the /v1/stats answer only:
// its funnel rows (one per first day: the steps once per install, back_d1, back_w2) and the per-day counts in days
// (active, active_wk, runs_*, kinds). No DOM here, so stats/test/test_funnel.mjs checks the same code the page runs.
// Days are Pacific calendar days as "YYYY-MM-DD"; weeks run Monday to Sunday, as the game's wk flag does.
"use strict";
const BoxRunFunnel = (() => {
  const DAY = 86400e3;
  const STEPS = ["load", "menu", "start", "finish", "count"];
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

  // 8.3% under 10%, else a whole percent; "–" when there's nothing to divide by.
  const pct = (x) => (x === null || x === undefined ? "–" : x > 0 && x < 0.1 ? (x * 100).toFixed(1) + "%" : Math.round(x * 100) + "%");
  const fDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const fDow = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const dayLabel = (day) => fDay.format(new Date(ms(day)));
  const dowLabel = (day) => fDow.format(new Date(ms(day)));
  // "Nov 12 to 18", or "Oct 30 to Nov 5" across a month
  const spanLabel = (a, b) => (a === b ? dayLabel(a) : dayLabel(a) + " to " + (a.slice(0, 7) === b.slice(0, 7) ? String(+b.slice(8)) : dayLabel(b)));

  return { view, cohorts, weeks, pooled, windowOf, pct, dayLabel, dowLabel, spanLabel, addDays, monday, STEPS };
})();
if (typeof module === "object" && module.exports) module.exports = BoxRunFunnel;
