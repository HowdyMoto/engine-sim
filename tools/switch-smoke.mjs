/*
 * Engine-switch smoke test: cycles the picker through mixed cylinder counts
 * (the crash mode was rendering the new engine's info against the previous
 * engine's state buffer), then cranks the last engine to prove the app is
 * still alive. Usage: node tools/switch-smoke.mjs [screenshot.png]
 */
import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push('[error] ' + m.text()); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2' });
await page.click('#start-button');
await new Promise((r) => setTimeout(r, 1000));

const results = [];
for (const id of ['lfa-v10', 'merlin-v12', 'radial-9', 'kohler-ch750', 'subaru-ej25', 'gm-ls-v8', 'lfa-v10']) {
  await page.select('#engine-select', id);
  await new Promise((r) => setTimeout(r, 1800));
  const name = await page.evaluate(() => document.getElementById('engine-name')?.textContent);
  results.push(`${id} -> ${name}`);
}

// Crank the LFA to prove the app is still alive end to end.
await page.evaluate(() => document.getElementById('toggle-ignition').click());
await page.keyboard.down('s');
await new Promise((r) => setTimeout(r, 6000));
await page.keyboard.up('s');
await new Promise((r) => setTimeout(r, 2500));
const rpm = await page.evaluate(() => document.getElementById('r-rpm')?.textContent);
const drops = await page.evaluate(() => document.getElementById('d-drops')?.textContent);
console.log(JSON.stringify({ results, rpm, drops, logs }, null, 2));
await page.screenshot({ path: process.argv[2] });
await browser.close();
