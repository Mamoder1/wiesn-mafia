// Host-level tests with an in-memory bus: dares cloak a Bierdieb from the Ordner, votes stay secret until the verdict.
import assert from "assert";
import { Host, freshHostState } from "../js/host.js";
import { DARES } from "../js/engine.js";
const bus = { pubs: {}, publish(t, o) { this.pubs[t] = o; }, subscribe() {} };
globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};
const H = freshHostState("TEST", "a");
H.settings.events = false; // deterministic for the first scenario
const host = new Host(bus, H);
["a", "b", "c", "d", "e", "f", "g"].forEach(id => host.handle({ t: "join", id, name: id.toUpperCase() }));
assert.ok(host.start());
// force roles: a,b mafia; c ordner; d sani; rest gast
const roles = { a: "mafia", b: "mafia", c: "ordner", d: "sani", e: "gast", f: "gast", g: "gast" };
H.players.forEach(p => p.role = roles[p.id]);
host.startNight();
// night 1: mafia kills e, sani protects f, ordner checks a (no cloak yet) -> Bierdieb
host.handle({ t: "night", id: "a", target: "e" }); host.handle({ t: "night", id: "b", target: "e" });
host.handle({ t: "night", id: "c", target: "a" }); host.handle({ t: "night", id: "d", target: "f" });
host.handle({ t: "night", id: "e", target: "f" }); host.handle({ t: "night", id: "f", target: "g" }); host.handle({ t: "night", id: "g", target: "f" });
assert.equal(H.phase, "morning"); assert.equal(H.checks[0].isMafia, true);
assert.equal(H.players.find(p => p.id === "e").alive, false);
// dares offered to both alive Bierdiebe, not to others
assert.ok(H.dares.a && H.dares.b && !H.dares.c);
assert.equal(bus.pubs["wm1/TEST/p/c"].dare, undefined);
// three distinct choices each, no overlap between accomplices
assert.equal(new Set(H.dares.a.choices).size, 3); assert.equal(new Set([...H.dares.a.choices, ...H.dares.b.choices]).size, 6);
assert.equal(bus.pubs["wm1/TEST/p/a"].dare.choices.length, 3);
// nobody called Mike/Luca in this game -> their dares are never offered
for (let i = 0; i < 50; i++) { const c = host.dareChoices(H.players[0]); assert.ok(c.every(x => !/Mike|Luca/.test(JSON.stringify(DARES[x])))); }
host.handle({ t: "dare", id: "c", action: "pick", idx: H.dares.a.choices[0] }); // non-mafia ignored
host.handle({ t: "dare", id: "a", action: "pick", idx: H.dares.b.choices[0] }); // not one of a's choices: ignored
assert.equal(H.dares.a.status, "offered");
host.handle({ t: "dare", id: "a", action: "pick", idx: H.dares.a.choices[1] }); host.handle({ t: "dare", id: "a", action: "done" });
assert.equal(H.dares.a.idx, H.dares.a.choices[1]);
host.handle({ t: "dare", id: "b", action: "pick", idx: H.dares.b.choices[2] }); // b picks but never finishes
host.startDay(); host.startVote();
assert.equal(H.dares.b.status, "expired");
// votes are secret during voting
host.handle({ t: "vote", id: "a", target: "f" });
const pubDuring = bus.pubs["wm1/TEST/s"];
assert.equal(pubDuring.votes, undefined); assert.equal(pubDuring.tally, null); assert.deepEqual(pubDuring.voted, ["a"]);
host.handle({ t: "vote", id: "b", target: "f" }); host.handle({ t: "vote", id: "c", target: "g" });
host.handle({ t: "vote", id: "d", target: "skip" }); host.handle({ t: "vote", id: "f", target: "g" });
host.handle({ t: "vote", id: "g", target: "f" });
assert.equal(H.phase, "verdict");
const pubAfter = bus.pubs["wm1/TEST/s"];
assert.deepEqual(pubAfter.tally.f.sort(), ["a", "b", "g"]); assert.equal(pubAfter.lynch, "f");
// night 2: a is cloaked (done), b is not (expired)
host.startNight();
assert.deepEqual(H.night.cloaked, ["a"]);
assert.equal(bus.pubs["wm1/TEST/p/a"].cloaked, true); assert.equal(bus.pubs["wm1/TEST/p/b"].cloaked, false);
host.handle({ t: "night", id: "c", target: "a" });
assert.equal(H.checks.at(-1).isMafia, false, "cloaked Bierdieb must look harmless");

