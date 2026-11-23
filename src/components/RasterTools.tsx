import { useState } from 'react'
import { defaultRasterLineworkParams, rasterToLinework, type RasterPreview, type Segment } from '../lib/raster-linework'

type Preview=RasterPreview & {lines:Segment[]; path:string; cost:number}
export default function RasterTools({reference,width,height,commit}:{reference:string;width:number;height:number;commit:(lines:Segment[])=>void}) {
  const [params,setParams]=useState(defaultRasterLineworkParams),[preview,setPreview]=useState<Preview|null>(null)
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false)
  const [report,setReport]=useState<object|null>(null)
  async function inspect(){
    setBusy(true);setMessage('');setPreview(null)
    try {
      const img=new Image();img.src=reference;await img.decode()
      const scale=Math.min(1,256/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas')
      c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale))
      const ctx=c.getContext('2d');if(!ctx)throw Error();ctx.drawImage(img,0,0,c.width,c.height)
      const result=rasterToLinework(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height,params)
      if(result.segments.length>2048){setMessage('Слишком много сегментов: измените параметры или обведите вручную.');return}
      const fit=Math.min(width/img.naturalWidth,height/img.naturalHeight),w=fit*img.naturalWidth,h=fit*img.naturalHeight
      const X=(x:number)=>(width-w)/2+x*w/c.width,Y=(y:number)=>(height-h)/2+y*h/c.height
      const lines=result.segments.map(s=>({x:X(s.x),endX:X(s.endX),y:Y(s.y),endY:Y(s.endY)}))
      const cost=lines.reduce((n,s)=>n+1+Math.ceil(Math.hypot(s.x-s.endX,s.y-s.endY)/3),0)
      setPreview({...result,lines,cost,path:lines.map(s=>`M${s.x} ${s.y}L${s.endX} ${s.endY}`).join(' ')})
    }catch{setMessage('Предпросмотр недоступен. Подложка остаётся для ручной обводки.')}finally{setBusy(false)}
  }
  function exportReport(){
    const data=report??{mode:'manual',settings:null,counts:{autoStrokes:0}}
    const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='linework-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <fieldset className="raster-tools" disabled={busy}><legend>Предварительный линворк</legend>
    <p>Не векторизация. Светлые и прозрачные области могут потерять детали. Подложка сохраняется в этом браузере, но не в файлах и печати.</p>
    <div className="raster-params">{([['threshold','Threshold',0,255],['edgeSensitivity','Edge sensitivity',1,255],['minSegment','Min segment',1,20],['simplify','Simplify',1,8]] as const).map(([key,label,min,max])=><label key={key}>{label} <input type="range" min={min} max={max} value={params[key]} onChange={e=>{setPreview(null);setParams({...params,[key]:Number(e.target.value)})}}/><output>{params[key]}</output></label>)}</div>
    <button className="linework-action" onClick={()=>void inspect()}>Разложить в линворк</button>
    {message&&<p role="status">{message}</p>}
    {preview&&<><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Предпросмотр осей штрихов" style={{width:'100%',maxHeight:'16rem',background:'#211719'}}><path d={preview.path} fill="none" stroke="#ffcfbf" strokeWidth="2" strokeLinecap="round"/></svg><p>Осей штрихов: {preview.lines.length}. Пикселей с прозрачностью в миниатюре: {preview.transparent}. {!preview.lines.length||preview.cost>20000?'Измените параметры или обведите вручную.':''}</p><button disabled={!preview.lines.length||preview.cost>20000} onClick={()=>{commit(preview.lines);setReport(consent?{mode:'auto',settings:{...params},counts:{autoStrokes:preview.lines.length,candidates:preview.candidates}}:null);setPreview(null)}}>Применить штрихи к полю</button></>}
    <label><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);setReport(null)}}/> Записывать отчёт текущей обработки (без изображения)</label>{consent&&<button onClick={exportReport}>Скачать отдельный отчёт</button>}
  </fieldset>
}
