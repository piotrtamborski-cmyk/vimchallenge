/**
 * Lab measurements of the pages and the editor, against the launch plan's targets:
 *
 *   node --disable-warning=ExperimentalWarning packages/loadtest/src/pages.ts --url http://test-box:3100 \
 *     [--task insert-in-a-column] [--runs 3] [--keys 200] [--out pages.json]
 *
 * In Chromium (CHROMIUM_PATH, or the usual paths), in two profiles:
 * - desktop: no throttling;
 * - mobile: a 390 × 844 screen, the CPU four times slower, and a slow 4G network (150 ms round
 *   trip, 1.6 Mbit/s down).
 *
 * Each page loads with an empty cache, `--runs` times. The tool reports the largest contentful paint
 * (target LCP ≤ 2.5 s) and the layout shift (target CLS ≤ 0.1), median and worst of the runs.
 *
 * In a task's editor it then types `--keys` keys, about twelve a second: motions, inserts and deletions. It reads each
 * key's time from the keypress to the next paint from the browser's Event Timing. Targets: 95% of
 * keys within 50 ms; the slowest interaction, a stand-in for INP, ≤ 200 ms. The browser reports only
 * events of 16 ms or more, so the others count as under 16 ms.
 *
 * Real visitors' numbers (the plan's 75th percentile) need field data after launch; this is the lab half.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { percentile } from './stats.ts';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    task: { type: 'string', default: 'insert-in-a-column' },
    runs: { type: 'string', default: '3' },
    keys: { type: 'string', default: '200' },
    out: { type: 'string' },
  },
});
if (!args.url) {
  console.error('usage: pages.ts --url <site> [--task <id>] [--runs 3] [--keys 200] [--out <file>]');
  process.exit(2);
}
const site = new URL(args.url);
const RUNS = Number(args.runs);
const KEYS = Number(args.keys);
const PAGES = ['/', '/lessons', '/tasks', `/tasks/${args.task}`, '/rooms', '/daily', '/leaderboards'];

interface Profile {
  name: 'desktop' | 'mobile';
  viewport: { width: number; height: number };
  cpu: number;
  network?: { latency: number; downloadThroughput: number; uploadThroughput: number };
}
const PROFILES: Profile[] = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, cpu: 1 },
  {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    cpu: 4,
    network: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  },
];

function findChromium(): string {
  const found = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(
    (p) => p && existsSync(p),
  );
  if (!found) throw new Error('no Chromium found; set CHROMIUM_PATH');
  return found;
}

async function context(browser: Browser, profile: Profile): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: profile.viewport, isMobile: profile.name === 'mobile', hasTouch: profile.name === 'mobile' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  if (profile.network) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.network });
  }
  // Collect paints and shifts from the start of the page.
  await page.addInitScript(() => {
    const w = window as unknown as { __vc: { lcp: number; cls: number; events: { name: string; duration: number; id: number; work: number }[] } };
    w.__vc = { lcp: 0, cls: 0, events: [] };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__vc.lcp = Math.max(w.__vc.lcp, e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) w.__vc.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { interactionId: number; processingStart: number; processingEnd: number })[])
        w.__vc.events.push({ name: e.name, duration: e.duration, id: e.interactionId, work: e.processingEnd - e.processingStart });
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  });
  return { ctx, page };
}

const median = (xs: number[]) => percentile([...xs].sort((a, b) => a - b), 0.5);

async function measurePage(browser: Browser, profile: Profile, path: string) {
  const lcp: number[] = [];
  const cls: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const { ctx, page } = await context(browser, profile);
    await page.goto(new URL(path, site).href, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => (window as unknown as { __vc: { lcp: number; cls: number } }).__vc);
    lcp.push(m.lcp);
    cls.push(m.cls);
    await ctx.close();
  }
  return { path, lcp: { median: median(lcp), worst: Math.max(...lcp) }, cls: { median: median(cls), worst: Math.max(...cls) } };
}

/** Normal-mode motions, an insert and a delete with undo, over and over: what practice looks like. */
const PATTERN = ['l', 'h', 'j', 'k', 'w', 'b', 'i', 'a', 'b', 'c', 'Escape', 'x', 'u', '0', '$', 'l'];

