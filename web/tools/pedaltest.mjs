import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

// Fake pedal set: axes [steering, throttle(rest -1), clutch(rest +1)], 4 buttons.
await page.evaluateOnNewDocument(() => {
  window.__pad = {
    id: 'Fake Racing Pedals v1', index: 0, connected: true, mapping: '',
    axes: [0, -1, 1],
    buttons: [0, 0, 0, 0].map(() => ({ pressed: false, touched: false, value: 0 })),
    timestamp: 0,
  };
  navigator.getGamepads = () => [window.__pad];
});

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle2' });
await page.click('#start-button');
await new Promise((r) => setTimeout(r, 1000));

// --- Bind everything through the dialog ---
await page.click('#pedals-setup');
await new Promise((r) => setTimeout(r, 200));

const bind = async (target, action) => {
  await page.click(`[data-bind="${target}"]`);
  await new Promise((r) => setTimeout(r, 150));
  await page.evaluate(action);
  await new Promise((r) => setTimeout(r, 250));
  return page.evaluate((t) => document.getElementById(`pedal-bind-label-${t}`)?.textContent, target);
};

const throttleLabel = await bind('throttle', () => { window.__pad.axes[1] = 0.2; });
await page.evaluate(() => { window.__pad.axes[1] = -1; });
const clutchLabel = await bind('clutch', () => { window.__pad.axes[2] = -0.1; });
await page.evaluate(() => { window.__pad.axes[2] = 1; });
const upLabel = await bind('gearUp', () => { window.__pad.buttons[2].pressed = true; });
await page.evaluate(() => { window.__pad.buttons[2].pressed = false; });
const downLabel = await bind('gearDown', () => { window.__pad.buttons[3].pressed = true; });
await page.evaluate(() => { window.__pad.buttons[3].pressed = false; });

const devices = await page.evaluate(() => document.getElementById('pedals-devices')?.textContent);
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 200));

// --- Start the engine and drive on the pedals ---
await page.evaluate(() => document.getElementById('toggle-ignition').click());
await page.keyboard.down('s');
await new Promise((r) => setTimeout(r, 5000));
await page.keyboard.up('s');
await new Promise((r) => setTimeout(r, 2000));
const idleRpm = await page.evaluate(() => document.getElementById('r-rpm')?.textContent);

// Full throttle via the fake pedal (axis to +1, past captured 0.2 - tests widening).
await page.evaluate(() => { window.__pad.axes[1] = 1; });
await new Promise((r) => setTimeout(r, 3500));
const wotRpm = await page.evaluate(() => document.getElementById('r-rpm')?.textContent);
const throttleBar = await page.evaluate(() => document.getElementById('bar-throttle')?.style.height);
const throttlePct = await page.evaluate(() => document.getElementById('bar-throttle-pct')?.textContent);

// Clutch pedal in (axis 2 toward -1), shift up twice with the paddle.
await page.evaluate(() => { window.__pad.axes[1] = -1; window.__pad.axes[2] = -1; });
await new Promise((r) => setTimeout(r, 500));
const clutchBar = await page.evaluate(() => document.getElementById('bar-clutch')?.style.height);
const tap = async (b) => {
  await page.evaluate((i) => { window.__pad.buttons[i].pressed = true; }, b);
  await new Promise((r) => setTimeout(r, 150));
  await page.evaluate((i) => { window.__pad.buttons[i].pressed = false; }, b);
  await new Promise((r) => setTimeout(r, 150));
};
await tap(2); await tap(2);
const gearAfterUp = await page.evaluate(() => document.getElementById('gear-display')?.textContent);
await tap(3);
const gearAfterDown = await page.evaluate(() => document.getElementById('gear-display')?.textContent);
// Clutch back out.
await page.evaluate(() => { window.__pad.axes[2] = 1; });
await new Promise((r) => setTimeout(r, 800));
const drops = await page.evaluate(() => document.getElementById('d-drops')?.textContent);

console.log(JSON.stringify({
  throttleLabel, clutchLabel, upLabel, downLabel, devices,
  idleRpm, wotRpm, throttleBar, throttlePct, clutchBar,
  gearAfterUp, gearAfterDown, drops, logs,
}, null, 2));
await page.screenshot({ path: process.argv[2] });
await browser.close();
