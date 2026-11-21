import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { preview } from 'vite'

const [outDir, evidence] = process.argv.slice(2)
assert.ok(outDir && evidence, 'Pass production build and screenshot directories')
await mkdir(evidence, { recursive: true })
const server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  browser = await chromium.launch({ channel: 'msedge' })
  const p = await browser.newPage({ hasTouch: true, serviceWorkers: 'block' })
  const errors = [], rows = []
  p.on('pageerror', e => errors.push(e.message))
  const url = `http://127.0.0.1:${server.httpServer.address().port}/?field=2048`
  assert.equal(await (await fetch(url)).text(), await readFile(join(outDir, 'index.html'), 'utf8'))
  const button = name => p.getByRole('button', { name, exact: true })
  await p.setViewportSize({ width: 1440, height: 900 }); await p.goto(url)
  const origin = await p.evaluate(() => performance.timeOrigin)
  const launch = button('Создать отчёт'), canvas = p.getByLabel('Поле плотности', { exact: true })
  await p.getByText('Новый документ', { exact: true }).filter({ visible: true }).first().waitFor()
  const pixels = () => canvas.evaluate(async c => [...new Uint8Array(await crypto.subtle.digest('SHA-256', c.getContext('2d').getImageData(0, 0, c.width, c.height).data))].join(','))
  await button('3D-поверхность').click(); await button('Мерки').click(); await button('Женская').click(); await button('Вернуться в поле').click()
  const empty = await pixels(), b = await canvas.boundingBox()
  await p.mouse.move(b.x+b.width*.4,b.y+b.height*.4); await p.mouse.down(); await p.mouse.move(b.x+b.width*.55,b.y+b.height*.55,{steps:10}); await p.mouse.up()
  await p.getByText('Сохранено локально',{exact:true}).filter({visible:true}).first().waitFor()
  const marked = await pixels(); assert.notEqual(marked,empty)
  async function documentHash() {
    const [dl] = await Promise.all([p.waitForEvent('download'),button('Сохранить документ').click()]); return createHash('sha256').update(await readFile(await dl.path())).digest('hex')
  }
  const hash = await documentHash()
  async function measure(name,selectors) {
    const data = await p.evaluate(ss => Object.fromEntries(ss.map(s => {
      const el=document.querySelector(s), r=el.getBoundingClientRect(); return [s,{x:r.x,y:r.y,w:r.width,h:r.height,overflow:el.scrollWidth-el.clientWidth}]
    })),selectors)
    const control = p.locator(name.startsWith('report') ? '.beta-actions button:last-child' : '.beta-launch')
    const contrast = await control.evaluate(el => {
      const lum = rgb => rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(x => x/255).map(x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0)
      const css=getComputedStyle(el), values=[lum(css.color),lum(css.backgroundColor)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05)
    }); assert.ok(contrast>=4.5); assert.ok((await control.boundingBox()).height>=44); rows.push({name,contrast})
    console.log(name,data); rows.push({name,data}); await p.screenshot({path:join(evidence,`${name}.png`)})
    for(const [s,r] of Object.entries(data)) {assert.ok(r.w>0 && r.h>0 && r.x>=-1 && r.y>=-1 && r.x+r.w<=p.viewportSize().width+1 && r.y+r.h<=p.viewportSize().height+1,s);assert.ok(r.overflow<=1,`${s} overflows ${r.overflow}px`)}
  }
  for (const [label,width,height] of [['wide',1440,900],['narrow',390,670],['low',690,390],['return',1440,900]]) {
    await p.setViewportSize({width,height}); await p.evaluate(()=>document.fonts.ready)
    if(width<901)await p.locator('.hud-switch select').selectOption('document')
    await measure(`field-${label}`,['.hud-sheet','.hud-aux','.hud-status','.beta-launch']); assert.equal(await pixels(),marked)
    await button('3D-поверхность').click(); await button('Мерки').click(); await button('Женская').waitFor()
    assert.equal(await button('Женская').getAttribute('aria-pressed'),'true')
    const swatch=p.locator('.surface-toolbar input[type=color]').first(); const sw=await swatch.boundingBox(); assert.ok(sw.width>=44 && sw.height>=44); assert.ok(await swatch.evaluate(e=>parseFloat(getComputedStyle(e.parentElement).fontSize)>=11))
    await measure(`surface-${label}`,['.surface-toolbar','.surface-views','.surface-settings','.surface-panel','.beta-launch'])
    await launch.focus(); await p.keyboard.press('Enter'); const dialog=p.getByRole('dialog',{name:'Создать отчёт'}); await dialog.waitFor(); await dialog.getByRole('textbox').fill('HUD'); await p.keyboard.press('Tab'); assert.ok(await dialog.evaluate(e=>e.contains(document.activeElement)))
    await measure(`report-${label}`,['.beta-dialog','.beta-actions']); await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.matches('.beta-launch'),null,{timeout:2000}); await button('Вернуться в поле').click()
  }
  assert.equal(await documentHash(),hash); assert.equal(await pixels(),marked); assert.equal(await p.evaluate(()=>performance.timeOrigin),origin); assert.deepEqual(errors,[])
  await writeFile(join(evidence,'metrics.json'),JSON.stringify({browser:browser.version(),hash,rows},null,2));console.log('PASS',hash)
} finally {try{await browser?.close()}finally{await server.close()}}
