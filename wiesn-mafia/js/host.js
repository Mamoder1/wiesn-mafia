// Authoritative game host. Runs on the phone that created the room.
// All rules live here; clients only send intents and render what the host publishes.
//   wm1/<room>/s        public state  (retained)
//   wm1/<room>/p/<id>   private state per player (retained)
//   wm1/<room>/in       client intents (join, leave, hello, ready, night, dare, vote)
//   wm1/<room>/hb       host heartbeat every 5 s
import { Engine, MORNING_LINES, BRATER_LINES, DARES, dareText, dareFits } from "./engine.js";
import { topic } from "./bus.js";

export const DEFAULT_SETTINGS = { hostPlays: true, mafia: null, ordner: true, sani: true, gaudi: false, bedienung: false, brater: false, events: true, reveal: true, dares: true, minutes: 3 };

const RESET = () => ({
  ready: [], round: 0, night: null, lastProtect: null, lastServed: null, braterUsed: false, checks: [],
  morning: null, votes: {}, tally: null, lynch: null, winner: null, dares: {}, event: null, tipsy: null, log: []
});

export function freshHostState(room, hostId) {
  return {
    v: 1, room, hostId, rev: 0, phase: "lobby",
    settings: { ...DEFAULT_SETTINGS },
    players: [], ...RESET(),
    timer: { left: 180, running: false, endAt: 0 }
  };
}

export class Host {
  constructor(bus, state, { save = () => {}, onPublish = () => {} } = {}) {
    this.bus = bus;
    this.H = state;
    this.H.settings = { ...DEFAULT_SETTINGS, ...state.settings };
    this.save = save;
    this.onPublish = onPublish;
    this.privCache = {};
    bus.subscribe(topic(state.room, "in"), m => { if (m) this.handle(m); });
    this.beat = () => bus.publish(topic(state.room, "hb"), { at: Date.now() });
    this.hbTimer = setInterval(this.beat, 5000);
    this.beat();
  }
  get room() { return this.H.room; }
  player(id) { return this.H.players.find(p => p.id === id); }
  alive() { return this.H.players.filter(p => p.alive); }
  ctx() { return { lastProtect: this.H.lastProtect, lastServed: this.H.lastServed, braterUsed: this.H.braterUsed }; }
  eventIs(id) { return this.H.event && this.H.event.id === id && this.H.event.round === this.H.round; }
  voters() { return this.alive().filter(p => p.id !== this.H.tipsy); }
  // Admin mode: the host does not play and sees everything (roles, night actions, dares, votes).
  isAdmin() { return !this.H.settings.hostPlays; }
  playerCount() { return this.H.players.length - (this.isAdmin() && this.H.phase === "lobby" && this.player(this.H.hostId) ? 1 : 0); }

  /* ---------- Intents from any client (including the host's own player) ---------- */
  handle(m) {
    const H = this.H, p = this.player(m.id);
    switch (m.t) {
      case "join": {
        if (H.phase !== "lobby") { if (p) this.publishAll(true); return; }
        if (p) { p.name = Engine.uniqueName(m.name, H.players.filter(q => q !== p).map(q => q.name)); }
        else {
          if (H.players.length >= Engine.MAX_PLAYERS) return;
          H.players.push({ id: m.id, name: Engine.uniqueName(m.name, H.players.map(q => q.name)), alive: true, role: null });
        }
        return this.publishAll();
      }
      case "leave":
        if (H.phase === "lobby" && p && m.id !== H.hostId) { H.players = H.players.filter(q => q !== p); this.publishAll(); }
        return;
      case "hello": return this.publishAll(true);
      case "ready":
        if (H.phase === "reveal" && p && !H.ready.includes(p.id)) { H.ready.push(p.id); this.publishAll(); }
        return;
      case "night": {
        if (H.phase !== "night" || !p || !p.alive || H.night.actions[p.id] != null) return;
        if (!Engine.isValidNightTarget(p, H.players, this.ctx(), m.target)) return;
        const kind = Engine.nightTask(p, H.players, this.ctx()).kind;
        H.night.actions[p.id] = m.target;
        if (kind === "mafia") H.night.mafiaVotes.push({ voter: p.id, target: m.target });
        if (kind === "sani") H.night.protect = m.target;
        if (kind === "bedienung") H.night.serve = m.target;
        if (kind === "brater") H.night.roast = m.target;
        if (kind === "ordner") {
          const t = this.player(m.target);
          const cloaked = (H.night.cloaked || []).includes(t.id);
          H.checks.push({ round: H.round, target: m.target, isMafia: t.role === "mafia" && !cloaked, cloaked: t.role === "mafia" && cloaked });
        }
        if (this.alive().every(q => H.night.actions[q.id] != null)) return this.resolveNight();
        return this.publishAll();
      }
      case "dare": {
        const d = (H.dares || {})[m.id];
        if (!p || !p.alive || p.role !== "mafia" || !d || d.round !== H.round || !["morning", "day"].includes(H.phase)) return;
        if (m.action === "pick" && d.status === "offered" && (d.choices || []).includes(m.idx)) { d.idx = m.idx; d.status = "accepted"; }
        else if (m.action === "decline" && d.status === "offered") d.status = "declined";
        else if (m.action === "done" && d.status === "accepted") d.status = this.isAdmin() ? "claimed" : "done";
        else return;
        return this.publishAll();
      }
      case "vote": {
        if (H.phase !== "vote" || !p || !p.alive || p.id === H.tipsy || H.votes[p.id] != null) return;
        if (m.target === "skip") { if (this.eventIs("pflicht")) return; }
        else { const t = this.player(m.target); if (!t || !t.alive || t.id === p.id) return; }
        H.votes[p.id] = m.target;
        if (this.voters().every(q => H.votes[q.id] != null)) return this.closeVote();
        return this.publishAll();
      }
    }
  }

