// Dev-only проверка маркетинговой страницы «Трафарета».
// Запуск: node scripts/marketing-site-check.mjs
// Статика обслуживается собственным loopback-сервером (node:http, без новых deps).
// Скриншоты и JSON receipt сохраняются в /mnt/agents/private/trafaret-site-checks.
// Любой FAIL -> exit 1.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SITE_DIR = "/mnt/agents/output/trafaret-site";
const OUT_DIR = "/mnt/agents/private/trafaret-site-checks";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

/* ---------- loopback static server ---------- */
const server = createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  const filePath = path.normalize(path.join(SITE_DIR, urlPath === "/" ? "index.html" : urlPath));
  if (!filePath.startsWith(SITE_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  readFile(filePath)
    .then((data) => {
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    })
    .catch(() => {
      res.writeHead(404).end("not found");
    });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const EXPECTED_CTA = {
  "cta-windows": "https://github.com/VolkoHvat/trafaret/releases/download/v1.0/Trafaret-Windows-x64.exe",
  "cta-android": "https://github.com/VolkoHvat/trafaret/releases/download/v1.0/Trafaret-Android.apk",
};

async function settlePage(page) {
  // последовательная прокрутка всей страницы вниз (ленивый контент подгружается)
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    const max = document.documentElement.scrollHeight;
    for (let y = 0; y <= max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 25));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  // все main img загружены
  await page.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll("main img")];
      return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    },
    null,
    { timeout: 20000 }
  );
  // содержимое same-origin iframe architecture.html
  await page.waitForFunction(
    () => {
      const frame = document.querySelector('iframe[src*="architecture.html"]');
      if (!frame) return false;
      try {
        const doc = frame.contentDocument;
        return !!doc && !!doc.body && doc.body.innerText.length > 50 && !!doc.querySelector("svg");
      } catch {
        return false;
      }
    },
    null,
    { timeout: 20000 }
  );
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function auditPage(viewport, { reducedMotion = false, label } = {}) {
  const ctx = await browser.newContext({
    viewport,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = []; // сетевая ошибка
  const badResponses = []; // HTTP >= 400 (локальные)
  const localAssets = new Map(); // url -> status

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("requestfailed", (req) => {
    if (req.url().startsWith(BASE)) failedRequests.push(`${req.url()} :: ${req.failure()?.errorText || "failed"}`);
  });
  const externalRequests = []; // внешние http(s) запросы во время прогона
  page.on("request", (req) => {
    const url = req.url();
    if (/^https?:\/\//.test(url) && !url.startsWith(BASE)) externalRequests.push(url);
  });
  page.on("response", (res) => {
    const url = res.url();
    if (!url.startsWith(BASE)) return;
    localAssets.set(url, res.status());
    if (res.status() >= 400) badResponses.push(`${url} :: HTTP ${res.status()}`);
  });

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await settlePage(page);

  // reduced motion: media query и реальное вычисленное поведение скролла
  if (reducedMotion) {
    const rm = await page.evaluate(() => ({
      matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    }));
    check(`${label}: prefers-reduced-motion: reduce активен`, rm.matches === true, `matchMedia=${rm.matches}`);
    check(`${label}: scroll-behavior вычислен в auto`, rm.scrollBehavior === "auto", `scroll-behavior=${rm.scrollBehavior}`);
  }

  // horizontal overflow
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  check(`${label}: нет горизонтального переполнения`,
    dims.scrollWidth <= dims.innerWidth,
    `scrollWidth=${dims.scrollWidth} innerWidth=${dims.innerWidth}`);

  // все локальные ассеты загружены с 200
  const non200 = [...localAssets.entries()].filter(([, s]) => s !== 200);
  check(`${label}: все локальные ресурсы HTTP 200`, non200.length === 0 && localAssets.size > 0,
    `${localAssets.size} ресурсов` + (non200.length ? `; не-200: ${non200.join(", ")}` : ""));

  check(`${label}: нет failed local requests`, failedRequests.length === 0, failedRequests.join(" | "));
  check(`${label}: нет local 4xx/5xx`, badResponses.length === 0, badResponses.join(" | "));
  check(`${label}: ноль console errors`, consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 500));
  check(`${label}: ноль page errors`, pageErrors.length === 0, pageErrors.join(" | ").slice(0, 500));

  // все main img реально загружены (loading=lazy уже догружены прокруткой)
  const mainImgs = await page.evaluate(() =>
    [...document.querySelectorAll("main img")].map((i) => ({
      src: i.getAttribute("src"), complete: i.complete, naturalWidth: i.naturalWidth,
    }))
  );
  const brokenImgs = mainImgs.filter((i) => !i.complete || i.naturalWidth <= 0);
  check(`${label}: все main img загружены`,
    mainImgs.length > 0 && brokenImgs.length === 0,
    `${mainImgs.length} изображений` + (brokenImgs.length ? `; не загружено: ${brokenImgs.map((i) => i.src).join(", ")}` : ""));

  // диаграммы: naturalWidth и ненулевой rendered размер
  const chartImgs = await page.evaluate(() =>
    [...document.querySelectorAll(".chart-figure img")].map((i) => {
      const r = i.getBoundingClientRect();
      return { src: i.getAttribute("src"), naturalWidth: i.naturalWidth, w: r.width, h: r.height };
    })
  );
  const badCharts = chartImgs.filter((i) => i.naturalWidth <= 0 || i.w <= 0 || i.h <= 0);
  check(`${label}: обе chart-figure диаграммы отрисованы`,
    chartImgs.length === 2 && badCharts.length === 0,
    `диаграмм: ${chartImgs.length}` + (badCharts.length ? `; проблемные: ${JSON.stringify(badCharts)}` : ""));

  // iframe архитектуры реально отрисован
  const arch = await page.evaluate(() => {
    const frame = document.querySelector('iframe[src*="architecture.html"]');
    if (!frame) return { found: false };
    const r = frame.getBoundingClientRect();
    let text = 0, hasSvg = false;
    try {
      const doc = frame.contentDocument;
      text = doc?.body?.innerText?.length || 0;
      hasSvg = !!doc?.querySelector("svg");
    } catch { /* cross-origin */ }
    return { found: true, w: r.width, h: r.height, text, hasSvg };
  });
  check(`${label}: iframe архитектуры отрисован`,
    arch.found === true && arch.w > 0 && arch.h > 0 && arch.text > 50 && arch.hasSvg === true,
    JSON.stringify(arch));

  check(`${label}: ноль внешних http(s) запросов`, externalRequests.length === 0,
    externalRequests.slice(0, 5).join(" | ") + (externalRequests.length > 5 ? ` … +${externalRequests.length - 5}` : ""));

  const shotPath = path.join(OUT_DIR, `${label}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });

  await ctx.close();
  return { consoleErrors, pageErrors, failedRequests, badResponses, localAssets, shotPath };
}

try {
  /* ---------- 1. Вьюпорты ---------- */
  const viewports = [
    { width: 375, height: 812, label: "375x812" },
    { width: 768, height: 1024, label: "768x1024" },
    { width: 1024, height: 768, label: "1024x768" },
    { width: 1440, height: 900, label: "1440x900" },
  ];
  for (const vp of viewports) {
    await auditPage({ width: vp.width, height: vp.height }, { label: vp.label });
  }

  /* ---------- 2. Reduced motion ---------- */
  await auditPage({ width: 1440, height: 900 }, { reducedMotion: true, label: "1440x900-reduced-motion" });

  /* ---------- 3. CTA href (точное совпадение) ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    for (const [id, expected] of Object.entries(EXPECTED_CTA)) {
      const href = await page.evaluate((elId) => document.getElementById(elId)?.getAttribute("href"), id);
      check(`CTA ${id}: exact href`, href === expected, `получено: ${String(href)}`);
    }
    // все кнопки имеют текст/aria и не пустые
    const emptyButtons = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label")).length
    );
    check("Все кнопки имеют доступное имя", emptyButtons === 0, `пустых: ${emptyButtons}`);
    // все изображения имеют alt
    const noAlt = await page.evaluate(() =>
      [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length
    );
    check("Все img имеют alt", noAlt === 0, `без alt: ${noAlt}`);
    await ctx.close();
  }

  /* ---------- 4. Галерея ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });

    const trigger = page.locator(".rail-open");
    await trigger.focus();
    await trigger.click();
    const dialog = page.locator("#gallery");
    check("Gallery: dialog открыт", await dialog.evaluate((d) => d.open === true));

    const counter0 = await page.locator("#gallery-counter").textContent();
    check("Gallery: стартовый счётчик 1 / 5", (counter0 || "").trim() === "1 / 5", counter0);

    const alt0 = await page.locator("#gallery-img").getAttribute("alt");
    check("Gallery: alt главного изображения непустой", !!alt0 && alt0.length > 10);

    // next -> 2 / 5
    await page.locator("[data-gallery-next]").click();
    const counter1 = (await page.locator("#gallery-counter").textContent()).trim();
    check("Gallery: next -> 2 / 5", counter1 === "2 / 5", counter1);

    // next -> 3 / 5, prev -> 2 / 5
    await page.locator("[data-gallery-next]").click();
    await page.locator("[data-gallery-prev]").click();
    const counter2 = (await page.locator("#gallery-counter").textContent()).trim();
    check("Gallery: next+prev -> 2 / 5", counter2 === "2 / 5", counter2);

    // стрелки клавиатуры
    await page.keyboard.press("ArrowRight");
    const counter3 = (await page.locator("#gallery-counter").textContent()).trim();
    check("Gallery: ArrowRight -> 3 / 5", counter3 === "3 / 5", counter3);

    // миниатюра -> 5
    await page.locator("#gallery-thumbs button").nth(4).click();
    const counter4 = (await page.locator("#gallery-counter").textContent()).trim();
    check("Gallery: thumbnail -> 5 / 5", counter4 === "5 / 5", counter4);

    // кольцевая навигация: next после 5 -> 1
    await page.locator("[data-gallery-next]").click();
    const counter5 = (await page.locator("#gallery-counter").textContent()).trim();
    check("Gallery: wrap-around 5 -> 1 / 5", counter5 === "1 / 5", counter5);

    // Escape закрывает и возвращает фокус
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    check("Gallery: Escape закрывает dialog", await dialog.evaluate((d) => d.open === false));
    const focusedTag = await page.evaluate(() => document.activeElement?.classList?.contains("rail-open"));
    check("Gallery: фокус возвращён на триггер", focusedTag === true,
      `activeElement=${await page.evaluate(() => document.activeElement?.tagName + "." + (document.activeElement?.className || ""))}`);

    // повторное открытие со скриншота и закрытие кнопкой
    const shotBtn = page.locator(".shot-figure [data-gallery-open]").first();
    await shotBtn.click();
    check("Gallery: открытие из секции скриншота", await dialog.evaluate((d) => d.open === true));
    const counterShot = (await page.locator("#gallery-counter").textContent()).trim();
    check("Gallery: индекс из data-gallery-open=1 -> 2 / 5", counterShot === "2 / 5", counterShot);

    // #gallery-img реально загружен, пока dialog открыт
    await page.waitForFunction(() => {
      const img = document.getElementById("gallery-img");
      return !!img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 10000 });
    check("Gallery: #gallery-img загружен", true);

    // видимая геометрия dialog в пределах viewport
    const dlgBox = await dialog.evaluate((d) => {
      const r = d.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom,
               w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
    });
    const dlgVisible = dlgBox.w > 0 && dlgBox.h > 0 &&
      dlgBox.top >= 0 && dlgBox.left >= 0 &&
      dlgBox.right <= dlgBox.vw && dlgBox.bottom <= dlgBox.vh;
    check("Gallery: dialog видим и в пределах viewport", dlgVisible, JSON.stringify(dlgBox));

    await page.screenshot({ path: path.join(OUT_DIR, "gallery-open.png") });

    await page.locator("[data-gallery-close]").click();
    await page.waitForTimeout(100);
    check("Gallery: кнопка Close закрывает dialog", await dialog.evaluate((d) => d.open === false));

    check("Gallery: ноль ошибок за сценарий", errors.length === 0, errors.join(" | ").slice(0, 500));
    await ctx.close();
  }

  /* ---------- 5. iframe архитектуры ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const frameErrors = [];
    page.on("pageerror", (e) => frameErrors.push(String(e)));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const frame = page.frames().find((f) => f.url().includes("architecture.html"));
    check("Architecture: iframe загружен", !!frame, frame ? frame.url() : "frame не найден");
    if (frame) {
      const bodyText = await frame.evaluate(() => document.body?.innerText?.length || 0);
      check("Architecture: контент схемы отрисован", bodyText > 50, `innerText=${bodyText} символов`);
    }
    check("Architecture: ноль page errors", frameErrors.length === 0, frameErrors.join(" | ").slice(0, 500));
    await ctx.close();
  }

  /* ---------- Receipt ---------- */
  const failed = results.filter((r) => !r.ok);
  const receipt = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    siteDir: SITE_DIR,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    checks: results,
  };
  const receiptPath = path.join(OUT_DIR, `receipt-${stamp}.json`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(`\nReceipt: ${receiptPath}`);
  console.log(`${receipt.passed}/${receipt.total} проверок пройдено`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