// ---- Scenario 2: Bedienung, Hendlbrater, events, recap
{
  const bus2 = { pubs: {}, publish(t, o) { this.pubs[t] = o; }, subscribe() {} };
  const S = freshHostState("TWO", "a"); const h2 = new Host(bus2, S);
  ["a", "b", "c", "d", "e", "f", "g"].forEach(id => h2.handle({ t: "join", id, name: id.toUpperCase() }));
  h2.updateSettings({ mafia: 1, ordner: false, sani: true, bedienung: true, brater: true, events: true });
  assert.ok(h2.start());
  const R = { a: "mafia", b: "sani", c: "bedienung", d: "brater", e: "gast", f: "gast", g: "gast" };
  S.players.forEach(p => p.role = R[p.id]);
  h2.startNight();
  assert.equal(bus2.pubs["wm1/TWO/p/d"].task.allowSkip, true);
  h2.handle({ t: "night", id: "d", target: "skip" }); // brater waits
  h2.handle({ t: "night", id: "a", target: "e" }); h2.handle({ t: "night", id: "b", target: "f" });
  h2.handle({ t: "night", id: "c", target: "g" });
  ["e", "f", "g"].forEach(id => h2.handle({ t: "night", id, target: "a" }));
  assert.equal(S.phase, "morning"); assert.equal(S.braterUsed, false); assert.equal(S.tipsy, "g");
  assert.equal(bus2.pubs["wm1/TWO/s"].tipsy, "g");
  h2.startDay(); h2.startVote();
  h2.handle({ t: "vote", id: "g", target: "a" }); // tipsy: ignored
  assert.equal(S.votes.g, undefined);
  ["a", "b", "c", "d", "f"].forEach(id => h2.handle({ t: "vote", id, target: id === "f" ? "c" : "f" }));
  assert.equal(S.phase, "verdict", "vote closes without the tipsy player");
  assert.equal(S.lynch, "f");
  // night 2: brater grills the Bierdieb, Bedienung can't serve g twice
  h2.startNight();
  assert.equal(bus2.pubs["wm1/TWO/p/c"].task.disabled.g, "letzte Nacht");
  h2.handle({ t: "night", id: "c", target: "g" }); assert.equal(S.night.actions.c, undefined);
  h2.handle({ t: "night", id: "c", target: "b" });
  h2.handle({ t: "night", id: "d", target: "a" }); h2.handle({ t: "night", id: "a", target: "g" });
  h2.handle({ t: "night", id: "b", target: "b" }); h2.handle({ t: "night", id: "g", target: "a" });
  assert.equal(S.phase, "morning");
  assert.deepEqual(S.morning.victims.map(v => v.by).sort(), ["brater", "mafia"]);
  assert.equal(S.winner, "guests");
  h2.toEnd();
  const end = bus2.pubs["wm1/TWO/s"];
  assert.equal(end.log.length, 3); assert.equal(end.log[0].type, "night"); assert.equal(end.log[1].type, "day");
  assert.equal(end.log[2].roast, "a");
  // events: strom hides voters in the verdict, pflicht forbids skip, regen halves time
  const bus3 = { pubs: {}, publish(t, o) { this.pubs[t] = o; }, subscribe() {} };
  const T = freshHostState("THR", "a"); const h3 = new Host(bus3, T);
  ["a", "b", "c", "d", "e"].forEach(id => h3.handle({ t: "join", id, name: id }));
  h3.updateSettings({ events: false, minutes: 4 }); h3.start();
  T.players.forEach((p, i) => p.role = i === 0 ? "mafia" : "gast");
  h3.startNight(); ["a", "b", "c", "d", "e"].forEach(id => h3.handle({ t: "night", id, target: id === "a" ? "b" : "a" }));
  T.event = { id: "regen", round: T.round, n: 1 }; h3.startDay(); assert.equal(T.timer.left, 120);
  T.event = { id: "pflicht", round: T.round, n: 1 }; h3.startVote();
  h3.handle({ t: "vote", id: "c", target: "skip" }); assert.equal(T.votes.c, undefined);
  T.event = { id: "strom", round: T.round, n: 1 };
  ["a", "c", "d", "e"].forEach(id => h3.handle({ t: "vote", id, target: id === "a" ? "c" : "a" }));
  const v = bus3.pubs["wm1/THR/s"]; assert.equal(v.tallyHidden, true); assert.deepEqual(v.tally.a, [null, null, null]);
}
// ---- Scenario 3: admin mode (host does not play, confirms dares)
{
  const b4 = { pubs: {}, publish(t, o) { this.pubs[t] = o; }, subscribe() {} };
  const A = freshHostState("ADM", "boss"); const h4 = new Host(b4, A);
  ["boss", "a", "b", "c", "d", "e", "f"].forEach(id => h4.handle({ t: "join", id, name: id }));
  h4.updateSettings({ hostPlays: false, mafia: 2, ordner: true, sani: false, events: false });
  assert.equal(b4.pubs["wm1/ADM/s"].validation, null); // 6 real players are enough
  assert.ok(h4.start());
  assert.ok(!A.players.some(p => p.id === "boss"), "admin gets no role");
  assert.equal(A.players.length, 6);
  const R = { a: "mafia", b: "mafia", c: "ordner", d: "gast", e: "gast", f: "gast" };
  A.players.forEach(p => p.role = R[p.id]);
  h4.startNight();
  ["a", "b"].forEach(id => h4.handle({ t: "night", id, target: "d" }));
  ["c", "d", "e", "f"].forEach(id => h4.handle({ t: "night", id, target: "a" }));
  assert.equal(A.phase, "morning");
  const da = A.dares.a, db = A.dares.b;
  h4.handle({ t: "dare", id: "a", action: "pick", idx: da.choices[0] }); h4.handle({ t: "dare", id: "a", action: "done" });
  assert.equal(A.dares.a.status, "claimed", "in admin mode 'done' needs confirmation");
  h4.handle({ t: "dare", id: "b", action: "pick", idx: db.choices[0] }); h4.handle({ t: "dare", id: "b", action: "done" });
  assert.equal(h4.adminView().dares.length, 2);
  h4.confirmDare("a", true); assert.equal(A.dares.a.status, "done");
  h4.startDay(); h4.startVote();
  ["a", "b", "c", "e", "f"].forEach(id => h4.handle({ t: "vote", id, target: "skip" }));
  assert.equal(A.phase, "verdict");
  h4.startNight(); // b was never confirmed
  assert.deepEqual(A.night.cloaked, ["a"]);
  assert.equal(A.log.find(l => l.type === "day").dares.find(d => d.id === "b").status, "claimed");
  // back to lobby: admin is listed again
  A.winner = "mafia"; h4.toEnd(); h4.newLobby();
  assert.ok(A.players.some(p => p.id === "boss"));
}
console.log("host: all tests passed");
