// The weekly board section (FIND-4, docs/BOXRUN-WEEKLY-BOARD.md), from GET /v1/week (public, no key): the week on now,
// its fastest times and most runs, and last week's winners. No DOM here, so stats/test/test_week.mjs checks the same
// code the page runs. `last` is week.py's last_line: the route and the first of each list (one object or null), not
// the full lists. `ends` is when the results are due; the board stays open until the roll, so a past `ends` is "due".
"use strict";
const BoxRunWeek = (() => {
  // The kit's display names by internal name: br_brain.js HERO_IDS (ghost_format.HERO_NAMES, MN-325), turned round
  const HEROES = {"Infernus": "hero_inferno", "Seven": "hero_gigawatt", "Vindicta": "hero_hornet", "Lady Geist": "hero_ghost",
    "Abrams": "hero_atlas", "Wraith": "hero_wraith", "McGinnis": "hero_forge", "Paradox": "hero_chrono", "Dynamo": "hero_dynamo",
    "Kelvin": "hero_kelvin", "Haze": "hero_haze", "Holliday": "hero_astro", "Bebop": "hero_bebop", "Calico": "hero_nano",
    "Grey Talon": "hero_orion", "Mo and Krill": "hero_krill", "Shiv": "hero_shiv", "Ivy": "hero_tengu", "Warden": "hero_warden",
    "Yamato": "hero_yamato", "Lash": "hero_lash", "Viscous": "hero_viscous", "Pocket": "hero_synth", "Mirage": "hero_mirage",
    "Vyper": "hero_viper", "Sinclair": "hero_magician", "Mina": "hero_vampirebat", "Drifter": "hero_drifter", "Venator": "hero_priest",
    "Victor": "hero_frank", "Paige": "hero_bookworm", "The Doorman": "hero_doorman", "Billy": "hero_punkgoat", "Graves": "hero_necro",
    "Apollo": "hero_fencer", "Deadman Danny": "hero_deadpack", "Rem": "hero_familiar", "Silver": "hero_werewolf",
    "Celeste": "hero_unicorn", "Rat King": "hero_ratking", "Solomon": "hero_chessmaster", "Violet": "hero_artist",
    "Nurse Harrow": "hero_nurse", "Baba": "hero_baba"};
  const NAMES = Object.fromEntries(Object.entries(HEROES).map(([name, id]) => [id, name]));
  const hero = (id) => (typeof id !== "string" || !id ? "–" : NAMES[id] || id.replace(/^hero_/, ""));

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (v) => (Number.isFinite(v) ? v : null);
  const time = (t) => (num(t) === null ? "–" : t.toFixed(3));
  const plural = (k, one, many) => k.toLocaleString("en-US") + " " + (k === 1 ? one : many);

  // "Mon 11-09 00:00 PT"
  const fEnds = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function endsLabel(sec) {
    const p = Object.fromEntries(fEnds.formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
    return `${p.weekday} ${p.month}-${p.day} ${p.hour}:${p.minute} PT`;
  }
  // "5 days 9 hours left", under a day "9 hours 12 minutes left"; past it, the results are due (entries still count)
  function leftLabel(sec, now) {
    const s = Math.floor(sec - now / 1000);
    if (s <= 0) return "results due, entries still count until the roll";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    const parts = d ? [plural(d, "day", "days"), plural(h, "hour", "hours")] : h ? [plural(h, "hour", "hours"), plural(m, "minute", "minutes")] : [plural(Math.max(m, 1), "minute", "minutes")];
    return parts.join(" ") + " left";
  }

  const table = (head, rows, empty) => !rows.length ? `<p class="muted small">${empty}</p>`
    : `<div class="scroll"><table class="board"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  const list = (v) => (Array.isArray(v) ? v.filter((r) => r && typeof r === "object") : []);
  const route = (w) => `<p><strong>${esc(w.name || "(no name)")}</strong> <span class="muted">${esc(w.code || "")}${num(w.version) !== null ? "." + w.version : ""}` +
    `${w.maker ? ", by " + esc(w.maker) : ""}</span></p>`;

  function fastest(rows) {
    return table('<th class="num">Place</th><th>Runner</th><th class="num">Time</th><th>Hero</th>',
      rows.map((r) => `<tr><td class="num">${esc(r.place)}</td><td>${esc(r.runner)}</td><td class="num">${time(r.time)}</td><td>${esc(hero(r.hero))}</td></tr>`),
      "No times yet.");
  }
  function most(rows) {
    return table('<th class="num">Place</th><th>Runner</th><th class="num">Runs</th>',
      rows.map((r) => `<tr><td class="num">${esc(r.place)}</td><td>${esc(r.runner)}</td><td class="num">${num(r.runs) === null ? "–" : r.runs.toLocaleString("en-US")}</td></tr>`),
      "No runs yet.");
  }

  // The section's HTML for a /v1/week answer at `now` (ms); `error` (a message) when the fetch failed.
  function render(b, now, error) {
    if (error) return `<p class="muted">Couldn't load the week's board (${esc(error)}).</p>`;
    if (!b || typeof b !== "object") return `<p class="muted">Couldn't load the week's board (no answer).</p>`;
    const out = [];
    const w = b.week;
    if (!w) out.push(`<p class="muted">No week is open.</p>`);
    else {
      const ends = num(w.ends);
      out.push(route(w),
        `<p class="small">${ends === null ? "No end set" : "Ends " + endsLabel(ends) + ", " + leftLabel(ends, now)}. ` +
        `${plural(num(w.entries) ?? 0, "entry", "entries")}.</p>`,
        `<h3>Fastest</h3>`, fastest(list(w.fastest)), `<h3>Most runs</h3>`, most(list(w.most)));
    }
    const l = b.last;
    if (l && typeof l === "object") {
      // last_line keeps the first of each list only, so its place is 1
      const f = l.fastest && typeof l.fastest === "object" ? [{ place: 1, ...l.fastest }] : [];
      const m = l.most && typeof l.most === "object" ? [{ place: 1, ...l.most }] : [];
      out.push(`<h3>Last week${l.id ? " (from " + esc(l.id) + ")" : ""}</h3>`, route(l),
        `<h3>Fastest</h3>`, fastest(f), `<h3>Most runs</h3>`, most(m));
    }
    return out.join("\n");
  }

  return { render, hero, endsLabel, leftLabel };
})();
if (typeof module === "object" && module.exports) module.exports = BoxRunWeek;
