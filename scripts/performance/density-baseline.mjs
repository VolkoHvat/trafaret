// Frozen pre-tile path: snapshot, pending copy, TFD float64 encode + FNV, real IDB transaction.
import { chromium } from 'playwright'
import { preview } from 'vite'
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() })
  const page = await browser.newPage({ serviceWorkers: 'block' }); await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/manifest.webmanifest`)
  console.log(await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('baseline'); r.onupgradeneeded = () => r.result.createObjectStore('data'); r.onsuccess = () => resolve(r.result) })
    const rows = []
    for (const [w,h] of [[384,240],[2048,2048]]) {
      const f = new Float64Array(w*h).fill(1), runs = []
      for (let n=0;n<6;n++) {
        const t = performance.now(), before = f.slice(), a = performance.now(), pending = f.slice(), b = performance.now()
        const data = new ArrayBuffer(24+pending.byteLength), view = new DataView(data), bytes = new Uint8Array(data)
        bytes.set(new TextEncoder().encode('TRAFDENS')); view.setUint32(8,2,true); view.setUint32(12,w,true); view.setUint32(16,h,true)
        for(let i=0;i<pending.length;i++) view.setFloat64(24+i*8,pending[i],true)
        let hash=2166136261; for(let i=24;i<bytes.length;i++) hash=Math.imul(hash^bytes[i],16777619); view.setUint32(20,hash,true)
        const c = performance.now(), tx = db.transaction('data','readwrite'); tx.objectStore('data').put(data,'current'); const d=performance.now()
        await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject}); if(n) runs.push([a-t,b-a,c-b,d-c,performance.now()-b]); if(before[0]!==1) throw Error()
      }
      rows.push({w,h,history12Bytes:12*f.byteLength,copyBytes:f.byteLength,medianMs:['downCopy','saveCopy','encode','idbSubmit','encodeToDurable'].map((name,i)=>[name,runs.map(r=>r[i]).sort((a,b)=>a-b)[2]])})
    }
    db.close(); return JSON.stringify(rows)
  }))
} finally { try {await browser?.close()} finally {await server.close()} }
