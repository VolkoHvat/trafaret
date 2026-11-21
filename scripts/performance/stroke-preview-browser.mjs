import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' })
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
  const canvas = page.locator('canvas').first()
  const box = await canvas.boundingBox()
  const x = box.x + box.width * 0.12, y = box.y + box.height * 0.5
  const snapshot = () => canvas.evaluate(el => el.toDataURL())
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.deepEqual(await canvas.evaluate(el => [el.width, el.height]), [2048, 2048])
  const empty = await snapshot()
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + box.width * .77, y, { steps: 8 })
  await page.mouse.up()
  await settle()
  const blank = await snapshot()
  assert.notEqual(blank, empty, 'first stroke must populate the layer')
  await page.mouse.move(x, y)
  const idleRafMs = await page.evaluate(async () => {
    const intervals = []
    for (let i = 0; i < 17; i++) {
      const start = performance.now()
      await new Promise(resolve => requestAnimationFrame(resolve))
      if (i) intervals.push(performance.now() - start)
    }
    return intervals.sort((a, b) => a - b)[8]
  })
  await page.evaluate(() => {
    const times = {}
    for (const type of ['pointerdown', 'pointerup']) {
      let start
      window.addEventListener(type, () => { start = performance.now() }, { capture: true, once: true })
      window.addEventListener(type, () => { times[type] = performance.now() - start }, { once: true })
    }
    window.probeEventTimes = times
  })
  await page.mouse.down()
  const timing = await canvas.evaluate(async (el, { x, y, w, h }) => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    await frame()
    const times = [], dispatch = [], wait = [], callbacks = [], preview = [], compose = []
    const raf = window.requestAnimationFrame.bind(window)
    const ctx = el.getContext('2d')
    const clear = ctx.clearRect
    let compositionStart
    ctx.clearRect = function (...args) { compositionStart = performance.now(); return clear.apply(this, args) }
    const make = i => new PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 1, buttons: 1, bubbles: true,
      clientX: x + w * .75 * i / 1024, clientY: y + h * .16 * Math.sin(i / 24) })
    for (let batch = 0; batch < 16; batch++) {
      const samples = Array.from({ length: 64 }, (_, j) => make(batch * 64 + j + 1))
      const event = samples.at(-1)
      Object.defineProperty(event, 'getCoalescedEvents', { value: () => samples })
      const start = performance.now()
      window.requestAnimationFrame = fn => raf(t => {
        const entry = performance.now()
        compositionStart = undefined
        fn(t)
        const exit = performance.now()
        callbacks.push(exit - entry)
        wait.push(entry - start)
        if (compositionStart !== undefined) {
          preview.push(compositionStart - entry)
          compose.push(exit - compositionStart)
        }
      })
      el.dispatchEvent(event)
      window.requestAnimationFrame = raf
      dispatch.push(performance.now() - start)
      await frame()
      times.push(performance.now() - start)
    }
    // An empty coalesced list must still draw the native move.
    const before = el.toDataURL()
    const tail = make(1100)
    Object.defineProperty(tail, 'getCoalescedEvents', { value: () => [] })
    el.dispatchEvent(tail)
    await frame()
    times.sort((a, b) => a - b)
    const startRead = performance.now()
    ctx.getImageData(0, 0, el.width, el.height)
    const readbackMs = performance.now() - startRead
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    assertMetrics()
    function assertMetrics() { if (compose.length !== 16) throw new Error(`Expected 16 rendered batches, got ${compose.length}`) }
    ctx.clearRect = clear
    return { readbackMs, handlerMs: median(dispatch), callbackMs: median(callbacks), previewMs: median(preview), composeOverlayMs: median(compose), waitToCallbackMs: median(wait), fallbackVisible: before !== el.toDataURL(), dispatchTotalMs: dispatch.reduce((a, b) => a + b), medianFrameMs: times[8], maxFrameMs: times[15], totalMs: times.reduce((a, b) => a + b) }
  }, { x, y, w: box.width, h: box.height })
  const beforeRelease = await snapshot()
  await page.mouse.up()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const afterRelease = await snapshot()
  const ssStart = performance.now()
  await page.screenshot()
  console.log({ idleRafMs, eventMs: await page.evaluate(() => window.probeEventTimes), chrome: browser.version(), pngHash: createHash('sha256').update(beforeRelease).digest('hex'), screenshotWallMs: performance.now() - ssStart, url: page.url(), asset: await page.locator('script[type=module]').first().getAttribute('src'), ...timing, visible: beforeRelease !== blank, identicalOnRelease: beforeRelease === afterRelease })
  assert.notEqual(beforeRelease, blank)
  await page.mouse.click(x + 30, y + 80)
  await settle()
  assert.notEqual(await snapshot(), afterRelease, 'tap must leave a mark')
  await page.keyboard.press('Control+z')
  await settle()
  assert.ok(await snapshot() === afterRelease, 'undo tap must restore the second stroke')
  assert.equal(timing.fallbackVisible, true)
  assert.ok(beforeRelease === afterRelease, 'visible canvas changed on release')
} finally {
  await browser.close()
}
