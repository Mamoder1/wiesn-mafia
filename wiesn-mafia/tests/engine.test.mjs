import assert from "assert";
import { Engine } from "../js/engine.js";
const P = roles => roles.map((r, i) => ({ id: "p" + i, name: "p" + i, role: r, alive: true }));
for (let n = 5; n <= 20; n++) assert.equal(Engine.validate(n, { mafia: Engine.suggestMafia(n), ordner: true, sani: true, gaudi: n >= 7 }), null, "n=" + n);
assert.ok(Engine.validate(4, { mafia: 1 })); assert.ok(Engine.validate(6, { mafia: 3 }));
assert.deepEqual(Engine.assignRoles(6, { mafia: 1, ordner: true, sani: true }).sort(), ["gast", "gast", "gast", "mafia", "ordner", "sani"]);
assert.equal(Engine.mafiaTarget([{ voter: "a", target: "x" }, { voter: "b", target: "y" }, { voter: "c", target: "y" }]), "y");
assert.equal(Engine.mafiaTarget([{ voter: "a", target: "x" }, { voter: "b", target: "y" }]), "x");
assert.deepEqual(Engine.resolveNight({ mafiaVotes: [{ voter: "a", target: "x" }], protect: "x" }), { victims: [], saved: true });
assert.deepEqual(Engine.resolveNight({ mafiaVotes: [{ voter: "a", target: "x" }], protect: null }), { victims: [{ id: "x", by: "mafia" }], saved: false });
// Hendlbrater: second victim, same target only once, Sanitäter stops the grill too, skip does nothing
assert.deepEqual(Engine.resolveNight({ mafiaVotes: [{ voter: "a", target: "x" }], roast: "y" }).victims.map(v => v.by), ["mafia", "brater"]);
assert.equal(Engine.resolveNight({ mafiaVotes: [{ voter: "a", target: "x" }], roast: "x" }).victims.length, 1);
assert.deepEqual(Engine.resolveNight({ mafiaVotes: [{ voter: "a", target: "x" }], roast: "y", protect: "y" }), { victims: [{ id: "x", by: "mafia" }], saved: true });
assert.equal(Engine.resolveNight({ mafiaVotes: [], roast: "skip" }).victims.length, 0);
// role build with the new optional roles
assert.deepEqual(Engine.buildRoles(8, { mafia: 2, ordner: true, sani: true, bedienung: true, brater: true }).sort(), ["bedienung", "brater", "gast", "gast", "mafia", "mafia", "ordner", "sani"]);
assert.ok(Engine.validate(5, { mafia: 1, ordner: true, sani: true, gaudi: true, bedienung: true, brater: true }));
// events: never repeat the previous one
for (let i = 0; i < 200; i++) { const e = Engine.pickEvent("regen"); assert.notEqual(e, "regen"); }
assert.equal(Engine.tally({ a: "x", b: "x", c: "y" }).result, "x");
assert.equal(Engine.tally({ a: "x", b: "y" }).result, null);
assert.equal(Engine.tally({ a: "skip", b: "skip", c: "y" }).result, null);
assert.equal(Engine.tally({}).result, null);
let p = P(["mafia", "gast", "gast", "gast", "ordner"]); assert.equal(Engine.winner(p), null);
p[1].alive = p[2].alive = p[3].alive = false; assert.equal(Engine.winner(p), "mafia");
p = P(["mafia", "gast", "gast"]); p[0].alive = false; assert.equal(Engine.winner(p), "guests");
p = P(["mafia", "gaudi", "gast", "gast", "gast"]); p[1].alive = false; assert.equal(Engine.winner(p, "p1"), "gaudi");
p = P(["mafia", "mafia", "sani", "gast", "gast"]);
let t = Engine.nightTask(p[0], p, {}); assert.equal(t.kind, "mafia"); assert.ok(t.disabled.p1); assert.ok(!t.options.includes("p0"));
assert.ok(!Engine.isValidNightTarget(p[0], p, {}, "p1")); assert.ok(Engine.isValidNightTarget(p[0], p, {}, "p2"));
assert.ok(!Engine.isValidNightTarget(p[0], p, {}, "skip"));
t = Engine.nightTask(p[2], p, { lastProtect: "p3" }); assert.ok(t.options.includes("p2")); assert.ok(!Engine.isValidNightTarget(p[2], p, { lastProtect: "p3" }, "p3"));
assert.equal(Engine.nightTask(p[3], p, {}).kind, "cover");
const q = P(["mafia", "brater", "bedienung", "gast", "gast"]);
assert.equal(Engine.nightTask(q[1], q, {}).kind, "brater"); assert.ok(Engine.isValidNightTarget(q[1], q, {}, "skip"));
assert.equal(Engine.nightTask(q[1], q, { braterUsed: true }).kind, "cover");
assert.ok(!Engine.isValidNightTarget(q[2], q, { lastServed: "p3" }, "p3")); assert.ok(Engine.isValidNightTarget(q[2], q, { lastServed: "p3" }, "p4"));
assert.equal(Engine.uniqueName("Sepp", ["sepp"]), "Sepp 2"); assert.equal(Engine.normalizeCode("ab-c1d"), "ABCD");
// personal dares only when that person plays, is alive and is not the taker
{
  const { DARES, dareFits, dareText } = await import("../js/engine.js");
  const mike = DARES.find(d => d.needs === "Mike");
  const ps = [{ id: "1", name: "Mike", alive: true }, { id: "2", name: "Anna", alive: true }];
  assert.ok(dareFits(mike, ps[1], ps)); assert.ok(!dareFits(mike, ps[0], ps));
  assert.ok(!dareFits(mike, ps[1], [{ id: "1", name: "Mike", alive: false }, ps[1]]));
  assert.ok(!dareFits(mike, ps[1], [ps[1]]));
  assert.ok(dareFits(mike, ps[1], [{ id: "1", name: "mike 2", alive: true }, ps[1]]));
  assert.ok(DARES.every(d => dareText(d).length > 5)); assert.equal(new Set(DARES.map(dareText)).size, DARES.length);
}
console.log("engine: all tests passed");
