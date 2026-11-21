import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

// Pass one production outDir, or baseline + candidate for exact parity checks.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const quantiles = values => {
  values.sort((a,b) => a-b)
  return [.5,.95].map(q => +values[Math.ceil(q*values.length)-1].toFixed(2))
}
async function run(outDir) {
  const server = await preview({ build:{outDir}, preview:{host:'127.0.0.1',port:0,open:false} })
  const page = await browser.newPage({viewport:{width:1150,height:940}, serviceWorkers:'block'})
  try {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?surface=1`)
    const view = page.getByLabel('3D-модель тела',{exact:true}), atlas = page.getByLabel('Развёртка поля',{exact:true})
    const click = name => page.getByRole('button',{name,exact:true}).click()
    const pixels = canvas => canvas.evaluate(el=>el.toDataURL()).then(digest)
    const field = async () => {const dl=page.waitForEvent('download'); await click('Скачать поле .tfd'); return digest(await readFile(await (await dl).path()))}
    await view.scrollIntoViewIfNeeded(); const box=await view.boundingBox(), x=Math.round(box.x+box.width*.5), y=Math.round(box.y+box.height*.48)
    const stroke=async()=>{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+15,y+5,{steps:5});await page.mouse.up()}
    const blank=await pixels(atlas); await stroke();const ink=await pixels(atlas),front=await pixels(view),rho=await field();assert.notEqual(ink,blank)
    await page.evaluate(()=>{
      let sample=null
      window.navSamples=[]
      for(const name of ['input','pointermove']) window.addEventListener(name,()=>{sample={model:0,atlas:0,start:performance.now()};window.navSamples.push(sample)},true)
      const put=CanvasRenderingContext2D.prototype.putImageData
      CanvasRenderingContext2D.prototype.putImageData=function(...args){put.apply(this,args);if(sample) sample[this.canvas.closest('.unwrapped')?'atlas':'model']=performance.now()-sample.start}
    })
    const measure=async(name,exercise)=>{await exercise(8);await page.evaluate(()=>{window.navSamples.length=0});await exercise(60);const rows=await page.evaluate(()=>window.navSamples.filter(r=>r.model));assert.equal(rows.length,60);console.log(name,{events:rows.length,atlasPaints:rows.filter(r=>r.atlas).length,eventToLastPutMs:quantiles(rows.map(r=>Math.max(r.model,r.atlas))),postModelAtlasMs:quantiles(rows.map(r=>Math.max(0,r.atlas-r.model)))})}
    await click('Орбита');await page.mouse.move(x,y);await page.mouse.down();let i=0
    await measure('orbit',async n=>{while(n--){i++;await page.mouse.move(x+(i%20)*3,y+(i%7))}});await page.mouse.up()
    const zoom=page.getByRole('slider',{name:/Зум/});await zoom.focus();let z=0
    await measure('zoom',async n=>{while(n--){await zoom.press(z++%20<10?'ArrowRight':'ArrowLeft');await page.evaluate(()=>new Promise(requestAnimationFrame))}})
    const angled=await pixels(view);assert.equal(await pixels(atlas),ink);assert.equal(await field(),rho)
    await click('Кисть');await view.scrollIntoViewIfNeeded();await stroke();const angledInk=await pixels(atlas);assert.notEqual(angledInk,ink);await click('Отменить');assert.equal(await pixels(atlas),ink)
    await click('Вся фигура');assert.equal(await pixels(view),front);await click('Отменить');assert.equal(await pixels(atlas),blank)
    console.log(outDir,browser.version(),await view.evaluate(c=>[c.width,c.height]),{front,angled,angledInk,rho});return {front,angled,angledInk,rho}
  } finally {await page.close();await new Promise(r=>server.httpServer.close(r))}
}
try {const [first='dist',second]=process.argv.slice(2);const base=await run(first);if(second)assert.deepEqual(await run(second),base)}finally{await browser.close()}
