// Client UI. Every phone runs this; the room creator additionally runs Host.
import { Engine, ROLES, MORNING_LINES, BRATER_LINES, EVENTS } from "./engine.js";
import { connectBus, findRoom, topic } from "./bus.js";
import { Host, freshHostState } from "./host.js";

/* ---------- Storage (namespaced so tests can run several players in one browser) ---------- */
const params = new URLSearchParams(location.search);
const NS = "wm" + (params.get("ns") || "") + ":";
const KV = {
  get(k) { try { return JSON.parse(localStorage.getItem(NS + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(NS + k); } catch (e) {} }
};
const rid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const me = { id: KV.get("id") || rid(), name: KV.get("name") || "" };
KV.set("id", me.id);

/* ---------- Runtime state ---------- */
let bus = null, host = null;
const U = {
  screen: "home", err: null, busy: null,
  code: Engine.normalizeCode(params.get("r") || ""), name: me.name,
  pub: null, priv: null, room: null, isHost: false,
  showRole: false, sel: null, phaseKey: "", online: true, lastHb: Date.now(),
  confirm: null, copied: false, lastJoin: 0
};

const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const P = id => U.pub?.players.find(p => p.id === id);
const nameOf = id => (P(id)?.name) ?? "?";
const meP = () => P(me.id);
const alivePlayers = () => U.pub.players.filter(p => p.alive);
const keepParams = () => { const k = new URLSearchParams(); ["ns", "bus"].forEach(x => params.get(x) && k.set(x, params.get(x))); return k; };
const joinUrl = () => { const k = keepParams(); k.set("r", U.room); if (bus) k.set("b", bus.index); return `${location.origin}${location.pathname}?${k}`; };
const timerLeft = t => t.running ? Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000)) : t.left;

const ICON = {
  mafia: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M14 16h28v38H14z"/><path d="M42 24h6a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6h-6"/><path d="M8 30c6-4 34-4 40 0-2 6-8 8-12 6l-4-2-4 2c-4 2-10 0-12-6" fill="currentColor"/></svg>',
  ordner: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M32 6 54 14v16c0 14-10 23-22 28C20 53 10 44 10 30V14z"/><path d="m22 32 7 7 13-14"/></svg>',
  sani: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><circle cx="32" cy="32" r="25"/><path d="M27 18h10v9h9v10h-9v9H27v-9h-9V27h9z" fill="currentColor"/></svg>',
  gast: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M14 18h28v36H14z"/><path d="M42 26h6a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-6"/><path d="M12 18c0-6 6-9 10-7 2-4 10-5 13-1 5-2 10 2 9 8"/><path d="M22 28v18M34 28v18"/></svg>',
  bedienung: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M6 20h18v30H6zM40 20h18v30H40z"/><path d="M24 26h4a4 4 0 0 1 0 12h-4M58 26h0"/><path d="M4 56h56"/><path d="M26 10c0 4 6 4 6 0s6-4 6 0"/></svg>',
  brater: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"><path d="M8 26h48"/><path d="M14 26c0 14 8 22 18 22s18-8 18-22"/><path d="M24 48l-6 10M40 48l6 10"/><path d="M24 18c0-4 4-4 4-8M34 18c0-4 4-4 4-8"/></svg>',
  gaudi: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"><path d="M8 44c8-4 40-4 48 0"/><path d="M16 42c0-14 6-24 16-24s16 10 16 24"/><path d="M44 24c4-10 10-14 14-16-2 6-4 12-10 18" fill="currentColor"/></svg>'
};

/* ---------- Networking ---------- */
function send(m) {
  m.id = me.id;
  if (U.isHost && host) host.handle(m);
  else if (bus) bus.publish(topic(U.room, "in"), m);
}

function recvPub(obj) {
  if (obj == null) { if (!U.isHost) leaveLocal("Der Spielleiter hat den Raum geschlossen."); return; }
  if (U.pub && obj.rev < U.pub.rev) return;
  U.pub = obj;
  const key = obj.phase + ":" + obj.round;
  if (key !== U.phaseKey) {
    if (U.phaseKey && navigator.vibrate) { try { navigator.vibrate(120); } catch (e) {} }
    if (obj.phase === "end") setTimeout(confetti, 200);
    U.phaseKey = key; U.sel = null; U.dareSel = null; U.showRole = false; U.confirm = null;
  }
  // (Re)join automatically whenever a lobby is open and we are not listed yet
  if (obj.phase === "lobby" && !meP() && Date.now() - U.lastJoin > 2500) { U.lastJoin = Date.now(); send({ t: "join", name: me.name }); }
  render();
}
function recvPriv(obj) {
  if (obj == null) {
    if (!U.isHost && U.priv) leaveLocal("Du wurdest aus dem Raum entfernt.");
    return;
  }
  if (U.priv && obj.rev < U.priv.rev) return;
  U.priv = obj;
  render();
}

function attach(room) {
  U.room = room; U.screen = "game"; U.err = null; U.busy = null;
  bus.subscribe(topic(room, "s"), recvPub);
  bus.subscribe(topic(room, "p/" + me.id), recvPriv);
  bus.subscribe(topic(room, "hb"), () => { U.lastHb = Date.now(); });
  bus.onStatus(v => { U.online = v; updateBanner(); });
  U.lastHb = Date.now();
  KV.set("session", { room, broker: bus.index, host: U.isHost });
  const k = keepParams(); k.set("r", room); k.set("b", bus.index);
  history.replaceState(null, "", `${location.pathname}?${k}`);
}

function startHost(state) {
  U.isHost = true;
  host = new Host(bus, state, {
    save: H => KV.set("host:" + H.room, H),
    onPublish: (pub, privs) => { recvPub(pub); if (privs[me.id]) recvPriv(privs[me.id]); }
  });
}

async function createRoom() {
  if (!me.name) { U.err = "Trag zuerst deinen Namen ein."; return render(); }
  U.busy = "Raum wird aufgemacht…"; U.err = null; render();
  try { bus = await connectBus(); }
  catch (e) { U.busy = null; U.err = "Keine Verbindung zum Spielserver. Prüf dein Internet und versuch es nochmal."; return render(); }
  const room = Engine.roomCode();
  attach(room);
  startHost(freshHostState(room, me.id));
  KV.set("session", { room, broker: bus.index, host: true });
  host.handle({ t: "join", id: me.id, name: me.name });
}

async function joinRoom(code, { quiet = false } = {}) {
  if (!quiet && !me.name) { U.err = "Trag zuerst deinen Namen ein."; return render(); }
  if (code.length !== 4) { U.err = "Der Raumcode hat 4 Buchstaben."; return render(); }
  U.busy = quiet ? "Verbinde wieder…" : `Suche Raum ${code}…`; U.err = null; render();
  const b = params.get("b");
  const found = await findRoom(code, b != null ? +b : (KV.get("session")?.broker ?? null)).catch(() => null);
  if (!found) {
    U.busy = null; KV.del("session");
    U.err = quiet ? null : `Raum ${code} nicht gefunden. Prüf den Code oder ob das Handy des Spielleiters noch offen ist.`;
    return render();
  }
  bus = found.bus;
  attach(code);
  recvPub(found.state);
  if (found.state.phase !== "lobby" || !meP()) { U.lastJoin = Date.now(); send({ t: found.state.phase === "lobby" ? "join" : "hello", name: me.name }); }
}

