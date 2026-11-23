import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { preview } from 'vite'
import { chromium } from 'playwright'

const dir = '.tools/composition-qa', outDir = process.argv[2] || 'dist'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
await mkdir(dir, {recursive:true})
const server = await preview({build:{outDir},preview:{host:'127.0.0.1',port:0,open:false}})
let browser
try {
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'})
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  assert.equal(await (await fetch(url)).text(), await readFile(resolve(outDir,'index.html'),'utf8'))
  for (const [study,file,width,height] of [['back','back/v2/wyvern.tfd',1440,960],['sleeve','sleeve/v2/stencil-2048.tfd',390,844]]) {
    const page = await browser.newPage({viewport:{width,height}, serviceWorkers:'block'}), errors=[]
    page.on('pageerror', e=>errors.push(e.message))
    const button = name=>page.getByRole('button',{name,exact:true}), label = name=>page.getByLabel(new RegExp(`^${name}(?:\\s|$)`)).filter({visible:true})
    const panel = async name=>{if(await label('Инспектор').isVisible()) await label('Инспектор').selectOption(name)}
    const saved=()=>page.getByText('Сохранено локально',{exact:true}).waitFor()
    const download=async name=>{await panel('document'); const [d]=await Promise.all([page.waitForEvent('download'),button(name).click()]);return hash(await readFile(await d.path()))}
    const doc=()=>download('Сохранить документ'), png=()=>download('Экспорт PNG')
    await page.goto(url+'?field=2048'); const origin=await page.evaluate(()=>performance.timeOrigin)
    await panel('document'); const [chooser]=await Promise.all([page.waitForEvent('filechooser'),button('Импорт поля').click()]);await chooser.setFiles(resolve('artwork-studies',file));await saved()
    await button('Композиция').waitFor()
    await panel('pigment');await label('Режим пигмента').selectOption('line');const original=await doc()
    const field=label('Поле плотности');await field.scrollIntoViewIfNeeded();const b=await field.boundingBox();await page.mouse.move(b.x+b.width*.36,b.y+b.height*.54);await page.mouse.down();await page.mouse.move(b.x+b.width*.56,b.y+b.height*.60,{steps:16});await page.mouse.up();await saved()
    const edited=await doc(), clean=await png();assert.notEqual(edited,original)
    const open=button('Композиция');await open.focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Композиция',exact:true}).waitFor()
    const flat=page.locator('.flat-thumb canvas');const mass=await flat.evaluate(c=>{const t=document.createElement('canvas');t.width=t.height=16;const g=t.getContext('2d');g.drawImage(c,0,0,16,16);return Array.from(g.getImageData(0,0,16,16).data).filter((_,i)=>i%4===0).sort((a,b)=>a-b)})
    assert.ok(mass[230]-mass[25]>15,`insufficient thumbnail contrast ${mass[25]}–${mass[230]}`)
    await label('Область внимания').selectOption('2');await label('Ось').uncheck();await page.screenshot({path:`${dir}/${study}-back.png`,fullPage:true})
    await label('Режим').selectOption('Рукав');await label('Размещение').selectOption('full')
    const frames=()=>page.locator('.wrap-face canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL()))
    const faces=await frames();assert.equal(new Set(faces).size,3);const seams=()=>page.locator('.wrap-face').evaluateAll(fs=>fs.map(f=>f.querySelector('i')?.style.left??null));const first=await seams()
    const offset=page.getByRole('slider',{name:/Смещение шва/});await offset.focus();await page.keyboard.press('End');const moved=await frames();faces.forEach((f,i)=>assert.notEqual(f,moved[i]));assert.notDeepEqual(await seams(),first);await page.screenshot({path:`${dir}/${study}-wrap.png`,fullPage:true})
    await page.keyboard.press('Home');await offset.fill('0');assert.deepEqual(await frames(),faces);assert.deepEqual(await seams(),first)
    await offset.press('Escape');await open.waitFor();assert.ok(await open.evaluate(b=>b===document.activeElement));assert.equal(await page.evaluate(()=>performance.timeOrigin),origin)
    assert.equal(await doc(),edited);assert.equal(await png(),clean);await panel('scene');await button('Шаг назад').click();await saved();assert.equal(await doc(),original);await panel('scene');await button('Шаг вперёд').click();await saved();assert.equal(await doc(),edited);assert.deepEqual(errors,[])
    console.log(`PASS ${study} ${width}x${height}: .tfw ${edited}, PNG ${clean}, thumbnail P10/P90 ${mass[25]}/${mass[230]}`);await page.close()
  }
} finally {try{await browser?.close()}finally{await server.close()}}
