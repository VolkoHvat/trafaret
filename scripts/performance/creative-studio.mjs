import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { preview } from 'vite'

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.tools/ms-playwright')
const { firefox } = await import('playwright')
const root = resolve('.tools/creative-studio'), outDir = resolve(process.argv[2] || join(root, 'build'))
const index = await readFile(join(outDir, 'index.html'), 'utf8')
await mkdir(root, { recursive: true })
const evidence = await mkdtemp(join(root, 'firefox-'))
const server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } })
const url = `http://127.0.0.1:${server.httpServer.address().port}/`
const sum = bytes => createHash('sha256').update(bytes).digest('hex')
const results = { outDir, indexSHA256: sum(index), checks: [], errors: [] }
let browser, page, stage
try {
  assert.equal(await (await fetch(url)).text(), index)
  browser = await firefox.launch({ headless: true }); results.firefox = browser.version()
  for (const [device,width,height] of [['desktop',1440,900],['phone',390,670],['landscape',690,390]]) {
    let context
    try {
    context = await browser.newContext({ viewport: {width,height}, serviceWorkers: 'block', hasTouch: device !== 'desktop' })
    page = await context.newPage(); page.setDefaultTimeout(8000)
    page.on('pageerror', e => results.errors.push(`${device}: ${e.message}`))
    const check = (name, data) => { stage = `${device}: ${name}`; results.checks.push({stage, ...data}) }
    const button = name => page.getByRole('button', {name, exact:true})
    const status = name => page.getByText(name,{exact:true}).filter({visible:true}).and(page.locator(':not(button)')).first().waitFor()
    const field = page.getByLabel('Поле плотности',{exact:true}), report = button('Создать отчёт')
    const shot = name => page.screenshot({path:join(evidence,`${device}-${name}.png`)})
    const pixels = () => field.evaluate(async c => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', c.getContext('2d').getImageData(0,0,c.width,c.height).data)), b=>b.toString(16).padStart(2,'0')).join(''))
    async function visible(locator) {
      const {width,height}=page.viewportSize(), b = await locator.boundingBox(); assert.ok(b && b.width>0 && b.height>0 && b.x>=-1 && b.y>=-1 && b.x+b.width<=width+1 && b.y+b.height<=height+1,`off-screen: ${locator} ${JSON.stringify(b)}`)
      assert.ok(await locator.evaluate(e=>{const b=e.getBoundingClientRect();return e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))}),`covered: ${locator}`); return b
    }
    async function brand(view) {
      await page.evaluate(()=>document.fonts.ready);const heading=page.getByRole('heading',{level:1});const fonts=await heading.evaluate(e=>({family:getComputedStyle(e).fontFamily,loaded:[...document.fonts].some(f=>f.family.includes('Onest')&&f.status==='loaded'),overflow:document.documentElement.scrollWidth-innerWidth}));assert.match(fonts.family,/^"?Onest/);assert.ok(fonts.loaded);assert.ok(fonts.overflow<=1);const logo=await visible(page.getByRole('img',{name:'ТРАФАРЕТ',exact:true}));assert.ok(logo.width>=80 && logo.height>=13);check(view,{fonts,logo})
    }
    async function layout() {
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow')
      const b=await visible(field); assert.ok(Math.min(b.width,b.height)>=Math.min(width,height)*.58,`undersized working canvas: ${JSON.stringify(b)}`)
      const free=await field.evaluate(c=>{const host=c.closest('.workspace-view');if(!host)throw Error('missing workspace viewport');const a=host.getBoundingClientRect(),b=c.getBoundingClientRect();return Math.min(a.width,a.height-host.querySelector('.sheet-bar').getBoundingClientRect().height)-Math.min(b.width,b.height)});assert.ok(free<=48,`unused drawable span ${free}px`)
      const r=await visible(report); assert.ok(r.height>=44 && r.width>=44,'report target below 44px');const contrast=await report.evaluate(e=>{const lum=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);const css=getComputedStyle(e), l=[lum(css.color),lum(css.backgroundColor)].sort((a,b)=>b-a);return(l[0]+.05)/(l[1]+.05)});assert.ok(contrast>=4.5,`report text contrast ${contrast}`); return {...b,free,contrast}
    }
    async function stroke(points) {
      const b=await visible(field), before=await pixels(); const move=([x,y],steps)=>page.mouse.move(b.x+b.width*x/100,b.y+b.height*y/100,{steps})
      await move(points[0],1); await page.mouse.down(); for(const pt of points.slice(1))await move(pt,5); await page.mouse.up(); await status('Сохранено локально'); const after=await pixels();assert.notEqual(after,before,'pointer stroke lost');return after
    }
    async function panel(value) {
      const select=page.getByRole('combobox',{name:/^Инспектор/}); if(await select.isVisible())await select.selectOption(value)
    }
    async function download(name,ext) {
      await panel('document');const [d]=await Promise.all([page.waitForEvent('download',{timeout:15000}),button(name).click()]);assert.ok(d.suggestedFilename().endsWith(ext));return sum(await readFile(await d.path()))
    }
    const exportsOfArt=async()=>({png:await download('Экспорт PNG','.png'),tfw:await download('Сохранить документ','.tfw')})
    stage=`${device}: actual initial canvas`;await page.goto(url+'?field=2048'); await status('Новый документ'); await field.waitFor();await shot('initial'); const initial=await pixels()
    const b=await visible(field);const size=await field.evaluate(c=>[c.width,c.height]);check('initial canvas',{b,size,initial});assert.deepEqual(size,[2048,2048],'the starting page must expose the main studio, not the small demo')
    const outline=[[20,80],[21,67],[29,56],[39,46],[42,39],[31,43],[38,33],[43,17],[48,27],[56,24],[67,15],[62,29],[71,30],[82,33],[71,41],[62,39],[56,43],[48,55],[44,68],[47,77],[56,84],[42,81],[35,75]]
    const marked=await stroke(outline);check('first stroke',{marked});await page.reload();await status('Локальное поле загружено');assert.equal(await pixels(),marked)
    const restoredStroke=await stroke([[52,34],[57,31],[64,32],[58,35]]);check('first stroke after restore',{restoredStroke})
    await panel('pigment');await page.getByLabel(/^Режим пигмента/).selectOption('line');const lineColor=page.getByLabel('Цвет линии',{exact:true});await lineColor.fill('#af2433');
    await stroke([[24,76],[29,66],[36,59],[42,49]]);assert.ok(await field.evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4)if(d[i]>d[i+1]+16 && d[i]>d[i+2]+16)return true;return false}),'chosen scarlet is absent from canvas');await stroke([[32,76],[31,70],[34,64],[40,58]]);const beforeDetail=await pixels(), detail=await stroke([[63,36],[69,37],[75,34]])
    await panel('shelf');await shot('dragon');check('working area',{box:await layout()}); const baseline=await exportsOfArt()
    for (const name of ['Издали','Примерить','На печать']) {
      stage=`${device}: ${name}`;const control=button(name==='Издали'?'Композиция':name);await visible(control);await control.focus();await page.keyboard.press('Enter');
      if(name==='На печать'){const print=button('Печать поля 1:1');await print.waitFor();await visible(print);assert.ok(await print.evaluate(e=>e===document.activeElement));await shot(name)}else{const heading=page.getByRole('heading',{name:name==='Издали'?'Композиция':'Участок тела',exact:true});await visible(heading);assert.ok(await button('Вернуться в поле').evaluate(e=>e===document.activeElement));await shot(name);await page.keyboard.press('Escape');await heading.waitFor({state:'hidden'});await page.waitForFunction(e=>e===document.activeElement,await control.elementHandle())}assert.equal(await pixels(),detail);assert.deepEqual(await exportsOfArt(),baseline);check(name,baseline)
    }
    stage=`${device}: theme`;const theme=page.getByRole('combobox',{name:/^Бумага · вид/}); const current=await theme.inputValue(), next=await theme.locator('option').evaluateAll((os,v)=>os.find(o=>o.value!==v && !o.disabled)?.value,current);assert.ok(next); const chrome=()=>field.evaluate(c=>getComputedStyle(c).filter);const oldChrome=await chrome();await theme.selectOption(next);assert.notEqual(await chrome(),oldChrome);await shot('theme');assert.equal(await pixels(),detail);assert.deepEqual(await exportsOfArt(),baseline);check('theme export isolation',{current,next,...baseline})
    await panel('scene');await button('Шаг назад').click();await status('Сохранено локально');assert.equal(await pixels(),beforeDetail);await button('Шаг вперёд').click();await status('Сохранено локально');assert.equal(await pixels(),detail);check('picture undo and redo')
    await brand('2D');await panel('document');await button('3D-поверхность').click();await page.getByRole('heading',{name:'На теле'}).waitFor();await brand('Surface');await shot('surface');if(device==='desktop'){await page.setViewportSize({width:3440,height:1440});await brand('Surface ultrawide');await shot('ultrawide-surface')}await button('Вернуться в поле').click();assert.equal(await pixels(),detail);if(device==='desktop'){await panel('shelf');await brand('2D ultrawide');await layout();await shot('ultrawide-field');await page.setViewportSize({width,height})}
    stage=`${device}: report`;let reached=false;for(let i=0;i<180;i++){await page.keyboard.press('Tab');if(await report.evaluate(e=>e===document.activeElement)){reached=true;break}}assert.ok(reached,'report absent from Tab order');await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Создать отчёт'});await visible(dialog);await dialog.getByRole('textbox').fill('Проверка эскиза');await visible(dialog.getByRole('button',{name:'Закрыть'}));await shot('report');for(let i=0;i<16;i++){await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(e=>e.contains(document.activeElement)),'focus escaped modal')}await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.matches('.beta-launch'));assert.deepEqual(results.errors,[]);check('report keyboard')
    } catch(e) {
      (results.failures??=[]).push({device,stage,message:e.message});if(page && !page.isClosed()){await page.screenshot({path:join(evidence,`${device}-failure.png`)}).catch(()=>{});await writeFile(join(evidence,`${device}-accessibility.txt`),await page.locator('body').ariaSnapshot().catch(()=>''))}
    } finally {await context?.close()}
  }
  assert.equal(results.failures?.length??0,0,JSON.stringify(results.failures));results.status='PASS'
} catch(e) {
  results.status='FAIL';results.failure={stage,message:e.message};if(page && !page.isClosed()){await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});await writeFile(join(evidence,'accessibility.txt'),await page.locator('body').ariaSnapshot().catch(()=>''))}throw e
} finally {
  try{await writeFile(join(evidence,'results.json'),JSON.stringify(results,null,2));console.log(evidence,results.status)}finally{try{await browser?.close()}finally{await server.close()}}
}