async function resumeHost(session, saved) {
  U.busy = "Verbinde wieder…"; render();
  try { bus = await connectBus(session.broker); } catch (e) { U.busy = null; U.err = "Keine Verbindung zum Spielserver."; return render(); }
  attach(saved.room);
  startHost(saved);
  host.publishAll(true);
}

function leaveLocal(msg) {
  if (host) { host.stop(); KV.del("host:" + U.room); }
  try { bus && bus.end(); } catch (e) {}
  bus = null; host = null;
  KV.del("session");
  Object.assign(U, { screen: "home", pub: null, priv: null, room: null, isHost: false, err: msg || null, busy: null, phaseKey: "", confirm: null });
  history.replaceState(null, "", `${location.pathname}${keepParams().toString() ? "?" + keepParams() : ""}`);
  render();
}

/* ---------- Pieces ---------- */
function topBar() {
  const label = U.pub ? ({ lobby: "Lobby", reveal: "Rollen", night: `Nacht ${U.pub.round}`, morning: `Tag ${U.pub.round}`, day: `Tag ${U.pub.round}`, vote: `Tag ${U.pub.round}`, verdict: `Tag ${U.pub.round}`, end: "Ende" }[U.pub.phase]) : "Wiesn-Edition";
  const right = U.screen === "game"
    ? (U.confirm === "quit"
      ? `<div class="abort"><button class="link warn" data-a="quitYes">${U.isHost ? "Raum schließen" : "Verlassen"}</button><button class="link" data-a="cancel">Bleiben</button></div>`
      : `<div class="abort"><span class="roomchip" title="Raumcode">${h(U.room)}</span><button class="link" data-a="quit">${U.isHost ? "Schließen" : "Verlassen"}</button></div>`)
    : "";
  return `<div class="top"><div class="brand">Mafia<small>${h(label)}</small></div>${right}</div><div id="banner"></div>`;
}

function roleCard(role, allies) {
  const R = ROLES[role];
  let extra = "";
  if (role === "mafia" && U.pub?.settings?.dares) extra += `<p class="goal">Tagsüber bekommst du hinter „Meine Rolle kurz anzeigen“ freiwillige Geheimaufträge. Erfüllst du einen unauffällig, bist du in der Nacht danach vor dem Ordner getarnt.</p>`;
  if (role === "mafia") extra += `<p class="allies">${allies.length ? `Deine Komplizen: ${allies.map(id => h(nameOf(id))).join(", ")}` : "Du bist der einzige Bierdieb. Viel Glück."}</p>`;
  return `<div class="card"><div class="strip"></div><div class="inner">
    <p class="eyebrow">${h(me.name)}, du bist</p>
    <div class="emblem">${ICON[role]}</div>
    <h2 class="rolename">${R.name}</h2>
    <p>${R.desc}</p><p class="goal">${R.goal}</p>${extra}
  </div></div>`;
}

function darePanel() {
  const d = U.priv?.dare, pub = U.pub;
  if (U.priv?.role !== "mafia" || !pub.settings.dares || !["morning", "day", "vote"].includes(pub.phase) || !meP()?.alive) return "";
  const mates = (U.priv.mateDares || []).map(m => `<li>${h(nameOf(m.id))}: ${m.status === "done" ? "erledigt, getarnt" : m.status === "claimed" ? "gemeldet, wartet auf Bestätigung" : m.status === "failed" ? "nicht anerkannt" : m.status === "accepted" ? `macht gerade: ${h(m.text)}` : m.status === "offered" ? "sucht noch aus" : "kein Auftrag"}</li>`).join("");
  let body;
  if (!d) body = `<p class="hint">Heute gibt es keinen Auftrag für dich.</p>`;
  else if (d.status === "offered") body = `<p class="hint">Such dir einen aus. Schaffst du ihn vor der Abstimmung, ohne aufzufallen, hält dich der Ordner heute Nacht für einen harmlosen Gast.${pub.settings.hostPlays ? "" : " Der Spielleiter muss es gesehen haben und bestätigen."} Wer dich dabei erwischt, hat einen Verdacht.</p>
      <div class="darechoices">${d.choices.map(c => `<button class="opt" data-a="dareSel" data-v="${c.idx}" aria-pressed="${U.dareSel === c.idx}">${h(c.text)}</button>`).join("")}</div>
      <button class="btn primary" data-a="darePick" ${U.dareSel == null ? "disabled" : ""}>${U.dareSel == null ? "Auftrag antippen" : "Diesen Auftrag nehmen"}</button>
      <button class="link" data-a="dare" data-v="decline">Heute lieber keinen</button>`;
  else if (d.status === "accepted") body = `<p class="dare">${h(d.text)}</p>
      <p class="hint">Gilt nur, wenn du es vor dem Start der Abstimmung schaffst.</p>
      <button class="btn primary" data-a="dare" data-v="done">Erledigt</button>`;
  else if (d.status === "done") body = `<p class="dare done">Erledigt. Heute Nacht bist du vor dem Ordner getarnt.</p>`;
  else if (d.status === "expired") body = `<p class="hint">Nicht rechtzeitig geschafft. Heute Nacht keine Tarnung.</p>`;
  else if (d.status === "claimed") body = `<p class="dare done">${h(d.text)}</p><p class="hint">Gemeldet. Der Spielleiter prüft, ob er es gesehen hat.</p>`;
  else if (d.status === "failed") body = `<p class="hint">Der Spielleiter hat den Auftrag nicht gelten lassen. Heute Nacht keine Tarnung.</p>`;
  else if (d.status === "ignored") body = `<p class="hint">Auftrag verfallen. Heute Nacht keine Tarnung.</p>`;
  else body = `<p class="hint">Heute kein Auftrag.</p>`;
  return `<section class="darebox"><p class="eyebrow">Geheimauftrag · freiwillig</p>${body}${mates ? `<ul class="matedares">${mates}</ul>` : ""}</section>`;
}

function myRoleToggle() {
  if (!U.priv?.role) return "";
  // Same link for every role, so nobody can spot a Bierdieb by the screen.
  if (U.showRole) return `<div class="mini"><span>Deine Rolle: <b>${ROLES[U.priv.role].name}</b>${U.priv.role === "mafia" && U.priv.allies.length ? ` · Komplizen: ${U.priv.allies.map(id => h(nameOf(id))).join(", ")}` : ""}</span><button class="link" data-a="role">verdecken</button></div>${darePanel()}`;
  return `<button class="link center" data-a="role">Meine Rolle kurz anzeigen</button>`;
}

function optGrid(ids, disabled = {}) {
  return `<div class="grid">${ids.map(id => {
    const d = disabled[id];
    return `<button class="opt" data-a="sel" data-v="${h(id)}" aria-pressed="${U.sel === id}" ${d ? "disabled" : ""}>${h(nameOf(id))}${d ? `<small>${h(d)}</small>` : ""}</button>`;
  }).join("")}</div>`;
}

