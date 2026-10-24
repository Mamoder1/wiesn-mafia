// Pure game logic. No DOM, no network. Covered by tests/engine.test.mjs
export const ROLES = {
  mafia: { name: "Bierdieb", team: "mafia",
    desc: "Du gehörst zur Maßkrug-Mafia. Jede Nacht schickt ihr gemeinsam einen Gast unter den Tisch. Tagsüber spielst du den harmlosen Festbesucher.",
    goal: "Ihr gewinnt, sobald im Zelt genauso viele Bierdiebe wie ehrliche Gäste sitzen." },
  ordner: { name: "Ordner", team: "guests",
    desc: "Jede Nacht filzt du einen Gast und erfährst, ob er zur Maßkrug-Mafia gehört.",
    goal: "Hilf den Gästen, alle Bierdiebe rauszuwerfen. Verrat dich nicht zu früh." },
  sani: { name: "Sanitäter", team: "guests",
    desc: "Jede Nacht passt du auf einen Gast auf, gern auch auf dich selbst. Wollen die Bierdiebe genau den erwischen, bleibt er auf den Beinen. Nicht zweimal hintereinander dieselbe Person.",
    goal: "Halte die Gäste am Leben, bis alle Bierdiebe draußen sind." },
  gast: { name: "Wiesn-Gast", team: "guests",
    desc: "Du willst nur in Ruhe deine Maß trinken. Finde tagsüber heraus, wer die Bierdiebe sind.",
    goal: "Werft alle Bierdiebe aus dem Zelt." },
  bedienung: { name: "Bedienung", team: "guests",
    desc: "Jede Nacht bringst du jemandem eine Maß aufs Haus. Der ist am nächsten Tag zu beschwipst zum Abstimmen. Nicht zweimal hintereinander dieselbe Person.",
    goal: "Halt die Verdächtigen vom Abstimmen ab, nicht die Ehrlichen. Du spielst für die Gäste." },
  brater: { name: "Hendlbrater", team: "guests",
    desc: "Einmal im ganzen Spiel darfst du nachts jemanden auf den Grill legen. Der fliegt raus, egal wer er ist. Nur der Sanitäter kann ihn retten.",
    goal: "Spar dir den Grill für den Moment, in dem du dir sicher bist. Du spielst für die Gäste." },
  gaudi: { name: "Gaudibursch", team: "solo",
    desc: "Dir ist alles egal, Hauptsache Gaudi. Du spielst gegen alle.",
    goal: "Du gewinnst allein, wenn das Zelt dich tagsüber rauswirft. Wirk verdächtig, aber nicht zu offensichtlich." }
};

export const MORNING_LINES = [
  n => `Beim ersten Hahnenschrei findet man ${n} schnarchend unter der Bierbank. Für ${n} ist die Wiesn vorbei.`,
  n => `Die Maßkrug-Mafia hat ${n} heute Nacht eine Maß zu viel eingeflößt.`,
  n => `${n} wurde zuletzt am Kettenkarussell gesehen. Jetzt liegt ${n} im Bierkoma.`,
  n => `Von ${n} ist nur noch eine halbe Brezn übrig. Die Bierdiebe waren da.`
];

