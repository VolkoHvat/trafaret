import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// In-memory test bundle and isolated browser profile; never uses production dist or user DB.
const bundle=await build({stdin:{contents:`export * from './src/lib/field-workspace-store'; export * from './src/lib/field-workspace';export * from './src/lib/pigment'`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'engine'})
const server=createServer((req,res)=>{if(req.url==='/api.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents)}else res.end('<script src="/api.js"></script>')})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath()});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`)
  const result=await page.evaluate(async()=>{
    const {PigmentField,restoreWorkspace,saveBatch,defaults,WorkspaceConflict}=window.engine
    const f=new PigmentField(2048,2048),color={r:10,g:20,b:30,opacity:128},p=f.paint('line',[0],color),r=new Float64Array(1024).fill(1);r[0]=0.5;r[1]=1.5
    const start=performance.now(),one=await saveBatch(2048,new Map([[0,r]]),defaults(),0,p),ms=performance.now()-start
    const fill=f.previewFill(0,i=>i>31).commit(color,'pigment',true)
    const two=await saveBatch(2048,new Map(),null,one,fill)
    let conflict=false;try{await saveBatch(2048,new Map(),null,one,p,'before')}catch(e){conflict=e instanceof WorkspaceConflict}
    const rho=new Float64Array(2048**2).fill(1),saved=await restoreWorkspace(rho),ink=PigmentField.restore(saved.metadata.pigment)
    await saveBatch(2048,new Map(),null,two,fill,'before');const undone=await restoreWorkspace(rho)
    return {ms,conflict,revision:saved.revision,revAfterUndo:undone.revision,line:ink.get('line',0),fill:ink.get('fill',31),density:[rho[0],rho[1]],channels:undone.metadata.pigment.tiles.map(t=>t.channel)}
  });const color={r:10,g:20,b:30,opacity:128};assert.deepEqual({...result,ms:0},{ms:0,conflict:true,revision:2,revAfterUndo:3,line:color,fill:color,density:[0.5,1.5],channels:['line']});console.log('PASS',browser.version(),result)
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
