// The stats page's headline numbers and the play-and-return cards (11-10, Marcus: "at a glance, the important numbers"),
// from the /v1/stats answer only. No DOM here, so stats/test/test_funnel.mjs checks the same code the page runs. Needs
// funnel.js (BoxRunFunnel) for the cohort return and the weekly figures. Days are Pacific calendar days.
"use strict";
const BoxRunOverview = (() => {
  const F = typeof BoxRunFunnel !== "undefined" ? BoxRunFunnel : require("./funnel.js");
  const HOUR = 3600e3;
  const n = (v) => (Number.isFinite(v) ? v : null);
  const toMs = (t) => (typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t));
  // Pacific midnight of a day: the offset at UTC 08:00 of that date (about local midnight; the page's dayStart)
  const offFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" });
  function offsetMin(ms) {
    const m = offFmt.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName").value.match(/GMT([+-])(\d+)(?::(\d+))?/);
    return m ? (m[1] === "-" ? -1 : 1) * (parseInt(m[2]) * 60 + parseInt(m[3] || 0)) : 0;
  }
  const dayStart = (day) => { const g = Date.parse(day + "T00:00:00Z"); return g - offsetMin(g + 8 * HOUR) * 60000; };
  const valueAt = (pts, t, k) => { let v = null; for (const p of pts) { if (p.t <= t) v = p[k]; else break; } return v; };
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

  // GameBanana downloads: the total, today's new ones (against the day before's end-of-day total), the average of the
  // 7 days before by the same time of day (from the 15-minute samples; a day the samples don't reach is left out,
  // and with fewer than 3 days there's no average), and 14 complete days of new downloads for the sparkline.
  function downloads(b) {
    const gb = b.gamebanana || {}, gd = Array.isArray(b.gamebanana_days) ? b.gamebanana_days : [];
    const total = !gb.error && Number.isFinite(gb.downloads) ? gb.downloads : null;
    const prev = gd.filter((d) => d.day < b.today).pop();
    const today = total !== null && prev ? total - prev.downloads : null;
    const daily = [];
    for (let i = 1; i < gd.length; i++) if (gd[i].day < b.today) daily.push(gd[i].downloads - gd[i - 1].downloads);
    const now = b.generated ? b.generated * 1000 : Date.now();
    const pts = (Array.isArray(b.gamebanana_samples) ? b.gamebanana_samples : []).map((s) => ({ ...s, t: toMs(s.t) })).sort((a, c) => a.t - c.t);
    const into = now - dayStart(b.today), same = [];
    for (let k = 1; k <= 7 && pts.length; k++) {
      const day = F.addDays(b.today, -k), t0 = dayStart(day);
      if (pts[0].t > t0) continue;
      const a = valueAt(pts, t0, "downloads"), c = valueAt(pts, t0 + into, "downloads");
      if (a !== null && c !== null) same.push(c - a);
    }
    // today's new downloads as the sparkline's separate hollow point (a partial last point reads as a drop, Marcus 11-08)
    return { total, today, sameHour: same.length >= 3 ? avg(same) : null, sameDays: same.length, spark: daily.slice(-14), sparkToday: today };
  }

  // Players since launch (distinct addresses that loaded a code), today's first-timers, and the running total at the
  // end of each of the last 14 days.
  function players(b) {
    const days = Array.isArray(b.days) ? b.days : [];
    const total = n(b.players_total);
    const today = days.find((d) => d.day === b.today) || {};
    let run = total === null ? null : total - days.reduce((s, d) => s + (n(d.new_players) || 0), 0);
    const spark = run === null ? [] : days.map((d) => (run += n(d.new_players) || 0));
    const full = days.filter((d) => d.day < b.today).length;
    return { total, today: n(today.new_players), spark: spark.slice(0, full).slice(-14), sparkToday: total };
  }

  // Players today: installs with counts on (2.1+) that opened the menu today, with the addresses that loaded a code,
  // against the average of the last 7 complete days (active isn't sent per hour, so not by the same hour).
  function playersToday(b) {
    const days = Array.isArray(b.days) ? b.days : [];
    const today = days.find((d) => d.day === b.today) || {};
    const counted = days.findIndex((d) => n(d.active) > 0);          // 0 before 2.1 sent counts, not a real zero
    const full = counted < 0 ? [] : days.slice(counted).filter((d) => d.day < b.today && n(d.active) !== null);
    const y = full[full.length - 1];
    return { active: n(today.active), menu: n(today.menu_players), addresses: n(today.players),
             yesterday: y && y.day === F.addDays(b.today, -1) ? n(y.active) : null,
             spark: full.slice(-14).map((d) => d.active), sparkToday: n(today.active) };
  }

  // Players, 7-day average (GOAL-1's sign since 11-09): daily menu players (every online player, by address) over the
  // last 7 complete days, and that average at the end of each of the 14 days before for the sparkline.
  function players7(b) {
    const days = (Array.isArray(b.days) ? b.days : []).filter((d) => d.day < b.today && n(d.menu_players) !== null);
    const at = (k) => { const w = days.slice(Math.max(0, k - 6), k + 1); return w.length === 7 ? avg(w.map((d) => d.menu_players)) : null; };
    const spark = days.map((d, k) => at(k)).slice(-14);
    const last = days.slice(-7);
    return { avg: last.length === 7 ? avg(last.map((d) => d.menu_players)) : null, from: last.length ? last[0].day : null, to: last.length ? last[last.length - 1].day : null,
             days: days.slice(-14).map((d) => d.day).filter((d, i, a) => spark[i + spark.length - a.length] !== null), spark: spark.filter((x) => x !== null) };
  }

  // Next-day return of new installs: the newest first day whose day 1 is over, and the last 7 such days pooled.
  function nextDay(b) {
    const v = F.view(b);
    if (!v) return null;
    const r = v.nextDay;
    return { newest: r.newest, pooled: r.cohorts ? { share: r.share, from: r.from, to: r.to } : null, open: r.open, spark: r.spark };
  }

  // The play-and-return cards: this week so far against last week (weekly actives, runs per player, community share),
  // back from the day before against the day before that, and the board's entries (from /v1/week, when it answered).
  function play(b, week) {
    const v = F.view(b), mr = F.menuReturn(b);
    // this week's complete days (today too when it's Monday) against last week's days through the same weekday
    const days = Array.isArray(b.days) ? b.days : [];
    const mon = F.monday(b.today), lastMon = F.addDays(mon, -7);
    const upto = b.today === mon ? 0 : Math.round((Date.parse(b.today) - Date.parse(mon)) / 864e5) - 1;
    const sumUp = (start) => {
      const end = F.addDays(start, upto), w = { actives: 0, count: 0, community: 0, kinds: 0, days: 0 };
      for (const d of days) {
        if (d.day < start || d.day > end) continue;
        const k = d.kinds || {};
        w.days += 1; w.actives += n(d.active_wk) || 0; w.count += n(d.runs_count) || 0;
        w.community += (n(k.community) || 0) + (n(k.pack) || 0);
        w.kinds += (n(k.sample) || 0) + (n(k.pack) || 0) + (n(k.community) || 0) + (n(k.own) || 0);
      }
      return w.days ? { ...w, perPlayer: w.actives ? w.count / w.actives : null, communityShare: w.kinds ? w.community / w.kinds : null, to: end } : null;
    };
    const tw = sumUp(mon), lw = sumUp(lastMon);
    const full = (Array.isArray(b.days) ? b.days : []).filter((d) => d.day < b.today);
    // the pair before menuReturn's newest: the day before yesterday's back over the day before that's players
    const [p0, p1] = full.slice(-3, -1);
    const prevPair = p0 && p1 && Number.isFinite(p1.menu_back) && p0.menu_players ? p1.menu_back / p0.menu_players : null;
    const w = week && week.week;
    return {
      week: mon, through: tw ? tw.to : null, partial: b.today === mon,
      actives: { now: tw ? tw.actives : null, last: lw ? lw.actives : null },
      perPlayer: { now: tw ? tw.perPlayer : null, last: lw ? lw.perPlayer : null },
      community: { now: tw ? tw.communityShare : null, last: lw ? lw.communityShare : null },
      back: { now: mr.share, last: prevPair, day: mr.day, n: mr.back, of: mr.before },
      board: { now: w && Number.isFinite(w.entries) ? w.entries : null, name: w ? w.name : null },
    };
  }

  return { downloads, players, playersToday, players7, nextDay, play, dayStart };
})();
if (typeof module === "object" && module.exports) module.exports = BoxRunOverview;