// Optional secret tasks for Bierdiebe. Done unnoticed during the day = cloaked from the Ordner next night.
export const DARES = [
  "Bau das Wort „Brezn“ in einen Satz ein.",
  "Sag in der Diskussion zweimal „ehrlich gesagt“.",
  "Klopf zweimal auf den Tisch, während jemand anderes redet.",
  "Lass etwas unauffällig auf den Boden fallen und heb es wieder auf.",
  "Steh einmal kurz auf und setz dich wieder hin.",
  "Stoß mit jemandem an und sag „Prost“.",
  "Sprich jemanden aus Versehen mit dem falschen Namen an.",
  "Sag den Satz „Das ist doch eine Gaudi“.",
  "Bau das Wort „Weißwurst“ in einen Satz ein.",
  "Frag jemanden nach der Uhrzeit.",
  "Summ kurz eine Melodie vor dich hin.",
  "Sag irgendwann „Oans, zwoa, g’suffa“.",
  "Beschuldige jemanden und nimm es sofort wieder zurück.",
  "Gähn einmal ausgiebig.",
  "Zeig auf die Decke und frag „Habt ihr das gehört?“",
  "Klatsch einmal in die Hände.",
  "Wiederhol den letzten Satz von jemand anderem wortwörtlich.",
  "Fass dir dreimal ans Ohrläppchen.",
  // Wünsche aus der Runde
  "Nies einmal (oder tu überzeugend so).",
  "Bind dir die Schnürsenkel neu.",
  { t: "Frag Mike, ob er abgenommen hat.", needs: "Mike" },
  { t: "Frag Luca, wie es auf Mallorca war.", needs: "Luca" },
  "Bau die Zahlen 6 und 7 in einen Satz ein.",
  "Bau „Söder“ in einen Satz ein.",
  "Sag einmal „Wien“ statt „Wiesn“.",
  "Trink dein Glas auf ex aus, egal was gerade noch drin ist.",
  "Frag, wo eigentlich Mario ist.",
  "Bau das Wort „Ente“ in einen Satz ein.",
  "Sag einmal „Ragebait“.",
  "Schnips einmal mit den Fingern.",
  // noch ein paar dazu
  "Fang einen Satz mit „Also pass auf“ an.",
  "Bau das Wort „Lederhose“ in einen Satz ein.",
  "Nenn jemanden einmal „Chef“.",
  "Lach laut über etwas, das gar nicht lustig war.",
  "Zieh deine Jacke aus oder an.",
  "Tipp jemandem auf die Schulter und sag dann nichts.",
  "Sag „Servus“ zu jemandem, der schon die ganze Zeit da ist.",
  "Schau demonstrativ unter den Tisch."
];

// A dare is a string or { t, needs }: "needs" = only offered if a player with that name is in, alive and not the taker.
export const dareText = d => (typeof d === "string" ? d : d.t);
export function dareFits(d, me, players) {
  if (typeof d === "string" || !d.needs) return true;
  const n = d.needs.toLowerCase();
  return players.some(p => p.alive && p.id !== me.id && p.name.toLowerCase().split(" ")[0] === n);
}

export const BRATER_LINES = [
  n => `${n} wurde zuletzt am Hendlgrill gesehen. Der Hendlbrater hat zugeschlagen.`,
  n => `Vom Grill duftet es verdächtig. ${n} kommt heute nicht mehr wieder. Der Hendlbrater war's.`
];

// Random Wiesn events, drawn each morning. Each one changes the rules for that day.
export const EVENTS = {
  regen:     { title: "Regenschauer!", text: () => "Alle drängen sich ins Zelt. Die Diskussion dauert heute nur halb so lang." },
  kapelle:   { title: "Die Blaskapelle macht Pause.", text: () => "Endlich hört man sein eigenes Wort. Heute gibt es eine Minute mehr Diskussion." },
  strom:     { title: "Stromausfall im Zelt!", text: () => "Im Dunkeln sieht keiner, wer wen wählt. Nach der Abstimmung gibt es heute nur die Stimmenzahl." },
  durchsage: { title: "Durchsage der Festleitung", text: e => `Laut Festleitung treiben sich noch ${e.n} ${e.n === 1 ? "Bierdieb" : "Bierdiebe"} im Zelt herum.` },
  schicht:   { title: "Schichtwechsel beim Sanitätszelt", text: () => "Heute Nacht darf der Sanitäter auch dieselbe Person wie letzte Nacht beschützen." },
  pflicht:   { title: "Der Festwirt hat genug vom Rumdrucksen.", text: () => "Enthaltung ist heute verboten. Jeder muss sich entscheiden." }
};

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

