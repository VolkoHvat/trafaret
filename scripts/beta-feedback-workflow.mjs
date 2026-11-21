import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'
import yauzl from 'yauzl'

async function unzip(bytes) {
  const archive = await new Promise((ok, fail) => yauzl.fromBuffer(bytes, { lazyEntries: true }, (e, z) => e ? fail(e) : ok(z)))
  const files = {}
  return new Promise((ok, fail) => {
    archive.on('error', fail).on('end', () => ok(files)).on('entry', entry => archive.openReadStream(entry, async (err, stream) => {
      try {
        if (err) throw err
        const parts = []; for await (const part of stream) parts.push(part)
        files[entry.fileName] = Buffer.concat(parts); archive.readEntry()
      } catch (e) { fail(e) }
    })); archive.readEntry()
  })
}
const server = await preview({ configFile: false, build: { outDir: process.argv[2] || '.tools/beta-feedback-build' }, preview: { host: '127.0.0.1', port: 0 } })
let browser
try {
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], executablePath: process.env.CHROME_PATH || chromium.executablePath() })
  const page = await browser.newPage({ serviceWorkers: 'block' })
  await page.addInitScript(() => {
    window.requests = []; window.tracks = []; window.chunks = []
    const Recorder = window.MediaRecorder
    window.MediaRecorder = class extends Recorder { constructor(...args) { super(...args); this.addEventListener('dataavailable', e => window.chunks.push([e.data.type, e.data.size])) } }
    const synthetic = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    for (const method of ['getUserMedia', 'getDisplayMedia']) Object.defineProperty(navigator.mediaDevices, method, { value: async () => {
      window.requests.push(method)
      if (!window.allowSynthetic) throw new DOMException('denied', 'NotAllowedError')
      let stream
      if (method === 'getDisplayMedia') {
        const track = new MediaStreamTrackGenerator({ kind: 'video' }), writer = track.writable.getWriter(), canvas = new OffscreenCanvas(160, 90), ctx = canvas.getContext('2d')
        let n = 0
        const timer = setInterval(async () => {
          if (track.readyState === 'ended') return clearInterval(timer)
          ctx.fillStyle = n % 2 ? 'red' : 'blue'; ctx.fillRect(0, 0, 160, 90)
          const frame = new VideoFrame(canvas, { timestamp: ++n * 50000 }); try { await writer.write(frame) } finally { frame.close() }
        }, 50)
        stream = new MediaStream([track])
      } else stream = await synthetic({ audio: true })
      window.tracks.push(...stream.getTracks()); return stream
    } })
  })
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const external = []
  await page.context().route(/^https?:\/\//, route => {
    if (new URL(route.request().url()).origin === origin) return route.continue()
    external.push([route.request().url(), route.request().method(), route.request().postData(), route.request().headers().referer])
    return route.fulfill({ contentType: 'text/html', body: 'Local form stand-in' })
  })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  const button = name => page.getByRole('button', { name, exact: true })
  async function download() {
    const event = page.waitForEvent('download'); await button('Скачать ZIP').click(); const artifact = await event
    assert.equal(artifact.suggestedFilename(), 'trafaret-beta-report.zip')
    const files = await unzip(await readFile(await artifact.path()))
    for (const { name, size, sha256 } of JSON.parse(files['manifest.json']).files) {
      assert.equal(files[name].length, size); assert.equal(createHash('sha256').update(files[name]).digest('hex'), sha256)
    }
    return files
  }
  for (const route of ['/', '/?surface=1']) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}${route}`)
    await button('Создать отчёт').click(); const dialog = page.getByRole('dialog'), text = dialog.getByRole('textbox'), diag = dialog.getByRole('checkbox')
    assert.deepEqual(await page.evaluate(() => window.requests), []); assert.ok(!await diag.isChecked())
    await text.fill('Тест отзыва'); const basic = await download()
    assert.deepEqual(Object.keys(basic).sort(), ['feedback.txt', 'manifest.json']); assert.equal(String(basic['feedback.txt']), 'Тест отзыва')
    for (const label of ['Голос', 'Экран']) { await button(`Записать: ${label}`).click(); await dialog.getByRole('status').filter({ hasText: 'Нет разрешения' }).waitFor() }
    assert.deepEqual(await page.evaluate(() => window.requests), ['getUserMedia', 'getDisplayMedia'])
    // Generate a playable mono PCM fixture, with a filename which must not enter the ZIP.
    const wav = Buffer.alloc(44 + 1600); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40)
    await page.getByLabel('Выбрать файл: Голос').setInputFiles({ name: 'private-name.wav', mimeType: 'audio/wav', buffer: wav }); await text.fill(''); await diag.check()
    await page.waitForFunction(() => document.querySelector('dialog audio')?.readyState >= 1)
    await page.evaluate(() => { window.allowSynthetic = true }); await button('Записать: Экран').click(); await button('Остановить запись').waitFor(); await page.waitForFunction(() => window.chunks.some(([, size]) => size > 0), null, { timeout: 12000 }); await button('Остановить запись').click()
    await page.waitForFunction(() => document.querySelector('dialog video')?.readyState >= 1, null, { timeout: 5000 }).catch(async error => { throw Error(`${error.message}: ${await dialog.getByRole('status').innerText()}; chunks ${JSON.stringify(await page.evaluate(() => window.chunks))}; media error ${await page.evaluate(() => document.querySelector('dialog video')?.error?.message)}`) })
    assert.ok(await page.evaluate(() => window.tracks.length === 1 && window.tracks.every(t => t.readyState === 'ended')))
    const withMedia = await download(); assert.deepEqual(Object.keys(withMedia).sort(), ['diagnostics.json', 'manifest.json', 'screen.webm', 'voice.wav']); assert.deepEqual(withMedia['voice.wav'], wav); assert.deepEqual(Object.keys(JSON.parse(withMedia['diagnostics.json'])).sort(), ['browser', 'input', 'platform'])
    assert.deepEqual(external, []); await text.fill('Тест отзыва & private?')
    await button('Скопировать текст отзыва').click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Тест отзыва & private?')
    const popupEvent = page.context().waitForEvent('page'); await button('Открыть форму GitHub').click(); const popup = await popupEvent
    await popup.waitForLoadState(); assert.deepEqual(external.splice(0), [['https://github.com/VolkoHvat/trafaret/issues/new?template=beta-feedback.yml', 'GET', null, undefined]])
    assert.equal(await popup.evaluate(() => window.opener), null); await popup.close(); await text.fill('')
    console.log(`${route} PASS: explicit text-only copy, exact public form GET without body/referrer/opener (intercepted)`)
    await button('Удалить: Экран').click(); await button('Удалить: Голос').click(); assert.ok(await button('Скачать ZIP').isDisabled()); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await button('Создать отчёт').click(); assert.ok(!await diag.isChecked()); assert.equal(await text.inputValue(), '')
    await page.evaluate(() => { window.MediaRecorder = undefined }); await button('Записать: Голос').click(); await dialog.getByRole('status').filter({ hasText: 'Запись здесь недоступна' }).waitFor(); assert.ok(await page.getByLabel('Выбрать файл: Голос').isEnabled())
    console.log(`${route} PASS: privacy, denial, file fallback, synthetic screen, preview/delete, readable ZIP`)
  }
} finally { await browser?.close(); await server.close() }