function hostBox(inner) { return U.isHost ? `<section class="hostbox"><p class="eyebrow">Spielleiter</p>${inner}</section>` : ""; }

function progress(n, of, label) {
  const pct = of ? Math.round((n / of) * 100) : 0;
  return `<div class="prog"><div class="row"><span>${label}</span><span class="count">${n} / ${of}</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
}

function rosterHtml(showTags = true) {
  const pub = U.pub;
  return `<ul class="roster">${pub.players.map(p => {
    const tag = p.role ? ROLES[p.role].name : p.alive ? (pub.phase === "lobby" && p.id === pub.hostId ? (pub.settings.hostPlays ? "Spielleiter" : "Admin, spielt nicht mit") : "im Zelt") : "raus";
    const kick = U.isHost && pub.phase === "lobby" && p.id !== me.id ? `<button class="x" data-a="kick" data-v="${h(p.id)}" aria-label="${h(p.name)} entfernen">×</button>` : "";
    return `<li class="${p.alive ? "" : "dead"}"><span>${h(p.name)}${p.id === me.id ? ' <em>(du)</em>' : ""}</span><span class="tagwrap">${showTags ? `<span class="tag${p.role === "mafia" ? " m" : ""}">${tag}</span>` : ""}${kick}</span></li>`;
  }).join("")}</ul>`;
}

function roleSummary(s) {
  const parts = [`${s.mafia} ${s.mafia === 1 ? "Bierdieb" : "Bierdiebe"}`];
  if (s.ordner) parts.push("Ordner"); if (s.sani) parts.push("Sanitäter"); if (s.gaudi) parts.push("Gaudibursch"); if (s.bedienung) parts.push("Bedienung"); if (s.brater) parts.push("Hendlbrater");
  if (s.dares) parts.push("mit Geheimaufträgen"); if (s.events) parts.push("mit Wiesn-Ereignissen");
  return parts.join(" · ");
}

/* ---------- Screens ---------- */
function vHome() {
  const joining = !!U.code;
  return `<section class="stage">
    <div class="herowrap">
      <div class="mug" aria-hidden="true"><svg viewBox="0 0 96 110">
        <g><circle class="bubble" cx="30" cy="30" r="4"/><circle class="bubble" cx="46" cy="26" r="3"/><circle class="bubble" cx="58" cy="30" r="4.5"/><circle class="bubble" cx="40" cy="28" r="2.5"/></g>
        <rect x="14" y="34" width="54" height="70" rx="8" fill="#f0b23a" stroke="#f6efe0" stroke-width="5"/>
        <path d="M68 50h10a10 10 0 0 1 10 10v16a10 10 0 0 1-10 10H68" fill="none" stroke="#f6efe0" stroke-width="6"/>
        <path d="M28 50v42M42 50v42M56 50v42" stroke="#e39f22" stroke-width="5" stroke-linecap="round"/>
        <path d="M10 38c-2-12 10-18 18-12 4-10 18-10 22-2 8-6 20 0 20 12-2 4-6 6-10 4-6 6-14 6-20 2-6 4-14 4-20 0-4 2-8 0-10-4z" fill="#fff4e6"/>
      </svg></div>
      <h1 class="hero">Mafia<span>Wiesn-Edition</span></h1>
    </div>
    <p class="lede">Jeder spielt am eigenen Handy. Einer macht den Raum auf, alle anderen treten mit dem Code bei.</p>
  </section>
  ${U.busy ? `<section class="panel"><p class="busy">${h(U.busy)}</p></section>` : `
  <form class="panel" id="joinForm" autocomplete="off">
    <label class="field"><span>Dein Name</span><input id="nameIn" name="name" maxlength="16" placeholder="z. B. Resi" value="${h(U.name)}" enterkeyhint="next"></label>
    <label class="field"><span>Raumcode</span><input id="codeIn" name="code" maxlength="4" placeholder="ABCD" value="${h(U.code)}" autocapitalize="characters" spellcheck="false" class="codein" enterkeyhint="go"></label>
    <button class="btn ${joining ? "primary" : "ghost"}" type="submit">Raum beitreten</button>
  </form>
  <div class="or"><span>oder</span></div>
  <button class="btn ${joining ? "ghost" : "primary"}" data-a="create">Neuen Raum aufmachen</button>`}
  ${U.err ? `<p class="err">${h(U.err)}</p>` : ""}
  <details class="panel rules"><summary>So funktioniert's</summary>
    <ul>
      <li>Wer den Raum aufmacht, ist <b>Spielleiter</b> und spielt trotzdem mit. Sein Handy muss bis zum Schluss offen bleiben.</li>
      <li>Alle anderen öffnen den Link oder scannen den QR-Code und tragen ihren Namen ein.</li>
      <li><b>Nachts</b> bekommt jeder eine geheime Aufgabe am eigenen Handy, auch normale Gäste. So verrät niemand seine Rolle durchs Tippen.</li>
      <li><b>Tagsüber</b> wird diskutiert und dann offen am Handy abgestimmt. Alle sehen live, wer wen wählt. Wer die meisten Stimmen hat, fliegt raus. Bei Gleichstand fliegt niemand.</li>
      <li><b>Optionale Rollen:</b> Die <b>Bedienung</b> bringt nachts jemandem eine Maß, der darf am nächsten Tag nicht abstimmen. Der <b>Hendlbrater</b> darf einmal im Spiel nachts jemanden rauswerfen. Der <b>Gaudibursch</b> gewinnt, wenn ihr ihn rauswerft.</li>
      <li><b>Wiesn-Ereignisse:</b> Morgens passiert manchmal etwas im Zelt, das die Regeln für den Tag ändert: Regenschauer, Stromausfall, Durchsage der Festleitung…</li>
      <li><b>Geheimaufträge:</b> Bierdiebe können tagsüber unauffällige Aufgaben erfüllen, zum Beispiel ein bestimmtes Wort sagen oder auf den Tisch klopfen. Dann sind sie in der nächsten Nacht vor dem Ordner getarnt. Also: Achtet auf komisches Verhalten.</li>
      <li>Wer raus ist, schweigt bis zum Schluss.</li>
    </ul>
  </details>`;
}

function vLobby() {
  const pub = U.pub, s = pub.settings, url = joinUrl();
  let qr = "";
  try { const q = window.qrcode(0, "M"); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
  const toggle = (k, t, d) => `<div class="setting"><div><b>${t}</b><small>${d}</small></div>
    <button class="toggle" role="switch" aria-checked="${!!s[k]}" aria-label="${t}" data-a="hs" data-k="${k}" data-v="${!s[k]}"></button></div>`;
  return `<section class="stage">
    <div class="invite">
      <div class="qr">${qr}</div>
      <div class="codebox"><p class="eyebrow">Raumcode</p><p class="code">${h(pub.room)}</p>
        <div class="sharebtns"><button class="btn ghost small" data-a="copy">${U.copied ? "Kopiert" : "Link kopieren"}</button>${navigator.share ? `<button class="btn ghost small" data-a="share">Teilen</button>` : ""}</div>
      </div>
    </div>
    <section class="panel"><div class="row"><h2>Im Raum</h2><span class="count">${pub.players.length}</span></div>${rosterHtml()}</section>
    ${U.isHost ? `<section class="panel">
      <h2>Rollen</h2>
      ${toggle("hostPlays", "Ich spiele selbst mit", "Aus: Du bekommst keine Rolle, siehst als Admin alles und bestätigst die Geheimaufträge")}
      <div class="setting"><div><b>Bierdiebe (Mafia)</b><small>Vorschlag für ${pub.players.length - (s.hostPlays ? 0 : 1)} Mitspieler: ${Engine.suggestMafia(pub.players.length - (s.hostPlays ? 0 : 1))}</small></div>
        <div class="stepper"><button data-a="hs" data-k="mafia" data-v="${Math.max(1, s.mafia - 1)}" aria-label="Weniger">−</button><output>${s.mafia}</output><button data-a="hs" data-k="mafia" data-v="${Math.min(6, s.mafia + 1)}" aria-label="Mehr">+</button></div></div>
      ${toggle("ordner", "Ordner", "Filzt nachts einen Gast und erfährt, ob er Bierdieb ist")}
      ${toggle("sani", "Sanitäter", "Rettet nachts einen Gast vor dem Rauswurf")}
      ${toggle("gaudi", "Gaudibursch", "Spielt allein und gewinnt, wenn er tagsüber rausfliegt")}
      ${toggle("bedienung", "Bedienung", "Bringt nachts jemandem eine Maß, der darf am Tag nicht abstimmen")}
      ${toggle("brater", "Hendlbrater", "Darf einmal im Spiel nachts jemanden rauswerfen")}
      ${toggle("events", "Wiesn-Ereignisse", "Jeden Morgen kann im Zelt etwas Unerwartetes passieren")}
      ${toggle("dares", "Geheimaufträge", "Bierdiebe können tagsüber unauffällige Aufgaben erfüllen und sind dann vor dem Ordner getarnt")}
      ${toggle("reveal", "Rolle beim Ausscheiden zeigen", "Wer rausfliegt, wird aufgedeckt")}
      <div class="setting"><div><b>Diskussion pro Tag</b><small>Timer läuft auf allen Handys</small></div>
        <div class="stepper"><button data-a="hs" data-k="minutes" data-v="${Math.max(1, s.minutes - 1)}" aria-label="Kürzer">−</button><output>${s.minutes}′</output><button data-a="hs" data-k="minutes" data-v="${Math.min(15, s.minutes + 1)}" aria-label="Länger">+</button></div></div>
    </section>
    ${pub.validation ? `<p class="err">${h(pub.validation)}</p>` : ""}
    <button class="btn primary" data-a="start" ${pub.validation ? "disabled" : ""}>Rollen verteilen</button>`
    : `<p class="note">${roleSummary(s)}${s.reveal ? " · Rollen werden beim Ausscheiden gezeigt" : ""}</p>
       <p class="hint center">${meP() ? "Du bist drin. Warte, bis der Spielleiter startet." : "Trete bei…"}</p>`}
  </section>`;
}

function vReveal() {
  const pub = U.pub, ready = pub.ready.includes(me.id);
  if (!meP()) return vSpectator();
  return `<section class="stage">
    <p class="eyebrow">Rollenverteilung</p>
    ${U.showRole && U.priv?.role ? roleCard(U.priv.role, U.priv.allies) + `<button class="btn ghost" data-a="role">Verdecken</button>`
      : `<div class="card"><div class="strip"></div><div class="inner covered"><p class="big">Deine Rolle ist bereit.</p><p>Halte das Handy so, dass niemand mitlesen kann.</p></div></div>
         <button class="btn primary" data-a="role" ${U.priv?.role ? "" : "disabled"}>${U.priv?.role ? "Rolle aufdecken" : "Rolle wird geladen…"}</button>`}
    <button class="btn ${ready ? "ghost" : "primary"}" data-a="ready" ${ready ? "disabled" : ""}>${ready ? "Du bist bereit" : "Gemerkt, ich bin bereit"}</button>
    ${progress(pub.ready.length, pub.players.length, "Bereit")}
    ${hostBox(pub.ready.length >= pub.players.length
      ? `<button class="btn primary" data-a="startNight">Nacht starten</button>`
      : `<button class="btn ghost" data-a="startNight">Nacht starten, ohne auf alle zu warten</button>`)}
  </section>`;
}

function vNight() {
  const pub = U.pub, task = U.priv?.task, p = meP();
  const prog = progress(pub.done.n, pub.done.of, "Fertig");
  const force = hostBox(U.confirm === "resolve"
    ? `<p class="hint">Wer noch nichts gewählt hat, verpasst seine Aktion.</p><div class="tbtns"><button class="btn primary" data-a="resolveNight">Ja, auflösen</button><button class="btn ghost" data-a="cancel">Warten</button></div>`
    : `<button class="link" data-a="askResolve">Nacht jetzt auflösen, ohne auf alle zu warten</button>`);
  if (!p || !p.alive) return `<section class="stage"><p class="eyebrow">Nacht ${pub.round}</p><h2 class="big">Du liegst unterm Tisch.</h2><p>Schau zu, aber verrat nichts.</p>${prog}${force}</section>`;
  if (!task) return `<section class="stage"><p class="busy">Aufgabe wird geladen…</p>${force}</section>`;
  const mates = (task.mates || []).map(v => `${h(nameOf(v.voter))} will ${h(nameOf(v.target))}`);
  const alliesOpen = U.priv.allies.filter(id => P(id)?.alive && !(task.mates || []).some(v => v.voter === id)).map(id => `${h(nameOf(id))} hat noch nicht gewählt`);
  const matesHtml = task.kind === "mafia" && U.priv.allies.length ? `<p class="allies">${[...mates, ...alliesOpen].join("<br>") || "Deine Komplizen sind raus."}</p>` : "";
  const cloakNote = U.priv.cloaked ? `<p class="note">Du bist heute Nacht getarnt: Filzt dich der Ordner, sieht er „kein Bierdieb“.</p>` : "";
  if (task.chosen != null) {
    let body = `<h2 class="big">Erledigt.</h2><p>Leg das Handy weg und tu unauffällig.</p>`;
    if (task.kind === "ordner") {
      const c = U.priv.checks.filter(x => x.round === pub.round).pop();
      if (c) body = `<div class="card"><div class="strip"></div><div class="inner"><p class="eyebrow">Ergebnis</p><h2 class="rolename sm">${h(nameOf(c.target))} ist ${c.isMafia ? "ein Bierdieb." : "kein Bierdieb."}</h2><p class="goal">Behalte das für dich, bis der Moment passt.</p></div></div>`;
    }
    if (task.kind === "mafia") body += matesHtml + cloakNote;
    if (task.kind === "brater") body += task.chosen === "skip" ? `<p class="hint">Grill bleibt aus. Du hast deinen Einsatz noch.</p>` : `<p class="note">${h(nameOf(task.chosen))} liegt auf dem Grill. Nur der Sanitäter kann ihn noch retten.</p>`;
    return `<section class="stage"><p class="eyebrow">Nacht ${pub.round}</p>${body}${prog}${myRoleToggle()}${force}</section>`;
  }
  const T = {
    mafia: ["Wen schickt ihr heute unter den Tisch?", "Den erwischen wir"],
    ordner: ["Wen filzt du heute Nacht?", "Filzen"],
    sani: ["Auf wen passt du heute Nacht auf?", "Aufpassen"],
    bedienung: ["Wem bringst du heute eine Maß aufs Haus?", "Maß servieren"],
    brater: ["Legst du heute jemanden auf den Grill?", U.sel === "skip" ? "Heute nicht" : "Auf den Grill"],
    cover: ["Wen hast du gerade am meisten im Verdacht?", "Verdacht notieren"]
  }[task.kind];
  const note = task.kind === "cover" ? `<p class="hint">Nur zur Tarnung, damit niemand etwas merkt. Zählt nicht.</p>`
    : task.kind === "mafia" ? matesHtml + (U.priv.allies.length ? `<p class="hint">Bei Gleichstand zählt das Ziel, das zuerst gewählt wurde.</p>` : "")
    : task.kind === "brater" ? `<p class="hint">Du hast das nur einmal im ganzen Spiel. Der Grill trifft jeden, auch Unschuldige.</p>`
    : task.kind === "bedienung" ? `<p class="hint">Wer die Maß bekommt, darf morgen nicht abstimmen.</p>` : "";
  return `<section class="stage">
    <p class="eyebrow">Nacht ${pub.round} · ${ROLES[U.priv.role].name}</p>
    <h2 class="q">${T[0]}</h2>${note}${task.kind === "mafia" ? cloakNote : ""}
    ${optGrid(task.options, task.disabled)}
    ${task.allowSkip ? `<button class="opt skip" data-a="sel" data-v="skip" aria-pressed="${U.sel === "skip"}">Heute nicht, Grill bleibt aus</button>` : ""}
    <button class="btn primary" data-a="night" ${U.sel == null ? "disabled" : ""}>${T[1]}</button>
    ${prog}${force}
  </section>`;
}

function roleLine(id) {
  const p = P(id);
  return p && p.role ? `<p class="note">${h(p.name)} war <b>${ROLES[p.role].name}</b>.</p>` : "";
}

function eventCard() {
  const e = U.pub.event;
  if (!e) return "";
  const E = EVENTS[e.id];
  return `<section class="eventcard"><p class="eyebrow">Wiesn-Ereignis</p><h3>${h(E.title)}</h3><p>${h(E.text(e))}</p></section>`;
}
function tipsyNote() {
  const t = U.pub.tipsy;
  if (!t || !P(t)?.alive) return "";
  return `<p class="note">${t === me.id ? "Du hast" : `${h(nameOf(t))} hat`} heute Nacht eine Maß aufs Haus bekommen und ${t === me.id ? "bist" : "ist"} zu beschwipst zum Abstimmen.</p>`;
}

function vMorning() {
  const pub = U.pub, M = pub.morning, V = M.victims || [];
  let head, text;
  if (V.length === 1) { const v = V[0]; head = `${h(nameOf(v.id))} liegt unterm Tisch.`; text = (v.by === "brater" ? BRATER_LINES : MORNING_LINES)[v.line](h(nameOf(v.id))); }
  else if (V.length > 1) { head = `${V.map(v => h(nameOf(v.id))).join(" und ")} sind raus.`; text = V.map(v => (v.by === "brater" ? BRATER_LINES : MORNING_LINES)[v.line](h(nameOf(v.id)))).join(" "); }
  else if (M.saved) { head = "Alle sind noch da."; text = "Heute Nacht wurde jemand angegriffen, aber der Sanitäter war schneller. Niemand ist gefallen."; }
  else { head = "Eine ruhige Nacht."; text = "Niemand ist gefallen."; }
  if (V.length && M.saved) text += " Einen anderen Angriff hat der Sanitäter abgewehrt.";
  return `<section class="stage">
    <p class="eyebrow">Tag ${pub.round} · Morgenmeldung</p>
    <h2 class="big">${head}</h2><p>${text}</p>
    ${V.map(v => roleLine(v.id)).join("")}
    ${V.some(v => v.id === me.id) ? `<p class="note warnnote">Das bist du. Ab jetzt schweigst du und schaust zu.</p>` : ""}
    ${tipsyNote()}${eventCard()}
    ${myRoleToggle()}
    ${hostBox(pub.winner ? `<button class="btn primary" data-a="toEnd">Zum Ergebnis</button>` : `<button class="btn primary" data-a="startDay">Diskussion starten</button>`)}
    ${!U.isHost ? `<p class="hint center">Der Spielleiter startet gleich die Diskussion.</p>` : ""}
  </section>`;
}

function vDay() {
  const pub = U.pub, t = pub.timer, left = timerLeft(t);
  return `<section class="stage">
    <p class="eyebrow">Tag ${pub.round} · Diskussion</p>
    <div class="panel timer"><span class="clock${left === 0 ? " done" : ""}" id="clock">${fmt(left)}</span>
      ${U.isHost ? `<div class="tbtns"><button class="btn ${t.running ? "ghost" : "primary"}" data-a="tToggle">${t.running ? "Pause" : left === 0 ? "Noch 1 Minute" : "Start"}</button><button class="btn ghost" data-a="tPlus">+30 s</button></div>`
        : `<p class="hint">${t.running ? "Läuft" : left === 0 ? "Zeit um" : "Der Spielleiter startet den Timer"}</p>`}
    </div>
    ${eventCard()}${tipsyNote()}
    <section class="panel"><div class="row"><h2>Im Zelt</h2><span class="count">${alivePlayers().length}</span></div>${rosterHtml()}</section>
    ${myRoleToggle()}
    ${hostBox(`<button class="btn primary" data-a="startVote">Abstimmung starten</button>`)}
  </section>`;
}

function vVote() {
  const pub = U.pub, p = meP();
  const voted = pub.voted.includes(me.id);
  const prog = progress(pub.voted.length, pub.voters || alivePlayers().length, "Abgestimmt");
  const noSkip = pub.event?.id === "pflicht";
  const who = liveVotes();
  const ctrl = hostBox(`<button class="btn ghost" data-a="closeVote">Abstimmung jetzt schließen</button>`);
  if (!p || !p.alive) return `<section class="stage"><p class="eyebrow">Tag ${pub.round} · Abstimmung</p><h2 class="big">Das Zelt stimmt ab.</h2><p>Du bist raus und stimmst nicht mit.</p>${prog}${who}${ctrl}</section>`;
  if (pub.tipsy === me.id) return `<section class="stage"><p class="eyebrow">Tag ${pub.round} · Abstimmung</p><h2 class="big">Zu beschwipst.</h2><p>Die Maß von der Bedienung zeigt Wirkung. Heute stimmst du nicht mit.</p>${prog}${who}${ctrl}</section>`;
  if (voted) return `<section class="stage"><p class="eyebrow">Tag ${pub.round} · Abstimmung</p><h2 class="big">Stimme abgegeben.</h2><p>${U.myVote ? `Du hast ${U.myVote === "skip" ? "dich enthalten" : `für ${h(nameOf(U.myVote))} gestimmt`}.` : ""} Warte, bis alle abgestimmt haben.</p>${prog}${who}${ctrl}</section>`;
  const others = alivePlayers().filter(q => q.id !== me.id).map(q => q.id);
  return `<section class="stage">
    <p class="eyebrow">Tag ${pub.round} · Abstimmung</p>
    <h2 class="q">Wer soll aus dem Zelt fliegen?</h2>
    ${optGrid(others)}
    ${noSkip ? `<p class="hint">Enthaltung ist heute verboten.</p>` : `<button class="opt skip" data-a="sel" data-v="skip" aria-pressed="${U.sel === "skip"}">Enthaltung</button>`}
    <button class="btn primary" data-a="vote" ${U.sel == null ? "disabled" : ""}>${U.sel == null ? "Person antippen" : U.sel === "skip" ? "Enthalten" : `Für ${h(nameOf(U.sel))} stimmen`}</button>
    ${prog}${who}${myRoleToggle()}${ctrl}
  </section>`;
}

// During the vote only WHO has voted is public; who voted for whom is revealed in the verdict.
function liveVotes() {
  const pub = U.pub;
  const open = alivePlayers().filter(p => !pub.voted.includes(p.id) && p.id !== pub.tipsy).map(p => h(p.name));
  return `<p class="hint">Die Stimmen bleiben geheim, bis alle abgestimmt haben. Danach sieht jeder, wer wen gewählt hat.${open.length ? ` Fehlt noch: ${open.join(", ")}` : ""}</p>`;
}

function tallyHtml() {
  const t = U.pub.tally || {};
  const rows = Object.entries(t).sort((a, b) => b[1].length - a[1].length);
  if (!rows.length) return "";
  const hidden = U.pub.tallyHidden;
  return `<section class="panel"><h2>${hidden ? "Stimmen (Stromausfall: wer wen gewählt hat, bleibt im Dunkeln)" : "Wer hat wen gewählt"}</h2><ul class="roster">${rows.map(([target, vs]) =>
    `<li><span><b>${target === "skip" ? "Enthaltung" : h(nameOf(target))}</b></span><span class="tag">${vs.length}${hidden ? (vs.length === 1 ? " Stimme" : " Stimmen") : " · " + vs.map(v => h(nameOf(v))).join(", ")}</span></li>`).join("")}</ul></section>`;
}

function vVerdict() {
  const pub = U.pub, L = pub.lynch;
  let head, body = "";
  if (!L) { head = "Niemand fliegt raus."; body = `<p>Gleichstand oder zu viele Enthaltungen. Die Bierdiebe reiben sich die Hände.</p>`; }
  else {
    const p = P(L);
    head = `${h(p.name)} fliegt aus dem Zelt.`;
    body = p.role === "gaudi" ? `<p class="note">${h(p.name)} war der <b>Gaudibursch</b> und wollte genau das.</p>` : roleLine(L);
    if (L === me.id) body += `<p class="note warnnote">Das bist du. Ab jetzt schweigst du und schaust zu.</p>`;
  }
  return `<section class="stage">
    <p class="eyebrow">Tag ${pub.round} · Urteil</p>
    <h2 class="big">${head}</h2>${body}${tallyHtml()}
    ${hostBox(pub.winner ? `<button class="btn primary" data-a="toEnd">Zum Ergebnis</button>` : `<button class="btn primary" data-a="startNight">Es wird Nacht</button>`)}
    ${!U.isHost ? `<p class="hint center">Gleich wird es wieder Nacht.</p>` : ""}
  </section>`;
}

function vEnd() {
  const pub = U.pub;
  const W = { mafia: ["Die Maßkrug-Mafia gewinnt!", "Die Bierdiebe haben das Zelt übernommen."],
              guests: ["Die Gäste gewinnen!", "Alle Bierdiebe sind draußen. Prost!"],
              gaudi: ["Der Gaudibursch gewinnt!", "Er wollte rausfliegen, und ihr habt ihm den Gefallen getan."] }[pub.winner];
  return `<section class="stage">
    <p class="eyebrow">Nach ${pub.round} ${pub.round === 1 ? "Runde" : "Runden"}</p>
    <h2 class="big">${W[0]}</h2><p>${W[1]}</p>
    <section class="panel"><h2>Alle Rollen</h2>${rosterHtml()}</section>
    ${recapHtml()}
    ${hostBox(`<div class="actions">
      <button class="btn primary" data-a="again">Nochmal mit denselben Leuten</button>
      <button class="btn ghost" data-a="newLobby">Zurück in die Lobby</button></div>`)}
    ${!U.isHost ? `<p class="hint center">Der Spielleiter startet gleich die nächste Runde.</p>` : ""}
  </section>`;
}

// Full timeline of the game, published by the host only at the end.
function recapHtml() {
  const log = U.pub.log || [];
  if (!log.length) return "";
  const n = id => `<b>${h(nameOf(id))}</b>`;
  const items = log.map(e => {
    const lines = [];
    if (e.type === "night") {
      const target = e.mafiaVotes.length ? Engine.mafiaTarget(e.mafiaVotes) : null;
      if (e.mafiaVotes.length > 1 && new Set(e.mafiaVotes.map(v => v.target)).size > 1)
        lines.push(`Die Bierdiebe waren sich uneinig: ${e.mafiaVotes.map(v => `${n(v.voter)} wollte ${n(v.target)}`).join(", ")}.`);
      if (target) lines.push(`Die Bierdiebe hatten es auf ${n(target)} abgesehen.`);
      if (e.roast && e.roast !== "skip") lines.push(`Der Hendlbrater hat ${n(e.roast)} auf den Grill gelegt.`);
      if (e.protect) lines.push(`Der Sanitäter hat auf ${n(e.protect)} aufgepasst${e.saved ? " und damit jemanden gerettet" : ""}.`);
      if (e.check) lines.push(`Der Ordner hat ${n(e.check.target)} gefilzt: ${e.check.cloaked ? "ein Bierdieb, aber getarnt durch den Geheimauftrag!" : e.check.isMafia ? "Bierdieb." : "sauber."}`);
      if (e.serve) lines.push(`Die Bedienung hat ${n(e.serve)} eine Maß gebracht.`);
      lines.push(e.victims.length ? `Raus: ${e.victims.map(v => n(v.id)).join(", ")}.` : "Niemand ist rausgeflogen.");
    } else {
      if (e.event) lines.push(`Ereignis: ${h(EVENTS[e.event.id].title)}`);
      e.dares.filter(d => ["done", "expired", "failed", "claimed"].includes(d.status)).forEach(d => lines.push(`${n(d.id)} hatte den Auftrag „${h(d.text.replace(/\.$/, ""))}“: ${d.status === "done" ? "geschafft" : d.status === "failed" ? "vom Spielleiter nicht anerkannt" : "nicht geschafft"}.`));
      if (e.tipsy) lines.push(`${n(e.tipsy)} war zu beschwipst zum Abstimmen.`);
      const votes = Object.entries(e.tally || {}).sort((a, b) => b[1].length - a[1].length).map(([t, vs]) => `${t === "skip" ? "Enthaltung" : n(t)} ${vs.length}`);
      if (votes.length) lines.push(`Abstimmung: ${votes.join(", ")}.`);
      lines.push(e.lynch ? `Rausgeworfen: ${n(e.lynch)}.` : "Niemand wurde rausgeworfen.");
    }
    return `<li><p class="eyebrow">${e.type === "night" ? "Nacht" : "Tag"} ${e.round}</p>${lines.map(l => `<p>${l}</p>`).join("")}</li>`;
  }).join("");
  return `<section class="panel"><h2>Rückblick</h2><ol class="recap">${items}</ol></section>`;
}

/* ---------- Admin (host does not play) ---------- */
function vAdmin() {
  const pub = U.pub;
  let main;
  if (pub.phase === "reveal") main = `<section class="stage"><p class="eyebrow">Rollenverteilung</p><h2 class="big">Alle schauen ihre Rolle an.</h2>
      ${progress(pub.ready.length, pub.players.length, "Bereit")}
      ${hostBox(pub.ready.length >= pub.players.length ? `<button class="btn primary" data-a="startNight">Nacht starten</button>` : `<button class="btn ghost" data-a="startNight">Nacht starten, ohne auf alle zu warten</button>`)}</section>`;
  else if (pub.phase === "night") main = `<section class="stage"><p class="eyebrow">Nacht ${pub.round}</p><h2 class="big">Das Zelt schläft.</h2>
      ${progress(pub.done.n, pub.done.of, "Fertig")}
      ${hostBox(U.confirm === "resolve"
        ? `<p class="hint">Wer noch nichts gewählt hat, verpasst seine Aktion.</p><div class="tbtns"><button class="btn primary" data-a="resolveNight">Ja, auflösen</button><button class="btn ghost" data-a="cancel">Warten</button></div>`
        : `<button class="link" data-a="askResolve">Nacht jetzt auflösen, ohne auf alle zu warten</button>`)}</section>`;
  else if (pub.phase === "vote") main = `<section class="stage"><p class="eyebrow">Tag ${pub.round} · Abstimmung</p><h2 class="big">Das Zelt stimmt ab.</h2>
      ${progress(pub.voted.length, pub.voters || alivePlayers().length, "Abgestimmt")}${liveVotes()}
      ${hostBox(`<button class="btn ghost" data-a="closeVote">Abstimmung jetzt schließen</button>`)}</section>`;
  else main = { morning: vMorning, day: vDay, verdict: vVerdict, end: vEnd }[pub.phase]();
  return main + adminPanel();
}

function adminPanel() {
  if (!U.adminOpen) return `<button class="btn ghost" data-a="adminToggle">Admin-Übersicht zeigen (nur für dich)</button>`;
  const A = host.adminView(), pub = U.pub;
  const nm = id => h(A.players.find(p => p.id === id)?.name ?? "?");
  const N = A.night;
  const nightLine = p => {
    if (!N || !p.alive) return "";
    const t = N.actions[p.id];
    if (t == null) return `<span class="adm-wait">wählt noch…</span>`;
    const kind = Engine.nightTask(p, A.players, { braterUsed: A.braterUsed }).kind;
    if (kind === "mafia") return `will ${nm(t)}${(N.cloaked || []).includes(p.id) ? " · getarnt" : ""}`;
    if (kind === "sani") return `schützt ${nm(t)}`;
    if (kind === "ordner") { const c = A.checks.filter(x => x.target === t).at(-1); return `filzt ${nm(t)} → ${c?.cloaked ? "Bierdieb, aber getarnt: sieht „sauber“" : c?.isMafia ? "Bierdieb" : "sauber"}`; }
    if (kind === "bedienung") return `serviert ${nm(t)} eine Maß`;
    if (kind === "brater") return t === "skip" ? "Grill bleibt aus" : `grillt ${nm(t)}`;
    return `Tarnung: tippt ${nm(t)}`;
  };
  const voteLine = p => {
    if (pub.phase !== "vote" || !p.alive) return "";
    if (p.id === A.tipsy) return "beschwipst, stimmt nicht";
    const v = A.votes[p.id];
    return v == null ? `<span class="adm-wait">stimmt noch ab…</span>` : v === "skip" ? "Enthaltung" : `stimmt für ${nm(v)}`;
  };
  const rows = A.players.map(p => `<li class="${p.alive ? "" : "dead"}"><div class="adm-head"><span>${h(p.name)}</span><span class="tag${p.role === "mafia" ? " m" : ""}">${ROLES[p.role]?.name ?? ""}</span></div>
      ${[nightLine(p), voteLine(p), p.id === A.tipsy && pub.phase !== "vote" ? "beschwipst" : ""].filter(Boolean).map(l => `<p class="adm-line">${l}</p>`).join("")}</li>`).join("");
  const canJudge = ["morning", "day", "vote", "verdict"].includes(pub.phase);
  const S = { offered: "sucht noch aus", accepted: "hat genommen, noch nicht gemeldet", claimed: "meldet: erledigt", done: "bestätigt, ist heute Nacht getarnt", failed: "nicht anerkannt", expired: "nicht geschafft", ignored: "keinen genommen", declined: "will heute keinen" };
  const dares = A.dares.map(d => `<li class="adm-dare${d.status === "claimed" ? " hot" : ""}">
      <div class="adm-head"><b>${nm(d.id)}</b><span class="tag">${S[d.status] || d.status}</span></div>
      ${d.text ? `<p class="dare sm">${h(d.text)}</p>` : `<p class="adm-line">Zur Auswahl: ${d.choices.map(h).join(" · ")}</p>`}
      ${canJudge && d.text && ["accepted", "claimed", "expired", "done", "failed"].includes(d.status) ? `<div class="tbtns"><button class="btn ${d.status === "done" ? "primary" : "ghost"}" data-a="adminDare" data-v="${h(d.id)}" data-ok="1">Geschafft</button><button class="btn ${d.status === "failed" ? "primary" : "ghost"}" data-a="adminDare" data-v="${h(d.id)}" data-ok="0">Nicht geschafft</button></div>` : ""}
    </li>`).join("");
  return `<section class="panel admin">
    <div class="row"><h2>Admin-Übersicht</h2><button class="link" data-a="adminToggle">verbergen</button></div>
    <p class="hint">Nur auf deinem Handy. Halt es so, dass keiner mitliest.</p>
    <ul class="roster adm">${rows}</ul>
    ${pub.settings.dares ? `<h2>Geheimaufträge</h2>${dares ? `<ul class="roster adm">${dares}</ul>` : `<p class="hint">${["morning", "day", "vote", "verdict"].includes(pub.phase) ? "Heute keine." : "Gibt es morgens nach der Nacht."}</p>`}` : ""}
  </section>`;
}

function vSpectator() {
  return `<section class="stage"><p class="eyebrow">Raum ${h(U.room)}</p><h2 class="big">Hier läuft gerade eine Runde.</h2>
    <p>Sobald der Spielleiter zurück in die Lobby geht, bist du automatisch dabei.</p></section>`;
}

/* ---------- Confetti: blue-white lozenges and foam, 4 seconds ---------- */
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.getElementById("confetti"); if (!c) return;
  const x = c.getContext("2d"), W = c.width = innerWidth, H = c.height = innerHeight;
  const cols = ["#2c7cc4", "#f6efe0", "#f0b23a", "#f6a5b8"];
  const ps = Array.from({ length: 120 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * .6, vy: 2 + Math.random() * 3, vx: -1 + Math.random() * 2, r: Math.random() * 6.28, vr: -.1 + Math.random() * .2, s: 6 + Math.random() * 8, c: cols[Math.floor(Math.random() * 4)] }));
  const t0 = performance.now();
  (function frame(t) {
    x.clearRect(0, 0, W, H);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c;
      x.beginPath(); x.moveTo(0, -p.s / 2); x.lineTo(p.s / 3, 0); x.lineTo(0, p.s / 2); x.lineTo(-p.s / 3, 0); x.fill(); x.restore(); });
    if (t - t0 < 4000) requestAnimationFrame(frame); else x.clearRect(0, 0, W, H);
  })(t0);
}

/* ---------- Render ---------- */
function render() {
  const app = document.getElementById("app");
  const active = document.activeElement?.id;
  let body;
  if (U.screen !== "game" || !U.pub) body = U.screen === "game" ? `<section class="panel"><p class="busy">${h(U.busy || "Verbinde…")}</p></section>` : vHome();
  else if (U.isHost && host && host.isAdmin() && U.pub.phase !== "lobby") body = vAdmin();
  else if (U.pub.phase !== "lobby" && !meP() && U.pub.phase !== "end") body = vSpectator();
  else body = { lobby: vLobby, reveal: vReveal, night: vNight, morning: vMorning, day: vDay, vote: vVote, verdict: vVerdict, end: vEnd }[U.pub.phase]();
  document.body.dataset.phase = U.screen === "game" && U.pub ? U.pub.phase : "home";
  app.innerHTML = topBar() + body;
  updateBanner();
  if (active && document.getElementById(active)) document.getElementById(active).focus();
}

function updateBanner() {
  const el = document.getElementById("banner");
  if (!el) return;
  let msg = "";
  if (U.screen === "game" && bus && !U.online) msg = "Verbindung weg. Verbinde neu…";
  else if (U.screen === "game" && !U.isHost && U.pub && Date.now() - U.lastHb > 16000) msg = "Das Handy des Spielleiters antwortet nicht. Die Seite muss dort offen und der Bildschirm an bleiben.";
  el.innerHTML = msg ? `<p class="banner">${h(msg)}</p>` : "";
}

/* ---------- Actions ---------- */
const A = {
  create() { me.name = U.name.trim().replace(/\s+/g, " ").slice(0, 16); KV.set("name", me.name); createRoom(); },
  role() { U.showRole = !U.showRole; },
  ready() { send({ t: "ready" }); },
  dare(v) { send({ t: "dare", action: v }); },
  dareSel(v) { U.dareSel = +v; },
  darePick() { if (U.dareSel != null) { send({ t: "dare", action: "pick", idx: U.dareSel }); U.dareSel = null; } },
  sel(v) { U.sel = v; },
  night() { if (U.sel != null) { send({ t: "night", target: U.sel }); U.sel = null; } },
  vote() { if (U.sel != null) { U.myVote = U.sel; send({ t: "vote", target: U.sel }); U.sel = null; } },
  quit() { U.confirm = "quit"; },
  cancel() { U.confirm = null; },
  quitYes() {
    if (U.isHost) host.closeRoom();
    else if (U.pub?.phase === "lobby") send({ t: "leave" });
    setTimeout(() => leaveLocal(null), 150);
  },
  async copy() {
    try { await navigator.clipboard.writeText(joinUrl()); U.copied = true; render(); setTimeout(() => { U.copied = false; render(); }, 2000); }
    catch (e) { U.err = joinUrl(); }
  },
  share() { navigator.share({ title: "Mafia Wiesn-Edition", text: `Komm in meinen Mafia-Raum ${U.room}`, url: joinUrl() }).catch(() => {}); },
  // host controls
  hs(v, el) { const k = el.dataset.k; host.updateSettings({ [k]: k === "mafia" || k === "minutes" ? +v : v === "true" }); },
  kick(v) { host.kick(v); },
  adminToggle() { U.adminOpen = !U.adminOpen; },
  adminDare(v, el) { host.confirmDare(v, el.dataset.ok === "1"); },
  start() { host.start(); },
  startNight() { host.startNight(); },
  askResolve() { U.confirm = "resolve"; },
  resolveNight() { U.confirm = null; host.resolveNight(); },
  startDay() { host.startDay(); },
  tToggle() { host.timerToggle(); },
  tPlus() { host.timerPlus(); },
  startVote() { host.startVote(); },
  closeVote() { host.closeVote(); },
  toEnd() { host.toEnd(); },
  again() { host.again(); },
  newLobby() { host.newLobby(); }
};

document.addEventListener("click", e => {
  const b = e.target.closest("[data-a]");
  if (!b || b.disabled) return;
  wake();
  const a = b.dataset.a;
  if (!A[a]) return;
  if (!["quit", "quitYes", "cancel", "askResolve", "resolveNight"].includes(a)) U.confirm = null;
  A[a](b.dataset.v, b);
  render();
});

document.addEventListener("input", e => {
  if (e.target.id === "nameIn") { U.name = e.target.value; }
  if (e.target.id === "codeIn") { const c = Engine.normalizeCode(e.target.value); if (c !== e.target.value) e.target.value = c; U.code = c; }
});

document.addEventListener("submit", e => {
  if (e.target.id !== "joinForm") return;
  e.preventDefault();
  me.name = U.name.trim().replace(/\s+/g, " ").slice(0, 16);
  KV.set("name", me.name);
  if (!me.name) { U.err = "Trag zuerst deinen Namen ein."; return render(); }
  joinRoom(U.code);
});

/* ---------- Ticks: timer + host heartbeat banner ---------- */
setInterval(() => {
  if (U.pub?.phase === "day") { const c = document.getElementById("clock"); if (c) { const l = timerLeft(U.pub.timer); c.textContent = fmt(l); c.classList.toggle("done", l === 0); } }
  updateBanner();
}, 500);

/* ---------- Keep screen on ---------- */
let lock = null;
async function wake() {
  try { if (!lock && navigator.wakeLock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch (e) { lock = null; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { wake(); if (bus && U.room && !U.isHost) send({ t: "hello" }); } });

/* ---------- Boot ---------- */
(function boot() {
  const session = KV.get("session");
  const urlRoom = Engine.normalizeCode(params.get("r") || "");
  if (session && (!urlRoom || urlRoom === session.room)) {
    const saved = session.host ? KV.get("host:" + session.room) : null;
    if (saved) return resumeHost(session, saved);
    if (me.name) return joinRoom(session.room, { quiet: true });
  }
  render();
  if (urlRoom && document.getElementById("nameIn") && !me.name) document.getElementById("nameIn").focus();
})();

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