export const Engine = {
  MIN_PLAYERS: 5,
  MAX_PLAYERS: 20,
  suggestMafia(n) { return n <= 6 ? 1 : n <= 9 ? 2 : n <= 12 ? 3 : 4; },
  effective(settings, n) { return { ...settings, mafia: settings.mafia ?? Engine.suggestMafia(n) }; },
  buildRoles(n, s) {
    const r = [];
    for (let i = 0; i < s.mafia; i++) r.push("mafia");
    if (s.ordner) r.push("ordner");
    if (s.sani) r.push("sani");
    if (s.gaudi) r.push("gaudi");
    if (s.bedienung) r.push("bedienung");
    if (s.brater) r.push("brater");
    while (r.length < n) r.push("gast");
    return r;
  },
  validate(n, s) {
    if (n < Engine.MIN_PLAYERS) return `Ihr braucht mindestens ${Engine.MIN_PLAYERS} Leute im Raum.`;
    if (n > Engine.MAX_PLAYERS) return `Höchstens ${Engine.MAX_PLAYERS} Leute pro Raum.`;
    if (s.mafia < 1) return "Mindestens ein Bierdieb muss mitspielen.";
    const special = s.mafia + ["ordner", "sani", "gaudi", "bedienung", "brater"].filter(k => s[k]).length;
    if (special > n) return "Mehr Sonderrollen als Spieler. Nimm eine Rolle raus.";
    if (s.mafia * 2 >= n) return "Zu viele Bierdiebe: Sie hätten sofort gewonnen.";
    return null;
  },
  shuffle(arr, rng = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  },
  assignRoles(n, s, rng = Math.random) { return Engine.shuffle(Engine.buildRoles(n, s), rng); },
  // Most votes wins; on a tie the target that was voted for first wins (deterministic).
  mafiaTarget(votes) {
    if (!votes || !votes.length) return null;
    const c = new Map();
    votes.forEach(v => c.set(v.target, (c.get(v.target) || 0) + 1));
    const max = Math.max(...c.values());
    return votes.find(v => c.get(v.target) === max).target;
  },
  // Returns everyone who leaves tonight. The Sanitäter's protection stops the Bierdiebe and the Hendlbrater alike.
  resolveNight(night) {
    const victims = [];
    let saved = false;
    const attacks = [];
    const m = Engine.mafiaTarget(night.mafiaVotes);
    if (m != null) attacks.push({ id: m, by: "mafia" });
    if (night.roast && night.roast !== "skip") attacks.push({ id: night.roast, by: "brater" });
    for (const a of attacks) {
      if (night.protect === a.id) { saved = true; continue; }
      if (!victims.some(v => v.id === a.id)) victims.push(a);
    }
    return { victims, saved };
  },
  pickEvent(prevId, rng = Math.random) {
    if (rng() < 0.3) return null; // some days are quiet
    const ids = Object.keys(EVENTS).filter(id => id !== prevId);
    return ids[Math.floor(rng() * ids.length)];
  },
  // votes: { voterId: targetId | "skip" }. Plurality wins; a tie or "skip" on top means nobody leaves.
  tally(votes) {
    const counts = {};
    for (const [voter, target] of Object.entries(votes)) (counts[target] ||= []).push(voter);
    let max = 0, top = [];
    for (const [t, vs] of Object.entries(counts)) {
      if (vs.length > max) { max = vs.length; top = [t]; } else if (vs.length === max) top.push(t);
    }
    return { result: top.length === 1 && top[0] !== "skip" ? top[0] : null, counts };
  },
  winner(players, lynchedId = null) {
    if (lynchedId != null) { const l = players.find(p => p.id === lynchedId); if (l && l.role === "gaudi") return "gaudi"; }
    const alive = players.filter(p => p.alive);
    const m = alive.filter(p => p.role === "mafia").length;
    if (m === 0) return "guests";
    if (m >= alive.length - m) return "mafia";
    return null;
  },
  // Which targets a player may pick at night. Single source of truth for UI and host validation.
  // ctx: { lastProtect, lastServed, braterUsed }
  nightTask(player, players, ctx = {}) {
    const alive = players.filter(p => p.alive);
    let kind = ["mafia", "ordner", "sani", "bedienung", "brater"].includes(player.role) ? player.role : "cover";
    if (kind === "brater" && ctx.braterUsed) kind = "cover";
    const options = (kind === "sani" ? alive : alive.filter(p => p.id !== player.id)).map(p => p.id);
    const disabled = {};
    if (kind === "mafia") alive.forEach(p => { if (p.role === "mafia") disabled[p.id] = "Komplize"; });
    if (kind === "sani" && ctx.lastProtect) disabled[ctx.lastProtect] = "letzte Nacht";
    if (kind === "bedienung" && ctx.lastServed) disabled[ctx.lastServed] = "letzte Nacht";
    return { kind, options, disabled, allowSkip: kind === "brater" };
  },
  isValidNightTarget(player, players, ctx, target) {
    const t = Engine.nightTask(player, players, ctx);
    if (target === "skip") return t.allowSkip;
    return t.options.includes(target) && !t.disabled[target];
  },
  roomCode(rng = Math.random) {
    let s = ""; for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
    return s;
  },
  normalizeCode(s) { return String(s || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); },
  uniqueName(name, taken) {
    const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 16) || "Gast";
    const lower = new Set(taken.map(t => t.toLowerCase()));
    if (!lower.has(clean.toLowerCase())) return clean;
    for (let i = 2; ; i++) { const c = `${clean} ${i}`; if (!lower.has(c.toLowerCase())) return c; }
  }
};
