import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, devices } from 'playwright'
import { preview } from 'vite'

const out = process.argv[2] ?? '.tools/density-hud'
await mkdir(out, { recursive: true })
const server = await preview({ build:{outDir:process.argv[3]??'dist'}, preview: { host: '127.0.0.1', port: 0, open: false } })
let browser
const report = []
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() })
  for (const [width, height] of [[1440,900],[1200,1100],[412,915]]) {
    const mobile = width === 412
    const page = await browser.newPage({ ...(mobile ? devices['Pixel 7'] : {}), viewport: { width, height }, serviceWorkers: 'block' })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?field=2048`)
    await page.getByText('Новый документ', {exact:true}).filter({visible:true}).first().waitFor()
    const status = page.locator('.hud-status [role=status]'); await page.waitForFunction(() => document.querySelector('.hud-status [role=status]')?.textContent === 'Новый документ')
    const canvas = page.getByLabel('Поле плотности',{exact:true}), launch = page.getByRole('button',{name:'Создать отчёт'})
    await page.evaluate(() => document.fonts.ready)
    const box = await canvas.boundingBox(), button = await launch.boundingBox(), stage = await page.locator('.section-surface').boundingBox()
    assert.ok(box.width > 0 && box.height === box.width && button.y >= box.y + box.height)
    // CSS layout may round a centered edge to a fractional device pixel.
    assert.ok(Math.abs(box.x*2+box.width-stage.x*2-stage.width)<1 && Math.abs(box.y*2+box.height-stage.y*2-stage.height)<1)
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight && document.documentElement.scrollWidth === innerWidth && document.querySelector('.density-hud').scrollHeight === document.querySelector('.density-hud').clientHeight))
    const path = join(out, `${width}x${height}.png`); await page.screenshot({ path, scale:'css' })
    if (mobile) await launch.tap(); else { await launch.focus(); await page.keyboard.press('Enter') }
    await page.getByRole('dialog',{name:'Создать отчёт'}).waitFor(); await page.getByRole('button',{name:'Закрыть'}).click()
    if (mobile) await page.getByLabel('Инспектор').selectOption('reference')
    const base64 = await page.evaluate(() => { const c=document.createElement('canvas'); c.width=96; c.height=48; c.getContext('2d').fillRect(12,12,72,20); return c.toDataURL().split(',')[1] })
    const [picker] = await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Импорт PNG/JPEG reference'}).click()]); await picker.setFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')})
    await page.getByAltText('Локальная подложка').waitFor(); assert.deepEqual(await page.getByAltText('Локальная подложка').boundingBox(),box)
    await page.getByRole('button',{name:'Разложить в линворк'}).click(); await page.getByRole('img',{name:'Предпросмотр осей штрихов'}).waitFor()
    assert.deepEqual(await canvas.boundingBox(), box); assert.deepEqual(await launch.boundingBox(), button); assert.ok(await status.isVisible()); assert.deepEqual(errors,[])
    if (mobile) await page.getByLabel('Инспектор').selectOption('diagnostic')
    await page.getByLabel('Записывать последний жест').check(); await canvas.click()
    await page.getByRole('button',{name:'Выбрать срез'}).click()
    const overlay = page.getByLabel('Выбор отрезка среза'); await overlay.waitFor()
    assert.deepEqual(await overlay.boundingBox(),await canvas.boundingBox()); await overlay.click()
    await page.locator('[data-section-stats]').getByText(/Полное покрытие/).waitFor()
    await page.getByRole('button',{name:'Вернуться к рисованию'}).click(); assert.deepEqual(errors,[])
    report.push({viewport:[width,height],mobile,canvas:box,reportButton:button,path}); await page.close()
  }
  await writeFile(join(out,'report.json'),JSON.stringify({chromium:browser.version(),report},null,2)); console.log('Density HUD PASS',report)
} finally { try { await browser?.close() } finally { await server.close() } }