async function measureTyping(browser: Browser, profile: Profile) {
  const { ctx, page } = await context(browser, profile);
  await page.goto(new URL(`/tasks/${args.task}`, site).href, { waitUntil: 'load' });
  await page.locator('.cm-content').waitFor();
  // The editor waits for the engine before it takes keys.
  await page.waitForTimeout(1500);
  await page.locator('.cm-line').first().click();
  await page.evaluate(() => ((window as unknown as { __vc: { events: unknown[] } }).__vc.events = []));
  // About twelve keys a second, a fast typist: pressed back to back, keys would queue behind frames.
  for (let i = 0; i < KEYS; i++) {
    await page.keyboard.press(PATTERN[i % PATTERN.length]!, { delay: 10 });
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(500);
  const events = await page.evaluate(
    () => (window as unknown as { __vc: { events: { name: string; duration: number; id: number; work: number }[] } }).__vc.events,
  );
  await ctx.close();
  // One interaction per key: its longest event (keydown, keypress or keyup) counts. `work` is the
  // time in the page's own handlers; the rest is waiting for the browser to start them and to paint.
  const byInteraction = new Map<number, { duration: number; work: number }>();
  for (const e of events) {
    if (e.id <= 0) continue;
    const old = byInteraction.get(e.id) ?? { duration: 0, work: 0 };
    byInteraction.set(e.id, { duration: Math.max(old.duration, e.duration), work: old.work + e.work });
  }
  const slow = [...byInteraction.values()];
  const fill = (xs: number[]) => [...xs, ...Array(Math.max(0, KEYS - xs.length)).fill(0)].sort((a, b) => a - b);
  const all = fill(slow.map((s) => s.duration));
  const work = fill(slow.map((s) => s.work));
  return { keys: KEYS, over16ms: slow.length, p95: percentile(all, 0.95), worst: all.at(-1) ?? 0, workP95: Math.round(percentile(work, 0.95)), workP50: Math.round(percentile(work, 0.5)) };
}

const browser = await chromium.launch({ executablePath: findChromium() });
const results: Record<string, unknown> = { site: site.origin, at: new Date().toISOString(), runs: RUNS };
const verdicts: string[] = [];
try {
  for (const profile of PROFILES) {
    console.log(`\n${profile.name}${profile.cpu > 1 ? `: CPU ÷${profile.cpu}, slow 4G` : ''}`);
    console.log(`${'page'.padEnd(34)} LCP median / worst      CLS median / worst`);
    const pages = [];
    for (const path of PAGES) {
      const m = await measurePage(browser, profile, path);
      pages.push(m);
      console.log(`${path.padEnd(34)} ${(m.lcp.median / 1000).toFixed(2)} s / ${(m.lcp.worst / 1000).toFixed(2)} s        ${m.cls.median.toFixed(3)} / ${m.cls.worst.toFixed(3)}`);
    }
    const typing = await measureTyping(browser, profile);
    console.log(
      `typing ${typing.keys} keys in /tasks/${args.task}: ${typing.over16ms} over 16 ms, p95 ${typing.p95 ? `${typing.p95} ms` : 'under 16 ms'}, slowest ${typing.worst || '<16'} ms; ` +
        `the page's own handlers: median ${typing.workP50} ms, p95 ${typing.workP95} ms`,
    );
    results[profile.name] = { pages, typing };
    const worstLcp = Math.max(...pages.map((p) => p.lcp.worst));
    const worstCls = Math.max(...pages.map((p) => p.cls.worst));
    verdicts.push(
      `${profile.name}: LCP worst ${(worstLcp / 1000).toFixed(2)} s ${worstLcp <= 2500 ? 'met' : 'NOT met'} (≤ 2.5 s); CLS worst ${worstCls.toFixed(3)} ${worstCls <= 0.1 ? 'met' : 'NOT met'} (≤ 0.1); ` +
        `key to paint p95 ${typing.p95 || '<16'} ms ${typing.p95 <= 50 ? 'met' : 'NOT met'} (≤ 50 ms); slowest key ${typing.worst || '<16'} ms ${typing.worst <= 200 ? 'met' : 'NOT met'} (≤ 200 ms)`,
    );
  }
} finally {
  await browser.close();
}
console.log(`\n${verdicts.join('\n')}`);
if (args.out) {
  writeFileSync(args.out, JSON.stringify({ ...results, verdicts }, null, 2) + '\n');
  console.log(`written ${args.out}`);
}