  // Three different dares per Bierdieb, no overlap with an accomplice's choices if the pool allows it.
  dareChoices(p) {
    const used = new Set(Object.values(this.H.dares || {}).flatMap(d => d.choices || []));
    const fits = DARES.map((_, i) => i).filter(i => dareFits(DARES[i], p, this.H.players));
    let pool = fits.filter(i => !used.has(i));
    if (pool.length < 3) pool = fits;
    return Engine.shuffle(pool).slice(0, 3);
  }
  offerDares() {
    const H = this.H;
    H.dares = {};
    if (!H.settings.dares || H.winner) return;
    this.alive().filter(p => p.role === "mafia").forEach(p => {
      H.dares[p.id] = { round: H.round, choices: this.dareChoices(p), idx: null, status: "offered" };
    });
  }

  /* ---------- Host-only controls ---------- */
  updateSettings(patch) {
    if (this.H.phase !== "lobby" && this.H.phase !== "end") return;
    Object.assign(this.H.settings, patch);
    this.publishAll();
  }
  kick(id) {
    if (this.H.phase !== "lobby" || id === this.H.hostId) return;
    this.H.players = this.H.players.filter(p => p.id !== id);
    this.bus.publish(topic(this.room, "p/" + id), null, { retain: true });
    this.publishAll();
  }
  validation() { const n = this.playerCount(); return Engine.validate(n, Engine.effective(this.H.settings, n)); }
  start() {
    if (this.validation()) return false;
    const H = this.H;
    if (this.isAdmin()) {
      const me = this.player(H.hostId);
      if (me) { H.adminRecord = { id: me.id, name: me.name }; H.players = H.players.filter(p => p.id !== H.hostId); }
    } else if (!this.player(H.hostId) && H.adminRecord) {
      H.players.unshift({ ...H.adminRecord, alive: true, role: null });
    }
    const n = H.players.length;
    const roles = Engine.assignRoles(n, Engine.effective(H.settings, n));
    H.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; });
    Object.assign(H, RESET(), { phase: "reveal" });
    this.publishAll();
    return true;
  }
  startNight() {
    const H = this.H;
    if (!["reveal", "verdict"].includes(H.phase) || H.winner) return;
    // Bierdiebe who completed today's dare are cloaked from the Ordner tonight
    Object.values(H.dares || {}).forEach(d => { if (d.status === "claimed") d.status = "expired"; }); // not confirmed in time
    const cloaked = Object.entries(H.dares || {}).filter(([, d]) => d.status === "done" && d.round === H.round).map(([id]) => id);
    if (this.eventIs("schicht")) H.lastProtect = null;
    H.round += 1;
    H.night = { actions: {}, mafiaVotes: [], protect: null, serve: null, roast: null, cloaked };
    H.dares = {}; H.tipsy = null;
    H.phase = "night";
    this.publishAll();
  }
  resolveNight() {
    const H = this.H, N = H.night;
    if (H.phase !== "night") return;
    const r = Engine.resolveNight(N);
    r.victims.forEach(v => { this.player(v.id).alive = false; });
    const lines = { mafia: MORNING_LINES, brater: BRATER_LINES };
    H.lastProtect = N.protect;
    H.lastServed = N.serve;
    if (N.roast && N.roast !== "skip") H.braterUsed = true;
    H.tipsy = N.serve && this.player(N.serve)?.alive ? N.serve : null;
    H.winner = Engine.winner(H.players);
    H.event = null;
    if (H.settings.events && !H.winner) {
      const id = Engine.pickEvent(H.log.filter(l => l.type === "day").at(-1)?.event?.id);
      if (id) H.event = { id, round: H.round, n: this.alive().filter(p => p.role === "mafia").length };
    }
    H.morning = {
      victims: r.victims.map(v => ({ ...v, line: Math.floor(Math.random() * lines[v.by].length) })),
      saved: r.saved, tipsy: H.tipsy
    };
    H.log.push({
      type: "night", round: H.round,
      mafiaVotes: N.mafiaVotes, protect: N.protect, serve: N.serve, roast: N.roast,
      check: H.checks.filter(c => c.round === H.round).at(-1) || null,
      cloaked: N.cloaked || [], victims: r.victims, saved: r.saved
    });
    H.phase = "morning";
    this.offerDares();
    this.publishAll();
  }
  startDay() {
    const H = this.H;
    if (H.phase !== "morning" || H.winner) return;
    let secs = H.settings.minutes * 60;
    if (this.eventIs("regen")) secs = Math.max(60, Math.round(secs / 2));
    if (this.eventIs("kapelle")) secs += 60;
    H.phase = "day";
    H.timer = { left: secs, running: false, endAt: 0 };
    this.publishAll();
  }
  timerToggle() {
    const t = this.H.timer;
    if (t.running) { t.left = Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000)); t.running = false; }
    else { if (t.left <= 0) t.left = 60; t.endAt = Date.now() + t.left * 1000; t.running = true; }
    this.publishAll();
  }
  timerPlus() {
    const t = this.H.timer;
    if (t.running) t.endAt += 30000; else t.left += 30;
    this.publishAll();
  }
  startVote() {
    const H = this.H;
    if (H.phase !== "day") return;
    H.phase = "vote"; H.votes = {}; H.timer.running = false;
    Object.values(H.dares || {}).forEach(d => { if (d.status === "accepted") d.status = "expired"; else if (d.status === "offered") d.status = "ignored"; });
    this.publishAll();
  }
  closeVote() {
    const H = this.H;
    if (H.phase !== "vote") return;
    const { result, counts } = Engine.tally(H.votes);
    H.tally = counts; H.lynch = result;
    if (result) this.player(result).alive = false;
    H.winner = Engine.winner(H.players, result);
    H.log.push({
      type: "day", round: H.round, event: H.event && H.event.round === H.round ? H.event : null,
      dares: Object.entries(H.dares || {}).map(([id, d]) => ({ id, text: d.idx != null ? dareText(DARES[d.idx]) : null, status: d.status })),
      tipsy: H.tipsy, tally: counts, lynch: result
    });
    H.phase = "verdict";
    this.publishAll();
  }
  // Admin confirms or rejects a dare. Allowed until the next night starts.
  confirmDare(id, ok) {
    const H = this.H, d = (H.dares || {})[id];
    if (!this.isAdmin() || !d || !["accepted", "claimed", "expired", "done", "failed"].includes(d.status)) return;
    if (!["morning", "day", "vote", "verdict"].includes(H.phase)) return;
    d.status = ok ? "done" : "failed";
    const log = H.log.filter(l => l.type === "day" && l.round === d.round).at(-1);
    if (log) { const e = log.dares.find(x => x.id === id); if (e) e.status = d.status; }
    this.publishAll();
  }
  // Everything the admin screen shows. Never published over the network.
  adminView() {
    const H = this.H;
    return {
      players: H.players.map(p => ({ id: p.id, name: p.name, role: p.role, alive: p.alive })),
      night: H.phase === "night" ? H.night : null,
      dares: Object.entries(H.dares || {}).map(([id, d]) => ({ id, status: d.status, text: d.idx != null ? dareText(DARES[d.idx]) : null, choices: (d.choices || []).map(i => dareText(DARES[i])) })),
      votes: H.phase === "vote" ? H.votes : {},
      checks: H.checks, tipsy: H.tipsy, braterUsed: H.braterUsed, lastProtect: H.lastProtect
    };
  }
  toEnd() { if (this.H.winner) { this.H.phase = "end"; this.publishAll(); } }
  again() { this.H.phase = "lobby"; return this.start(); }
  newLobby() {
    const H = this.H;
    if (!this.player(H.hostId) && H.adminRecord) H.players.unshift({ ...H.adminRecord, alive: true, role: null });
    H.players.forEach(p => { p.role = null; p.alive = true; });
    Object.assign(H, RESET(), { phase: "lobby" });
    this.publishAll();
  }
  closeRoom() {
    clearInterval(this.hbTimer);
    this.H.players.forEach(p => this.bus.publish(topic(this.room, "p/" + p.id), null, { retain: true }));
    this.bus.publish(topic(this.room, "s"), null, { retain: true });
  }
  stop() { clearInterval(this.hbTimer); }

  /* ---------- Views sent over the wire ---------- */
  publicState() {
    const H = this.H, n = this.playerCount();
    const showRole = p => H.phase === "end" || (!p.alive && H.settings.reveal) || (p.id === H.lynch && p.role === "gaudi");
    const dayPhase = ["morning", "day", "vote", "verdict"].includes(H.phase);
    const hideVoters = this.eventIs("strom") && H.phase === "verdict";
    let tally = ["verdict", "end"].includes(H.phase) ? H.tally : null;
    if (tally && hideVoters) tally = Object.fromEntries(Object.entries(tally).map(([t, vs]) => [t, vs.map(() => null)]));
    return {
      v: 1, rev: H.rev, room: H.room, hostId: H.hostId, phase: H.phase, round: H.round,
      settings: Engine.effective(H.settings, n),
      validation: H.phase === "lobby" ? this.validation() : null,
      players: H.players.map(p => ({ id: p.id, name: p.name, alive: p.alive, role: showRole(p) ? p.role : null })),
      ready: H.phase === "reveal" ? H.ready : [],
      done: H.phase === "night" ? { n: Object.keys(H.night.actions).length, of: this.alive().length } : null,
      morning: ["morning", "day", "vote"].includes(H.phase) ? H.morning : null,
      event: dayPhase && H.event && H.event.round === H.round ? H.event : null,
      tipsy: dayPhase ? H.tipsy : null,
      timer: H.timer,
      voted: H.phase === "vote" ? Object.keys(H.votes) : [],
      voters: H.phase === "vote" ? this.voters().length : 0,
      tally, tallyHidden: !!(tally && hideVoters),
      lynch: H.lynch, winner: H.winner,
      admin: this.isAdmin() && H.phase !== "lobby" ? (H.adminRecord?.name || null) : null,
      log: H.phase === "end" ? H.log : null
    };
  }
  privateState(p) {
    const H = this.H;
    const priv = { v: 1, rev: H.rev, role: p.role, allies: [], task: null, checks: [] };
    if (!p.role) return priv;
    if (p.role === "mafia") {
      priv.allies = H.players.filter(q => q.role === "mafia" && q.id !== p.id).map(q => q.id);
      const d = (H.dares || {})[p.id];
      priv.dare = d ? { status: d.status, text: d.idx != null ? dareText(DARES[d.idx]) : null, choices: d.status === "offered" ? (d.choices || []).map(i => ({ idx: i, text: dareText(DARES[i]) })) : [] } : null;
      priv.mateDares = priv.allies.filter(id => H.dares?.[id]).map(id => ({ id, text: H.dares[id].idx != null ? dareText(DARES[H.dares[id].idx]) : null, status: H.dares[id].status }));
      priv.cloaked = H.phase === "night" && (H.night.cloaked || []).includes(p.id);
    }
    if (p.role === "ordner") priv.checks = H.checks.map(c => ({ round: c.round, target: c.target, isMafia: c.isMafia }));
    if (p.role === "brater") priv.braterUsed = H.braterUsed;
    if (H.phase === "night" && p.alive) {
      const task = Engine.nightTask(p, H.players, this.ctx());
      task.chosen = H.night.actions[p.id] ?? null;
      if (task.kind === "mafia") task.mates = H.night.mafiaVotes.filter(v => v.voter !== p.id);
      priv.task = task;
    }
    return priv;
  }
  publishAll(force = false) {
    const H = this.H;
    H.rev += 1;
    this.save(H);
    const pub = this.publicState();
    this.bus.publish(topic(this.room, "s"), pub, { retain: true });
    const privs = {};
    for (const p of H.players) {
      const priv = this.privateState(p);
      privs[p.id] = priv;
      const key = JSON.stringify({ ...priv, rev: 0 });
      if (force || this.privCache[p.id] !== key) {
        this.privCache[p.id] = key;
        this.bus.publish(topic(this.room, "p/" + p.id), priv, { retain: true });
      }
    }
    this.onPublish(pub, privs);
  }
}
