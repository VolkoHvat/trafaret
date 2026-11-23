import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = {}
for (let index = 2; index < process.argv.length; index += 2) args[process.argv[index].replace(/^--/, '')] = process.argv[index + 1]
const distDir = args.dist || 'dist'
const outJson = args.out || '.tools/void-probe/sandbox-regression.json'
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    const file = path.normalize(path.join(distDir, urlPath))
    if (!file.startsWith(path.normalize(distDir))) { res.writeHead(403); res.end(); return }
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  } catch { res.writeHead(404); res.end('not found') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] })
const report = { scenarios: {}, summary: { pass: 0, fail: 0 } }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const errors = [], external = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', request => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(request.url())
  })
  await page.goto(`http://127.0.0.1:${port}/void-sandbox.html`, { waitUntil: 'load' })
  await page.waitForSelector('#emulate')
  await page.click('#emulate')
  await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout: 60000 })
  const emulation = JSON.parse(await page.locator('#report').textContent())
  const hashes = await page.evaluate(() => {
    const hash = selector => {
      const canvas = document.querySelector(selector)
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let value = 0
      for (let index = 0; index < data.length; index += 17) value = (Math.imul(value, 31) + data[index]) | 0
      return value >>> 0
    }
    return { standard: hash('#standard-canvas'), energy: hash('#energy-canvas') }
  })
  await page.screenshot({ path: '.tools/void-probe/sandbox.png', fullPage: true })
  const emulationPass = emulation.different && emulation.standard.fixedStrength > 0
    && emulation.energy.totalWork > 0 && emulation.energy.minStrength < emulation.energy.maxStrength
    && emulation.energy.source === 'measured-pressure' && emulation.energy.confidence === 'measured'
    && hashes.standard !== hashes.energy && errors.length === 0 && external.length === 0
  report.scenarios.emulation = { status: emulationPass ? 'PASS' : 'FAIL', emulation, hashes, errors, external }
  report.summary[emulationPass ? 'pass' : 'fail']++

  await page.fill('#gain', '0')
  await page.click('#emulate')
  await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout: 60000 })
  const zeroGainReport = JSON.parse(await page.locator('#report').textContent())
  const zeroHashes = await page.evaluate(() => {
    const hash = selector => {
      const canvas = document.querySelector(selector)
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let value = 0
      for (let index = 0; index < data.length; index += 17) value = (Math.imul(value, 31) + data[index]) | 0
      return value >>> 0
    }
    return { standard: hash('#standard-canvas'), energy: hash('#energy-canvas') }
  })
  const zeroGainPass = zeroGainReport.energy.minStrength === zeroGainReport.energy.maxStrength
    && zeroHashes.standard === zeroHashes.energy && errors.length === 0 && external.length === 0
  report.scenarios.zeroGain = { status: zeroGainPass ? 'PASS' : 'FAIL', report: zeroGainReport, hashes: zeroHashes }
  report.summary[zeroGainPass ? 'pass' : 'fail']++

  await page.fill('#gain', '0.1')
  await page.click('#emulate-dynamic')
  await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout: 60000 })
  const dynamicReport = JSON.parse(await page.locator('#report').textContent())
  const dynamicPass = dynamicReport.pattern === 'dynamic' && dynamicReport.different
    && dynamicReport.gain === 1
    && dynamicReport.energy.maxSpeed >= 2000
    && dynamicReport.energy.maxStrength >= dynamicReport.energy.minStrength * 3
    && dynamicReport.standard.sourceCount === dynamicReport.energy.sourceCount
    && errors.length === 0 && external.length === 0
  report.scenarios.dynamic = { status: dynamicPass ? 'PASS' : 'FAIL', report: dynamicReport }
  report.summary[dynamicPass ? 'pass' : 'fail']++
  await page.screenshot({ path: '.tools/void-probe/sandbox-dynamic.png', fullPage: true })
  await page.fill('#gain', '0.1')

  for (const [brush, energyConstant] of Object.entries({ fineline: 1, shader: 1.6, flat: 1.3, pulse: 0.65, recoil: 1.5 })) {
    await page.selectOption('#brush', brush)
    await page.click('#emulate')
    await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout: 60000 })
    const brushReport = JSON.parse(await page.locator('#report').textContent())
    const brushPass = brushReport.standard.energyConstant === energyConstant
      && brushReport.standard.fixedStrength > 0 && brushReport.different
      && brushReport.standard.sourceCount === brushReport.energy.sourceCount
      && errors.length === 0 && external.length === 0
    report.scenarios[`brush-${brush}`] = { status: brushPass ? 'PASS' : 'FAIL', report: brushReport }
    report.summary[brushPass ? 'pass' : 'fail']++
    if (brush === 'flat' || brush === 'recoil') await page.screenshot({ path: `.tools/void-probe/sandbox-brush-${brush}.png`, fullPage: true })
  }
  await page.selectOption('#brush', 'fineline')

  for (const shape of ['circle', 'ellipse', 'line', 'rectangle']) {
    await page.selectOption('#shape', shape)
    await page.click('#emit-shape')
    await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout: 60000 })
    const shapeReport = JSON.parse(await page.locator('#report').textContent())
    const shapePass = shapeReport.shape === shape && shapeReport.different
      && shapeReport.standard.sourceCount > 0
      && shapeReport.standard.sourceCount === shapeReport.energy.sourceCount
      && errors.length === 0 && external.length === 0
    report.scenarios[`shape-${shape}`] = { status: shapePass ? 'PASS' : 'FAIL', report: shapeReport }
    report.summary[shapePass ? 'pass' : 'fail']++
    await page.screenshot({ path: `.tools/void-probe/sandbox-${shape}.png`, fullPage: true })
  }

  await page.selectOption('#brush', 'wyvern')
  await page.click('#emulate-artwork')
  await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout: 120000 })
  const artworkReport = JSON.parse(await page.locator('#report').textContent())
  const artworkPass = artworkReport.pattern === 'wyvern' && artworkReport.different
    && artworkReport.standard.sourceCount > 500
    && artworkReport.standard.sourceCount === artworkReport.energy.sourceCount
    && errors.length === 0 && external.length === 0
  report.scenarios.artwork = { status: artworkPass ? 'PASS' : 'FAIL', report: artworkReport }
  report.summary[artworkPass ? 'pass' : 'fail']++
  await page.screenshot({ path: '.tools/void-probe/sandbox-wyvern.png', fullPage: true })

  await page.selectOption('#brush', 'silentium')
  await page.click('#emulate-silentium')
  await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout: 120000 })
  const silentiumReport = JSON.parse(await page.locator('#report').textContent())
  const silentiumPass = silentiumReport.pattern === 'silentium' && silentiumReport.different
    && silentiumReport.standard.sourceCount > 100
    && silentiumReport.standard.sourceCount === silentiumReport.energy.sourceCount
    && errors.length === 0 && external.length === 0
  report.scenarios.silentium = { status: silentiumPass ? 'PASS' : 'FAIL', report: silentiumReport }
  report.summary[silentiumPass ? 'pass' : 'fail']++
  await page.screenshot({ path: '.tools/void-probe/sandbox-silentium.png', fullPage: true })

  const downloads = {}
  for (const [button, name] of [['#download-wyvern', 'wyvern'], ['#download-silentium', 'silentium']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(button)])
    const target = `.tools/void-probe/${name}-download.svg`
    await download.saveAs(target)
    const content = await readFile(target, 'utf8')
    downloads[name] = { filename: download.suggestedFilename(), valid: content.includes('<svg') && content.includes('path') }
  }
  const downloadsPass = Object.values(downloads).every(item => item.valid) && errors.length === 0 && external.length === 0
  report.scenarios.downloads = { status: downloadsPass ? 'PASS' : 'FAIL', downloads }
  report.summary[downloadsPass ? 'pass' : 'fail']++

  await page.click('#clear')
  const canvas = await page.locator('#energy-canvas').boundingBox()
  await page.mouse.move(canvas.x + 80, canvas.y + 180)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 460, canvas.y + 230, { steps: 24 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const pointer = {
    work: Number(await page.locator('#energy-work').textContent()),
    source: await page.locator('#energy-source').textContent(),
    standardSources: Number(await page.locator('#standard-sources').textContent()),
    energySources: Number(await page.locator('#energy-sources').textContent()),
  }
  const pointerPass = pointer.work > 0 && pointer.source.includes('velocity-only')
    && pointer.standardSources === pointer.energySources && errors.length === 0 && external.length === 0
  report.scenarios.pointer = { status: pointerPass ? 'PASS' : 'FAIL', pointer, errors, external }
  report.summary[pointerPass ? 'pass' : 'fail']++
  await context.close()
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
await mkdir(path.dirname(outJson), { recursive: true })
await writeFile(outJson, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (report.summary.fail) process.exitCode = 1
