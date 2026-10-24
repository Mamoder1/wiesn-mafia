// Player closes the app mid-night and reopens it; host reloads mid-day. Game must continue.
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8765/index.html"; const N = 6; const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const errs = []; const pages = [];
  const open = async i => { const p = await ctx.newPage(); p.on("pageerror", e => errs.push(`p${i}: ${e.message}`)); return p; };
  for (let i = 0; i < N; i++) pages.push(await open(i));
  const H = pages[0]; await H.goto(BASE + "?bus=local&ns=1"); await H.fill("#nameIn", "Anna"); await H.dispatchEvent("#nameIn", "input"); await H.click("[data-a=create]");
  await H.waitForSelector(".code"); const code = (await H.textContent(".code")).trim();
  const nm = ["Anna", "Ben", "Cem", "Dora", "Emil", "Fritz"];
  for (let i = 1; i < N; i++) { const p = pages[i]; await p.goto(`${BASE}?bus=local&ns=${i + 1}&r=${code}`); await p.fill("#nameIn", nm[i]); await p.dispatchEvent("#nameIn", "input"); await p.click("#joinForm button[type=submit]"); }
  await H.waitForFunction(() => document.querySelectorAll(".roster li").length === 6);
  await H.click("[data-a=start]"); await sleep(300); for (const p of pages) await p.click("[data-a=ready]"); await sleep(300);
  await H.click(".hostbox .primary"); await sleep(400);
  // Cem closes the app during the night
  await pages[2].close();
  for (const i of [0, 1, 3, 4, 5]) { const p = pages[i]; const o = await p.$$(".grid .opt:not([disabled])"); await o[0].click(); await p.click("[data-a=night]"); await sleep(80); }
  await sleep(300);
  const waiting = await H.evaluate(() => document.body.innerText.match(/(\d) \/ (\d)/)?.[0]);
  // Cem opens the app again (plain URL, no room code)
  pages[2] = await open(2); await pages[2].goto(`${BASE}?bus=local&ns=3`); await sleep(800);
  const cemSees = await pages[2].evaluate(() => document.querySelector(".q")?.innerText || document.querySelector(".big")?.innerText);
  const o = await pages[2].$$(".grid .opt:not([disabled])"); await o[0].click(); await pages[2].click("[data-a=night]"); await sleep(500);
  const morning = await H.evaluate(() => /Morgenmeldung/i.test(document.body.innerText));
  // host reloads during the morning
  await H.reload(); await sleep(1000);
  const hostBack = await H.evaluate(() => /Morgenmeldung/i.test(document.body.innerText) && !!document.querySelector(".hostbox .primary"));
  await H.click(".hostbox .primary"); await sleep(400);
  const allDay = await Promise.all(pages.map(p => p.evaluate(() => /Diskussion/i.test(document.body.innerText))));
  console.log(JSON.stringify({ waitingWhileCemAway: waiting, cemSeesAfterReopen: cemSees, nightResolvedAfterCem: morning, hostRestoredAfterReload: hostBack, everyoneInDayPhase: allDay.every(Boolean), errs }, null, 1));
  await b.close();
})();
