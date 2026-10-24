// Simulates N phones (one browser context, separate storage namespaces, local bus) playing full games.
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:8765/index.html";
const N = +(process.env.N || 7), GAMES = +(process.env.GAMES || 3);
const names = ["Anna", "Ben", "Cem", "Dora", "Emil", "Fritz", "Gabi", "Hias", "Ida", "Jonas"].slice(0, N);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (let g = 0; g < GAMES; g++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const errs = [], leaks = []; let dareUi = 0, adminConfirms = 0;
    const pages = [];
    for (let i = 0; i < N; i++) { const pg = await ctx.newPage(); pg.on("pageerror", e => errs.push(`p${i}: ${e.message}`)); pages.push(pg); }
    const host = pages[0];
    await host.goto(`${BASE}?bus=local&ns=1`);
    await host.fill("#nameIn", names[0]); await host.dispatchEvent("#nameIn", "input");
    await host.click("[data-a=create]");
    await host.waitForSelector(".code");
    const code = (await host.textContent(".code")).trim();
    for (let i = 1; i < N; i++) {
      const pg = pages[i];
      await pg.goto(`${BASE}?bus=local&ns=${i + 1}&r=${code}`);
      await pg.fill("#nameIn", names[i]); await pg.dispatchEvent("#nameIn", "input");
      await pg.click("#joinForm button[type=submit]");
    }
    await host.waitForFunction(n => document.querySelectorAll(".roster li").length === n, N, { timeout: 10000 });
    if (g === 0) await host.screenshot({ path: "shots/lobby-host.png", fullPage: true });
    if (g === 0) await pages[1].screenshot({ path: "shots/lobby-guest.png", fullPage: true });
    if (process.env.ADMIN) { await host.click("[data-a=hs][data-k=hostPlays]"); await sleep(150); }
    if (process.env.ALL) for (const k of ["gaudi", "bedienung", "brater"]) { await host.click(`[data-a=hs][data-k=${k}]`); await sleep(150); }
    await host.click("[data-a=start]");
    const shot = new Set();
    let winner = null;
    for (let step = 0; step < 300 && !winner; step++) {
      for (let i = 0; i < N; i++) {
        const pg = pages[i];
        const tryClick = async sel => { try { const el = await pg.$(sel); if (el) { await el.click({ timeout: 1500 }); return true; } } catch (e) {} return false; };
        if (await tryClick("[data-a=ready]:not([disabled])")) continue;
        // Bierdiebe: open role panel during the day and work through the dare
        if (await pg.$("[data-a=role]") && !(await pg.$(".mini")) && /Tag \d/.test(await pg.textContent(".brand"))) await tryClick("button.link[data-a=role]");
        if (await tryClick("[data-a=dareSel]")) { if (await tryClick("[data-a=darePick]:not([disabled])")) dareUi++; continue; }
        if (await tryClick("[data-a=dare][data-v=done]")) { dareUi++; continue; }
        for (const act of ["night", "vote"]) {
          if (await pg.$(`[data-a=${act}]`)) {
            const opts = await pg.$$(".grid .opt:not([disabled])");
            if (opts.length) { try { await opts[Math.floor(Math.random() * opts.length)].click({ timeout: 1500 }); await pg.click(`[data-a=${act}]:not([disabled])`, { timeout: 1500 }); } catch (e) {} }
          }
        }
      }
      await sleep(120);
      // privacy guardrail: public retained state must never expose an alive player's role before the end
      const pub = await host.evaluate(c => JSON.parse(JSON.parse(localStorage.getItem("wm-retained") || "{}")[`wm1/${c}/s`] || "null"), code);
      if (pub && pub.phase === "vote" && pub.votes) leaks.push("vote targets public during vote");
      if (pub && pub.phase !== "end") pub.players.forEach(p => { if (p.alive && p.role && !(pub.lynch === p.id)) leaks.push(`${pub.phase}: ${p.name}`); });
      const phase = pub && pub.phase;
      if (g === 0 && phase && !shot.has(phase)) {
        shot.add(phase);
        await pages[2].screenshot({ path: `shots/${String(shot.size).padStart(2, "0")}-${phase}.png`, fullPage: true });
      }
      if (phase === "end") { winner = pub.winner; break; }
      if (process.env.ADMIN) {
        try { if (await host.$("button.btn[data-a=adminToggle]")) await host.click("button.btn[data-a=adminToggle]", { timeout: 1500 }); } catch (e) {}
        try { const c = await host.$("[data-a=adminDare][data-ok='1'].ghost"); if (c) { await c.click({ timeout: 1500 }); adminConfirms++; } } catch (e) {}
        if (g === 0 && phase && !shot.has("admin-" + phase)) { shot.add("admin-" + phase); await host.screenshot({ path: `shots/admin-${phase}.png`, fullPage: true }); }
      }
      const hb = await host.$(".hostbox .primary");
      if (hb) { try { await hb.click({ timeout: 1500 }); } catch (e) {} }
      await sleep(80);
    }
    await sleep(300);
    // every phone must show the end screen
    const ends = await Promise.all(pages.map(pg => pg.evaluate(() => /gewinn/.test(document.body.innerText))));
    const recap = await host.evaluate(() => !!document.querySelector(".recap li"));
    if (!recap) errs.push("no recap on end screen");
    if (g === 0) await pages[3].screenshot({ path: "shots/end.png", fullPage: true });
    const overflow = await Promise.all(pages.map(pg => pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    results.push({ game: g + 1, winner, dareClicks: dareUi, adminConfirms, allPhonesShowEnd: ends.every(Boolean), errors: errs, leaks: [...new Set(leaks)], overflow: overflow.some(Boolean) });
    await ctx.close();
  }
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
  process.exit(results.every(r => r.winner && r.allPhonesShowEnd && !r.errors.length && !r.leaks.length && !r.overflow) ? 0 : 1);
})();
