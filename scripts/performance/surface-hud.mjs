import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

const outDir = process.argv[2] || 'dist'
const screenshots = process.argv[3] || '.tools/surface-hud'
await mkdir(screenshots, { recursive: true })
const server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() })
try {
  for (const [name,width,height] of [['desktop',1366,768],['android',360,800]]) {
    const page = await browser.newPage({viewport:{width,height},hasTouch:name==='android',serviceWorkers:'block'})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?surface=1`)
    const hud = page.locator('.surface-workspace'), inspector = hud.getByRole('complementary'), button = (root,text)=>root.getByRole('button',{name:text,exact:true})
    await hud.getByLabel('3D-модель тела').waitFor()
    for(const group of ['Документ','Цвет','Режим','Кисть','Зона','Камера','Мерки','Файл']) {
      await button(inspector.getByRole('navigation'),group).click()
      await inspector.getByRole('group',{name:group,exact:true}).waitFor()
      assert.equal(await button(inspector.getByRole('navigation'),group).getAttribute('aria-pressed'),'true')
      assert.ok(await inspector.getByRole('group',{name:group,exact:true}).isVisible())
    }
    await button(hud,'2D развёртка').click(); assert.ok(await hud.getByLabel('Развёртка поля').isVisible())
    await button(hud,'Рядом').click(); assert.ok(await hud.getByLabel('3D-модель тела').isVisible())
    await button(inspector,'Камера').click()
    const bounds = await hud.evaluate(el=>Object.fromEntries(['header','.surface-toolbar','.surface-views','.surface-panel','.surface-status'].map(s=>{const {x,y,width,height}=el.querySelector(s).getBoundingClientRect();return [s,{x,y,width,height}]})))
    for(const box of Object.values(bounds)) { assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=width+1 && box.y+box.height<=height+1,JSON.stringify(bounds)); }
    assert.ok(bounds['.surface-views'].height>=200)
    assert.ok(await hud.evaluate(el=>el.scrollHeight===el.clientHeight && el.scrollWidth===el.clientWidth))
    const report=button(page,'Создать отчёт'); await report.click(); assert.ok(await page.getByRole('dialog').isVisible()); await page.keyboard.press('Escape')
    await button(hud,'3D фигура').click(); await button(inspector,'Документ').click(); await page.screenshot({path:`${screenshots}/${name}.png`});console.log(name,bounds); await page.close()
  }
} finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve))}
