import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = process.argv[3] ?? 'shot.png';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--window-size=1440,900',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
page.on('response', (r) => { if (r.status() >= 400) logs.push('[http ' + r.status() + '] ' + r.url()); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url()));

await page.goto(URL_BASE, { waitUntil: 'networkidle2' });

const engineId = process.argv[4];
if (engineId) {
  await page.select('#engine-select', engineId);
}

// Optional theme, e.g. THEME=paper node tools/smoke.mjs ...
if (process.env.THEME) {
  await page.select('#theme-select', process.env.THEME);
}

// Start the simulator, turn on the ignition and crank it.
await page.click('#start-button');
await new Promise((r) => setTimeout(r, 1500));

await page.evaluate(() => {
  document.getElementById('toggle-ignition').click();
});
const crankMs = Number(process.argv[5] ?? 4000);
await page.keyboard.down('s');
await new Promise((r) => setTimeout(r, crankMs));
await page.keyboard.up('s');
await new Promise((r) => setTimeout(r, 2500));

// Hold throttle open with the slider, which must persist without a key held.
await page.evaluate(() => {
  const slider = document.getElementById('throttle');
  slider.value = '0.25';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.blur();
});
await new Promise((r) => setTimeout(r, 3000));

const dropsEarly = await page.evaluate(() => document.getElementById('d-drops')?.textContent);
await new Promise((r) => setTimeout(r, 5000));

const readouts = await page.evaluate(() => {
  const text = (id) => document.getElementById(id)?.textContent ?? '';
  return {
    engine: text('engine-name'),
    rpm: text('r-rpm'),
    throttle: text('r-throttle'),
    manifold: text('r-manifold'),
    afr: text('r-afr'),
    displacement: text('r-displacement'),
    frequency: text('d-frequency'),
    fluid: text('d-fluid'),
    load: text('d-load'),
    gasKernels: text('d-wasm'),
    latency: text('d-latency'),
    steps: text('d-steps'),
    drops: text('d-drops'),
  };
});

console.log(JSON.stringify({ ...readouts, dropsEarly }, null, 2));
console.log('--- console ---');
console.log(logs.slice(0, 40).join('\n'));

await page.screenshot({ path: OUT });
await browser.close();
