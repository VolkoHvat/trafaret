import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointer } from 'react'
import { DEFAULT, demonstration, demoOrder, freshField, merge, PathInput, PEN_DEAD_ZONE_PX, project, Transfer } from '../lib/density-transfer'
import type { Brush, Mode, Point, Rect } from '../lib/density-transfer'
import { encodeField } from '../lib/field-document'
import { SMALL, LARGE } from '../lib/field-size'
import type { Size } from '../lib/field-size'
import { capture, replacement, tileRect, TileHistory, writeTile } from '../lib/field-tiles'
import type { Patch } from '../lib/field-tiles'
import { defaults, equilibrate, checkImage, imageLimit, pack, unpack, type Workspace } from '../lib/field-workspace'
import { preferredWorkspace, restoreWorkspace, saveBatch, WorkspaceConflict } from '../lib/field-workspace-store'
import { PigmentField, pigmentBoundary, type PigmentDelta } from '../lib/pigment'
import { mixingBrush } from '../lib/pigment-mixing'
import { composite, depleted, hexPigment } from '../lib/pigment-view'
import { SharedFieldBatch, commitSharedEdit } from '../lib/shared-field-patch'
import FieldPrint from './FieldPrint'
import SurfaceWorkspace from './SurfaceWorkspace'
import { defaults as bodyDefaults } from '../lib/surface-model'
import { Gesture } from '../lib/gesture-diagnostic'
import type { Diff } from '../lib/gesture-diagnostic'
import type { Segment } from '../lib/raster-linework'
import RasterTools from './RasterTools'
import DensitySection from './DensitySection'
import './DensityCanvas.css'
import './density-hud.css'

type Stroke = { material?:ReturnType<PigmentField['materialStroke']>; core:Set<number>; gesture?: Gesture; id: number; path: PathInput; anchor: {x:number;y:number}; before: Patch; queue: Point[]; ended: boolean; frame: number; reduced: boolean }
const CAPACITY = 2048
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
import BrushProof from './BrushProof'
import BrandWordmark from './BrandWordmark'
import LocalSurface from './LocalSurface'
import CompositionTool from './CompositionTool'
import { fineBrush, pigmentSpan } from '../lib/fine-line'
import { useTattooStyleTool } from './TattooStyleTool'
export default function DensityCanvas() {
  const [size,setSize]=useState<Size|null>(()=>{const params=new URLSearchParams(location.search);return params.has('field')?(params.get('field')==='2048'?LARGE:SMALL):null})
  useEffect(()=>{if(size)return;let live=true;preferredWorkspace().then(s=>{if(live)setSize(s)},()=>{if(live)setSize(SMALL)});return()=>{live=false}},[size])
  return size?<DrawingStudio size={size}/>:<p role="status">Открываем мастерскую…</p>
}
function DrawingStudio({size}:{size:Size}) {
  const [composition,setComposition]=useState<ImageData|null>(null), compositionButton=useRef<HTMLButtonElement>(null), fittingOpener=useRef<HTMLButtonElement|null>(null)
  function reviewComposition(){
    if(!canvas.current)return
    const copy=document.createElement('canvas'), scale=Math.min(1,512/WIDTH,512/HEIGHT)
    copy.width=Math.round(WIDTH*scale);copy.height=Math.round(HEIGHT*scale)
    const ctx=copy.getContext('2d');if(!ctx)return
    ctx.imageSmoothingQuality='high';ctx.drawImage(canvas.current,0,0,copy.width,copy.height)
    setComposition(ctx.getImageData(0,0,copy.width,copy.height))
  }
  const [sectionImage,setSectionImage]=useState<ImageData|null>(null)
  const [surface,setSurface]=useState(()=>new URLSearchParams(location.search).has('surface'))
  function switchView(next:boolean){const url=new URL(location.href);if(next)url.searchParams.set('surface','1');else url.searchParams.delete('surface');window.history.replaceState(null,'',url);setSurface(next)}
  const { width: WIDTH, height: HEIGHT } = size
  const [demo] = useState(() => demonstration(DEFAULT))
  const [field] = useState(() => freshField(size))
  const [paper,setPaper]=useState('warm')
  const [manualBrush, setManualBrush] = useState<Brush>(DEFAULT)
  const [targetMm,setTargetMm]=useState<number|null>(size===LARGE?.25:null)
  function setBrush(next:Brush){setTargetMm(null);setManualBrush(next)}
  const pigment=useRef(new PigmentField(WIDTH,HEIGHT)), [lineColor,setLineColor]=useState('#000000'), [fillColor,setFillColor]=useState('#000000'), [mixColor,setMixColor]=useState('#000000'), [mixWeight,setMixWeight]=useState(.35), [inkTool,setInkTool]=useState<'rho'|'line'|'fill'|'mix'|'material'>('rho')
  const [newPaint,setNewPaint]=useState(false)
  function beginMaterial(){if(bufferMode==='off'||mode!=='tone'||inkTool!=='material')return;const c=hexPigment(mixColor);return pigment.current.materialStroke(newPaint?mixingBrush([c.r,c.g,c.b],mixWeight):undefined)}
  const fillDialog=useRef<HTMLDialogElement>(null), fillCanvas=useRef<HTMLCanvasElement>(null), preview=useRef<ReturnType<PigmentField['previewFill']>|null>(null)
  const [fillInfo,setFillInfo]=useState(''), [mixTool,setMixTool]=useState<'line'|'fill'>('line')
  const stagedMix=useRef<PigmentDelta|null>(null)
  const filling=inkTool==='fill'||inkTool==='mix'&&mixTool==='fill'
  const restoreColor=useCallback((m:Workspace)=>{pigment.current=m.pigment?PigmentField.restore(m.pigment):new PigmentField(WIDTH,HEIGHT)},[WIDTH,HEIGHT])
  const [meta,setMeta]=useState(defaults), metaRef=useRef(meta), pendingMeta=useRef<Workspace|null>(null)
  const {mode}=meta, pitch=meta.widthMm/WIDTH
  const bufferMode=meta.bufferMode??'full', brush={...(targetMm===null?manualBrush:fineBrush(targetMm,pitch,bufferMode)),bufferMode}
  const sampleMm=pigmentSpan(brush)*pitch
  const [tool,setTool]=useState<'draw'|'pan'|'restore'>('draw')
  const view=useRef({zoom:1,x:0,y:0}), viewport=useRef<HTMLDivElement>(null)
  const [displayZoom,setDisplayZoom]=useState(1), drag=useRef<{id:number;x:number;y:number}|null>(null)
  const pickKind=useRef<'document'|'image'>('document')
  const resetView=()=>navigate(1,0,0)
  function navigate(zoom:number,x:number,y:number){
    zoom=Math.max(1,Math.min(8,zoom)); const limit=(zoom-1)*50
    x=Math.max(-limit,Math.min(limit,x));y=Math.max(-limit,Math.min(limit,y))
    const prev=view.current
    if(prev.zoom===zoom && prev.x===x && prev.y===y)return
    view.current={zoom,x,y}
    viewport.current?.style.setProperty('--field-transform',`translate(${x}%, ${y}%) scale(${zoom})`)
    if(prev.zoom!==zoom)setDisplayZoom(zoom)
  }
  function updateMeta(change:Partial<Workspace>){
    if(importing.current||active.current||!ready)return
    const next={...metaRef.current,...change};metaRef.current=next;setMeta(next);void persist(new Map(),next)
  }
  const [scene, setScene] = useState('Чистое поле')
  const [status, setStatus] = useState('Чтение локального поля…')
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false)
  const [history,setHistory] = useState(() => new TileHistory())
  const active = useRef<Stroke | null>(null)
  const [record,setRecord]=useState(false), [last,setLast]=useState<Gesture|null>(null)
  const [report,setReport]=useState(''), worker=useRef<Worker|null>(null)
  const [referenceHidden,setReferenceHidden]=useState(false)
  const stopReplay=()=>{worker.current?.terminate();worker.current=null}
  useEffect(()=>()=>{worker.current?.terminate()},[])
  function compare(){
    if(!last?.available)return
    stopReplay();setReport('Сравнение…')
    const w=new Worker(new URL('../lib/gesture-worker.ts',import.meta.url),{type:'module'});worker.current=w
    w.onmessage=({data})=>{if(worker.current!==w)return;stopReplay();const fmt=(d:Diff)=>`${d.density} ячеек / ${d.pixels} пикс. / max ${d.max}`
      setReport(data.error??`Исходная: ${fmt(data.diff.original)}; пакеты: ${fmt(data.diff.packing)}; выбранная (${brush.shape??'round'}, ${brush.radius}/${brush.buffer}): ${fmt(data.diff.selected)}`)}
    w.onerror=()=>{if(worker.current===w){stopReplay();setReport('Ошибка повтора')}}
    w.postMessage({g:last,brush})
  }
  const importing = useRef(false)
  const replaceInk=useRef(false)
  const saving = useRef(false), pending = useRef(new SharedFieldBatch(field)), [inkRevision,bumpInk]=useState(0)
  const [durable,setDurable] = useState(true), [problem,setProblem]=useState<''|'conflict'|'error'>('')
  const revision=useRef(0), failed=useRef(false), blankBase=useRef<Patch|null>(null)
  const unsaved=()=>saving.current||failed.current||!!pending.current.dirty||!!pendingMeta.current
  useEffect(()=>{
    const warn=(e:BeforeUnloadEvent)=>{if(unsaved()||active.current||importing.current){e.preventDefault();e.returnValue=''}}
    window.addEventListener('beforeunload',warn);return ()=>window.removeEventListener('beforeunload',warn)
  },[])
  function exportDocument(){const m=metaRef.current;download(pack(field,{...m,pigment:pigment.current.hasInk?pigment.current.snapshot():undefined,reference:null}),`${m.name.trim()||'поле'}.tfw`)}
  async function openLatest(){
    if(importing.current||active.current||saving.current||!window.confirm('Заменить несохранённую версию этой вкладки актуальной из браузера? Сначала скачайте .tfw, если нужны обе.'))return
    importing.current=true;setBusy(true)
    try{
      const staged=size===SMALL?demo.ab.slice():freshField(size), saved=await restoreWorkspace(staged)
      if(saved.metadata?.reference)await checkImage(saved.metadata.reference)
      const next=saved.metadata??defaults();restoreColor(next);field.set(staged);metaRef.current=next;setMeta(next);revision.current=saved.revision
      pending.current=new SharedFieldBatch(field);pendingMeta.current=null;failed.current=false;setProblem('');setDurable(true)
      setHistory(new TileHistory());stopReplay();setLast(null);setReport('');resetView();paint();setScene('Восстановлено');setStatus('Локальное поле загружено')
    }catch{setStatus('Не удалось открыть актуальную версию. Версия этой вкладки не изменена.')}
    finally{importing.current=false;setBusy(false)}
  }
  const canvas = useRef<HTMLCanvasElement>(null), picker = useRef<HTMLInputElement>(null)
  const paint = useCallback((dirty: Rect = {left:0,top:0,right:WIDTH-1,bottom:HEIGHT-1}) => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const w=dirty.right-dirty.left+1, h=dirty.bottom-dirty.top+1
    const img = ctx.createImageData(w,h)
    for (let y = dirty.top; y <= dirty.bottom; y++) for (let x = dirty.left; x <= dirty.right; x++) {
      const i = y * WIDTH + x, color = project(field[i], mode)
      const j = ((y-dirty.top)*w+x-dirty.left)*4; img.data[j] = img.data[j+1] = img.data[j+2] = color; img.data[j+3] = 255
      if(mode!=='stencil'&&pigment.current.hasInk)composite(img.data,j,pigment.current,i)
    }
    ctx.putImageData(img, dirty.left, dirty.top)
  }, [field, mode, WIDTH, HEIGHT])
  useEffect(() => {
    let live = true
    // Old 384 workspaces store only the tiles that differ from the A/B base.
    const staged=size===SMALL?demo.ab.slice():freshField(size)
    restoreWorkspace(staged).then(async ({data,metadata,revision:rev}) => {
      if(metadata?.reference)await checkImage(metadata.reference)
      if (!live) return
      revision.current=rev
      if(size===SMALL&&!data&&!metadata&&rev===0)blankBase.current=replacement(staged,freshField(size))
      field.set(staged)
      if(metadata){restoreColor(metadata);metaRef.current=metadata;setMeta(metadata)}
      if (data) setScene('Восстановлено'); else if (size === LARGE) setScene('Чистое поле')
      setStatus(data||metadata ? 'Локальное поле загружено' : 'Новый документ');setReady(true)
    }).catch(() => { if (live) setStatus('Не удалось прочитать локальный документ. Перезагрузите страницу; сохранённая копия не изменена.') })
    return () => { live = false }
  }, [field, size,restoreColor,demo])
  useEffect(() => { if (ready) paint() }, [ready, paint])
  async function persist(patch: Patch, metadata:Workspace|null=null,delta?:PigmentDelta,side:'before'|'after'='after',whole=false) {
    if(metadata){pendingMeta.current={...metadata};if(!whole)delete pendingMeta.current.pigment}
    if(whole)replaceInk.current=true
    if(blankBase.current){pending.current.collect(blankBase.current);blankBase.current=null}
    const start = performance.now();pending.current.collect(patch,delta,side)
    if(canvas.current){canvas.current.dataset.patchBytes=String([...patch.values()].reduce((n,a)=>n+a.byteLength,0)); canvas.current.dataset.saveCopyMs=String(performance.now()-start); canvas.current.dataset.historyBytes=String(history.bytes)}
    if (saving.current||failed.current) return
    saving.current = true; setDurable(false); setStatus('Сохранение…')
    try {
      while (pending.current.dirty || pendingMeta.current) {
        const batch = pending.current; pending.current = new SharedFieldBatch(field)
        const full=replaceInk.current;replaceInk.current=false
        // A full write replaces every stored pigment tile and ignores batch deltas, so it must carry
        // the ink as it is now: after a failed write, newer metadata or strokes would otherwise erase it.
        const snapshot=full?{...(pendingMeta.current??metaRef.current),pigment:pigment.current.hasInk?pigment.current.snapshot():undefined}:pendingMeta.current;pendingMeta.current=null
        try { revision.current=await saveBatch(WIDTH,batch.density,snapshot,revision.current,full?undefined:batch.pigment) } catch (err) {
          pendingMeta.current ??= snapshot
          pending.current.prepend(batch);replaceInk.current ||= full
          throw err
        }
      }
      setStatus('Сохранено локально'); setDurable(true)
    } catch(err) {
      failed.current=true;setProblem(err instanceof WorkspaceConflict?'conflict':'error')
      setStatus(err instanceof WorkspaceConflict?'Конфликт: другая вкладка сохранила документ этого размера.':'Не удалось сохранить локально — экспортируйте файл')
    }
    finally { saving.current = false }
  }
  function saveOperation(p:Patch,delta?:PigmentDelta,side:'before'|'after'='after'){
    const ids=new Set([...p.keys(),...(delta?.tiles.map(t=>t.id)??[])]);for(const id of ids)paint(tileRect(field,id));if(delta?.tiles.length)bumpInk(v=>v+1);void persist(p,null,delta,side)
  }
  function finishOperation(p:Patch,delta?:PigmentDelta){try{commitSharedEdit(history,field,p,pigment.current,delta??{...size,tiles:[]});saveOperation(p,delta)}catch(err){paint();setStatus(err instanceof Error?err.message:'Операция отменена')}}
  function stageMix(indices:Iterable<number>,info:string){
    const c=hexPigment(mixColor),delta=pigment.current.prepareMix(indices,mixingBrush([c.r,c.g,c.b],mixWeight),mixTool==='line')
    if(!delta.tiles.length)return
    const ctx=fillCanvas.current!.getContext('2d')!;ctx.drawImage(canvas.current!,0,0)
    const ids=new Set(delta.tiles.map(t=>t.id)),changed=new Map(delta.tiles.map(t=>[`${t.id}/${t.channel}`,t.after]))
    const img=ctx.getImageData(0,0,WIDTH,HEIGHT)
    for(const id of ids){const rect=tileRect(field,id),plane=(ch:'mixMR'|'mixGB')=>changed.has(`${id}/${ch}`)?changed.get(`${id}/${ch}`):pigment.current.mixPlane(ch,id),mrPlane=plane('mixMR'),gbPlane=plane('mixGB');for(let y=rect.top;y<=rect.bottom;y++)for(let x=rect.left;x<=rect.right;x++){
      const i=y*WIDTH+x,off=(y&31)*32+(x&31),mr=mrPlane?.[off]??0,gb=gbPlane?.[off]??0
      if(!mr)continue
      const shade=project(field[i],mode),k=i*4;img.data[k]=img.data[k+1]=img.data[k+2]=shade
      composite(img.data,k,pigment.current,i,{mass:mr>>>16,scattering:[mr&65535,gb>>>16,gb&65535]})
    }}
    ctx.putImageData(img,0,0);stagedMix.current=delta;setFillInfo(info);fillDialog.current!.showModal()
  }
  function commitStroke(p:Patch,material?:ReturnType<PigmentField['materialStroke']>,core?:Set<number>){
    if(material){const d=material.delta();pigment.current.apply(d,'after');finishOperation(p,d);return}
    if(mode==='tone'&&inkTool==='mix'){
      const indices=Array.from(bufferMode==='off'&&core?core:depleted(p,field,WIDTH));for(const [id,t] of p)writeTile(field,id,t);repaint(p)
      stageMix(indices,'Цветная линия');return
    }
    const indices=bufferMode==='off'&&inkTool==='line'?(core??new Set<number>()):depleted(p,field,WIDTH)
    const delta=mode==='tone'&&inkTool==='line'?pigment.current.paint('line',indices,hexPigment(lineColor)):undefined;finishOperation(p,delta)
  }
  function fillAt(i:number, outside?:(i:number)=>boolean){
    if(mode==='stencil'||preview.current)return
    const boundary=pigmentBoundary(field);const f=pigment.current.previewFill(i,j=>!!outside?.(j)||!!pigment.current.get('line',j)||pigment.current.mixBoundary(j)||boundary(j));if(!f.count){f.cancel();return}
    if(inkTool==='mix'){try{stageMix(f.indices(),`${f.reachedEdge?'Открытый контур · ':''}Заливка: ${f.count} ячеек`)}finally{f.cancel()}return}
    preview.current=f;const ctx=fillCanvas.current!.getContext('2d')!;ctx.drawImage(canvas.current!,0,0);const img=ctx.getImageData(0,0,WIDTH,HEIGHT), c=hexPigment(fillColor);f.forEach(j=>img.data.set([c.r,c.g,c.b,255],4*j));ctx.putImageData(img,0,0);setFillInfo(`${f.reachedEdge?'Открытый контур · ':''}${f.count} ячеек`);fillDialog.current!.showModal()
  }
  function finishFill(apply:boolean){const f=preview.current;if(f){preview.current=null;if(apply){const d=f.commit(hexPigment(fillColor),'pigment',true),p:Patch=new Map();finishOperation(p,d)}else f.cancel()}else if(stagedMix.current){if(apply){pigment.current.apply(stagedMix.current,'after');finishOperation(new Map(),stagedMix.current)}stagedMix.current=null}fillDialog.current?.close()}
  function repaint(p: Patch) { for(const id of p.keys()) paint(tileRect(field,id)) }
  function cancel() {
    if (!active.current) return
    if(active.current.gesture){active.current.gesture.finish(field,true);setLast(active.current.gesture)}
    cancelAnimationFrame(active.current.frame); const p=active.current.before; for(const [id,a] of p)writeTile(field,id,a); active.current = null; setBusy(false); repaint(p)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    const blur=()=>{if(!active.current?.ended)cancel()}
    window.addEventListener('keydown', key); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('blur', blur) }
  })
  useEffect(() => () => { if (active.current) cancelAnimationFrame(active.current.frame) }, [])
  function replace(next: Float64Array, label: string) {
    if (active.current) return
    const p=replacement(field,next), color=pigment.current.hasInk?pigment.current.clear():undefined;setScene(label);finishOperation(p,color)
  }
  function commitSegments(segments:Segment[]) {
    if (active.current||importing.current||failed.current) return
    const before:Patch=new Map(), kernel=new Transfer({radius:2,buffer:2},rect=>capture(before,field,rect))
    for(const s of segments)new PathInput(field,kernel,s).move({x:s.endX,y:s.endY})
    history.commit(before);repaint(before);void persist(before);setScene('Авто-линворк · можно дорисовать');setLast(null);stopReplay();setReport('')
  }
  function travel(redo: boolean) {
    if(active.current)return
    const p = history.travel(field,redo,pigment.current)
    if(p){setScene(redo ? 'Действие возвращено' : 'Отмена действия'); saveOperation(p,history.pigmentDelta(p),redo?'after':'before')}
  }
  async function load(file?: File) {
    if (!file || !ready || active.current || importing.current || unsaved()) return
    importing.current = true; setBusy(true)
    try {
      if(pickKind.current==='image'){
        if(file.size>imageLimit)throw Error('Подложка: максимум 6 МиБ')
        const reference=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Ошибка чтения изображения'));reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(file)})
        await checkImage(reference)
        const next={...metaRef.current,reference};metaRef.current=next;setMeta(next);setReferenceHidden(false);void persist(new Map(),next)
      }else{
        const doc=await unpack(file,field.length)
        if(doc.meta?.reference)await checkImage(doc.meta.reference)
        if(doc.meta){
          if(!window.confirm('Открыть документ вместо текущего? Сохраните отдельную копию, если она нужна.'))return
          const metadata={...doc.meta,surfaceBody:doc.meta.surfaceBody??metaRef.current.surfaceBody};if(!metadata.surfaceBody)delete metadata.surfaceBody
          const patch=replacement(field,doc.field);setHistory(new TileHistory());restoreColor(metadata);metaRef.current=metadata;setMeta(metadata);resetView();setScene('Документ открыт');paint();void persist(patch,metadata,undefined,'after',true)
        }else replace(doc.field,'Импортировано')
        stopReplay();setLast(null);setReport('')
      }
    } catch (err) { setStatus(err instanceof Error ? err.message : 'Ошибка импорта') }
    finally { importing.current = false; setBusy(false) }
  }
  function map(e: PointerEvent, rect: DOMRect): Point {
    return { x: (e.clientX - rect.left) * WIDTH / rect.width, y: (e.clientY - rect.top) * HEIGHT / rect.height, time: e.timeStamp }
  }
  function down(e: ReactPointer<HTMLCanvasElement>) {
    if (!ready || failed.current || importing.current || active.current || drag.current || e.button !== 0) return
    const el = e.currentTarget, before: Patch = new Map()
    if(tool==='pan'){el.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,y:e.clientY};return}
    if(tool==='draw'&&filling&&mode==='tone'){const pt=map(e.nativeEvent,el.getBoundingClientRect());fillAt(Math.min(HEIGHT-1,Math.floor(pt.y))*WIDTH+Math.min(WIDTH-1,Math.floor(pt.x)));return}
    if(tool==='restore'){
      const p=map(e.nativeEvent,el.getBoundingClientRect()),patch=equilibrate(field,p.x,p.y,brush.radius)
      if(patch.size){history.commit(patch);repaint(patch);void persist(patch);setScene('Локальное равновесие');setLast(null);stopReplay();setReport('')}
      return
    }
    el.setPointerCapture(e.pointerId)
    const start=map(e.nativeEvent,el.getBoundingClientRect()), gesture=record?new Gesture(field.length,brush,e.pointerType):undefined
    if(gesture){stopReplay();setReport('');setLast(null);gesture.sample(start,e.pressure)}
    const transfer=beginMaterial()
    const core=new Set<number>(), kernel = new Transfer(brush, gesture ? rect=>{capture(before,field,rect);gesture.before(field,rect)} : rect=>capture(before,field,rect))
    kernel.markCore=i=>core.add(i)
    if(transfer)kernel.material=(core,ring)=>transfer.stamp(core,ring)
    const path = new PathInput(field, kernel, start)
    active.current = { core, material:transfer, gesture, id: e.pointerId, path, anchor: {x:e.clientX,y:e.clientY}, before, queue: [], ended: false, frame: 0, reduced: false }; setBusy(true); paint(path.first)
  }
  function drain(s: Stroke) {
    if (active.current !== s) return
    s.frame = 0
    let dirty: Rect | undefined, n = 0, stamps = 0
    try {
      while (n < s.queue.length && n < 128 && stamps < 64) {
        const step = s.path.move(s.queue[n],64-stamps,true); stamps += step.count
        if (!step.more) n++
        if (step.dirty) dirty = merge(dirty, step.dirty)
      }
    } catch (err) { cancel(); if (!(err instanceof RangeError)) throw err; setScene('Некорректная координата'); return }
    s.queue.splice(0, n); if (dirty) paint(dirty)
    if (s.queue.length) s.frame = requestAnimationFrame(() => drain(s))
    else if (s.ended) {
      if(s.gesture){s.gesture.finish(field,false);setLast(s.gesture)}
      commitStroke(s.before,s.material,s.core); active.current = null; setBusy(false); setScene(s.reduced ? 'Свой рисунок · ввод прорежен' : 'Свой рисунок')
    }
  }
  function advance(e: ReactPointer<HTMLCanvasElement>, ended: boolean) {
    const pan=drag.current
    if(pan?.id===e.pointerId){
      const rect=e.currentTarget.getBoundingClientRect(), {zoom,x,y}=view.current
      navigate(zoom,x+(e.clientX-pan.x)*100*zoom/rect.width,y+(e.clientY-pan.y)*100*zoom/rect.height)
      drag.current=ended?null:{id:pan.id,x:e.clientX,y:e.clientY};return
    }
    const s = active.current
    if (!s || s.id !== e.pointerId || s.ended) return
    const rect = e.currentTarget.getBoundingClientRect(), packet: PointerEvent[] = []
    const far=(ev:{clientX:number;clientY:number})=>Math.hypot(ev.clientX-s.anchor.x,ev.clientY-s.anchor.y)>=PEN_DEAD_ZONE_PX
    for(const ev of e.nativeEvent.getCoalescedEvents?.() ?? [])if(far(ev)){packet.push(ev);s.anchor={x:ev.clientX,y:ev.clientY}}
    // The event itself usually repeats the last coalesced sample; on release it is always kept.
    const keepEnd=ended||far(e)
    if(!keepEnd&&!packet.length)return
    if(!keepEnd)packet.pop()
    s.anchor={x:e.clientX,y:e.clientY}
    const incoming=s.queue.length+packet.length+1
    if(s.gesture){s.gesture.packets++;s.gesture.peak=Math.max(s.gesture.peak,incoming)}
    if (incoming > CAPACITY) {
      s.reduced = true
      if (s.queue.length > CAPACITY / 2) s.queue = s.queue.filter((_, i) => i % 2 === 0 || i === s.queue.length - 1)
    }
    const take = Math.min(packet.length, CAPACITY - s.queue.length - 1)
    if(s.gesture)s.gesture.dropped+=incoming-(s.queue.length+take+1)
    for (let i = 0; i < take; i++) {const ev=packet[Math.floor(i*packet.length/take)],p=map(ev,rect);s.queue.push(p);s.gesture?.sample(p,ev.pressure)}
    const end=map(e.nativeEvent,rect);s.queue.push(end);s.gesture?.sample(end,e.pressure); s.ended = ended
    if (ended && s.queue.length <= 8) { cancelAnimationFrame(s.frame); drain(s) }
    else if (!s.frame) s.frame = requestAnimationFrame(() => drain(s))
  }
  const [panel,setPanel]=useState('shelf'), printPanel=useRef<HTMLFieldSetElement>(null)
  const locked = busy || !ready || !!problem
  function choose(kind:'document'|'image'){
    const input=picker.current;if(!input)return
    pickKind.current=kind;input.accept=kind==='image'?'image/png,image/jpeg':'.tfd,.tfw';input.click()
  }
  const zoomBy=(factor:number)=>navigate(view.current.zoom*factor,view.current.x,view.current.y)
  const styleTool=useTattooStyleTool(field,WIDTH,HEIGHT,meta.widthMm,locked||mode==='stencil',[setLineColor,setFillColor,setMixColor])
  const bufferControl=<label title="Отключает перенос массы для следующих штрихов. Существующее поле и кольца сохраняются."><input type="checkbox" checked={bufferMode==='off'} onChange={e=>updateMeta({bufferMode:e.target.checked?'off':'full'})}/> Без буфера</label>
  const palette=<fieldset disabled={locked||mode==='stencil'}><legend>Пигмент</legend>{bufferControl}<label>Режим пигмента <select value={inkTool} onChange={e=>setInkTool(e.target.value as typeof inkTool)}><option value="rho">Только плотность</option><option value="line">Цветная линия</option><option value="fill">Заливка</option><option value="mix">Смешение пигментов</option><option value="material">Вещество поля</option></select></label>{inkTool==='material'&&<><label><input type="checkbox" checked={newPaint} onChange={e=>setNewPaint(e.target.checked)}/>Добавлять новый пигмент</label>{newPaint&&<><label>Цвет вещества <input type="color" value={mixColor} onChange={e=>setMixColor(e.target.value)}/></label><label>Подача <input type="range" min="0.05" max="1" step="0.05" value={mixWeight} onChange={e=>setMixWeight(+e.target.value)}/></label></>}<p>Без подачи кисть перемещает только ранее нанесённую смесь; обычные sRGB-слои остаются на месте.</p></>}{inkTool!=='mix'&&inkTool!=='material'&&<><label>Цвет линии <input type="color" value={lineColor} onChange={e=>setLineColor(e.target.value)}/></label><label>Цвет заливки <input type="color" value={fillColor} onChange={e=>setFillColor(e.target.value)}/></label></>}{inkTool==='mix'&&<><label>Цвет пигмента <input type="color" value={mixColor} onChange={e=>setMixColor(e.target.value)}/></label><label>Вес {Math.round(mixWeight*100)}% <input type="range" min="0.05" max="1" step="0.05" value={mixWeight} onChange={e=>setMixWeight(+e.target.value)}/></label><label>Канал <select value={mixTool} onChange={e=>setMixTool(e.target.value as typeof mixTool)}><option value="line">Цветная линия</option><option value="fill">Цветная заливка</option></select></label><p role="note">Внимание: условная симуляция, не прогноз заживления.</p></>}</fieldset>
  return <><dialog ref={fillDialog} onCancel={()=>finishFill(false)}><p>{stagedMix.current?'Предпросмотр смеси':'Предпросмотр заливки'} · {fillInfo}</p><canvas style={{maxWidth:"min(80vw, 65vh)",height:"auto"}} ref={fillCanvas} width={WIDTH} height={HEIGHT}/><div><button onClick={()=>finishFill(true)}>{stagedMix.current?'Применить смесь':'Применить заливку'}</button><button onClick={()=>finishFill(false)}>{stagedMix.current?'Отменить смесь':'Отменить заливку'}</button></div></dialog>{surface&&ready&&<SurfaceWorkspace bufferMode={bufferMode} beginMaterial={beginMaterial} field={field} commit={commitStroke} projection={mode} pigment={pigment.current} inkRevision={inkRevision} palette={<>{palette}{styleTool}</>} filling={filling&&mode==='tone'} fillAt={fillAt} canUndo={!!history.undoCount} canRedo={!!history.redoCount} travel={travel} body={meta.surfaceBody??bodyDefaults} setBody={surfaceBody=>updateMeta({surfaceBody})} replace={(next,surfaceBody)=>{const patch=replacement(field,next), metadata={...metaRef.current,surfaceBody};delete metadata.pigment;restoreColor(metadata);setHistory(new TileHistory());metaRef.current=metadata;setMeta(metadata);paint();void persist(patch,metadata,undefined,'after',true)}} leave={()=>switchView(false)} locked={locked} status={status}/>}
    {composition&&<CompositionTool image={composition} neutral={project(1,mode)} widthMm={meta.widthMm} leave={()=>{setComposition(null);requestAnimationFrame(()=>compositionButton.current?.focus())}}/>}
    {sectionImage&&<LocalSurface image={sectionImage} widthMm={meta.widthMm} neutral={project(1,mode)} leave={()=>{setSectionImage(null);requestAnimationFrame(()=>fittingOpener.current?.focus())}}/>}
    <main hidden={!!composition||!!sectionImage||surface&&ready} className="transfer-page density-hud" style={{'--doc-ratio':WIDTH/HEIGHT} as CSSProperties} data-panel={panel}>
    <header className="hud-head"><div><BrandWordmark/><h1>Рисунок · {meta.name.trim()||'Без названия'}</h1></div><b>{WIDTH} × {HEIGHT} px</b>
    <button ref={compositionButton} disabled={locked} onClick={reviewComposition} aria-label="Композиция" title="Издали · композиция и силуэт">Издали</button>
    <button disabled={locked} onClick={e=>{fittingOpener.current=e.currentTarget;const pixels=canvas.current?.getContext('2d')?.getImageData(0,0,WIDTH,HEIGHT);if(pixels)setSectionImage(pixels)}}>Примерить</button>
    <button disabled={locked} onClick={()=>{setPanel('document');requestAnimationFrame(()=>printPanel.current?.querySelector('button')?.focus())}}>На печать</button></header>
    <section className="hud-body" aria-label="Студия рисунка"><div className="hud-switch"><label>Инспектор <select value={panel} onChange={e=>setPanel(e.target.value)}><option value="shelf">Рабочая полка</option><option value="brush">Кисть и проекция</option><option value="pigment">Цвет линии и заливки</option><option value="scene">Сцена и история</option><option value="reference">Изображение → линворк</option><option value="document">Документ и печать</option><option value="diagnostic">Жест и срез плотности</option><option value="all">Все инструменты</option></select></label></div>
    <aside className="hud-inspector"><fieldset data-group="shelf" className="work-shelf" disabled={locked}><legend>Инструмент в руке</legend>
      <strong>{tool==='pan'?'Панорама':tool==='restore'?'Восстановление':filling?'Заливка':brush.shape==='nib'?'Перо 45°':brush.shape==='refill'?'Обратное заполнение':'Круглая кисть'}</strong>
      {tool==='draw'&&!filling&&(inkTool==='line'||inkTool==='rho'||mode==='stencil')?<BrushProof brush={brush} mode={mode} color={inkTool==='line'?lineColor:null}/>:<p>Результат зависит от содержимого поля.</p>}
      <label>Радиус кисти <output>{brush.radius} px</output><input aria-label="Радиус кисти" type="range" min="1" max="14" value={brush.radius} onChange={e=>setBrush({...brush,radius:+e.target.value})}/></label>
      <label>Пигмент линии <input disabled={mode==='stencil'} type="color" value={lineColor} onChange={e=>{setLineColor(e.target.value);setInkTool('line');setTool('draw')}}/></label>
      <small>{mode==='stencil'?'Трафарет · только плотность':inkTool==='rho'?'Без пигмента · плотность':inkTool==='line'?lineColor:inkTool==='material'?'Вещество поля':inkTool==='mix'?'Смешение пигментов':'Заливка'}</small>
      <button onClick={()=>setPanel('brush')}>Настроить кисть</button></fieldset>
      <section data-group="document">
    {size===LARGE&&<button disabled={locked} onClick={e=>{fittingOpener.current=e.currentTarget;const pixels=canvas.current?.getContext('2d')?.getImageData(0,0,WIDTH,HEIGHT);if(pixels)setSectionImage(pixels)}}>Участок тела</button>}
    <button disabled={locked} onClick={()=>switchView(true)}>3D-поверхность</button>
    <button disabled={locked || !durable} onClick={()=>{ location.search = size === SMALL ? '?field=2048' : '?field=384' }}>{size === SMALL ? 'Основная студия · открыть 2048×2048' : 'Открыть 384×240'}</button></section>
    <div className="hud-panel" data-group="pigment">{palette}{styleTool}</div>
    <fieldset disabled={locked} className="transfer-controls" data-group="scene"><button onClick={() => replace(size === SMALL ? demo.ab : demoOrder(DEFAULT,size,false), 'A → B')}>A → B</button><button onClick={() => replace(size === SMALL ? demo.ba : demoOrder(DEFAULT,size,true), 'B → A')}>B → A</button><button onClick={() => replace(freshField(size), 'Чистое поле')}>Чистое поле</button></fieldset>
    <fieldset disabled={locked} className="transfer-controls" data-group="brush"><label>Инструмент <select value={tool} onChange={e=>setTool(e.target.value as typeof tool)}><option value="draw">Рисовать</option><option value="restore">Восстановить к ρ=1</option><option value="pan">Панорама</option></select></label>
      <button onClick={()=>zoomBy(.5)} disabled={displayZoom<=1}>Уменьшить</button><output>{displayZoom*100}%</output><button onClick={()=>zoomBy(2)} disabled={displayZoom>=8}>Увеличить</button><button onClick={resetView}>Вписать</button>
    </fieldset>
    {tool==='restore'&&<p data-group="brush">Касание восстанавливает круг радиуса кисти к ρ=1. Баланс сохраняется за счёт кольца до двух радиусов. При нехватке массы восстановление частичное.</p>}
    {tool==='pan'&&<p data-group="brush">Увеличьте поле и перетащите его или используйте стрелки, когда поле в фокусе.</p>}

    <p data-group="scene">Контроль 384×240 (r 8 / буфер 6): Σ|Δρ| = {demo.difference.toFixed(2)} · {demo.pixels} разных тональных пикселей.</p>
    <fieldset disabled={locked} className="transfer-controls" data-group="brush"><label>Fine-line · цель <select value={targetMm??''} onChange={e=>e.target.value?setTargetMm(+e.target.value):setBrush(brush)}><option value="">Вручную</option>{[.1,.15,.25,.35,.5,1].map(n=><option key={n} value={n}>{n} мм</option>)}</select></label><output data-fine-line>Поперечник окраски пробы: {sampleMm.toFixed(3)} мм ({pigmentSpan(brush)} px). Лист {meta.widthMm} мм; шаг {pitch.toFixed(4)} мм/px. Горизонтальная линия на чистом поле, без буфера плотности. {targetMm!==null&&targetMm<pitch?'Цель тоньше пикселя; точная ширина недоступна.':''}</output><label>Кисть <select value={brush.shape ?? 'round'} onChange={e => setBrush({ ...brush, shape: e.target.value as Brush['shape'] })}><option value="round">Круглая</option><option value="nib">Перо 45°</option><option value="refill">Обратное заполнение</option></select></label>{(['radius', 'buffer'] as const).map(key => <label key={key}>{key === 'radius' ? 'Радиус' : 'Буфер'} · {brush[key]} <input type="range" min={key==='radius'?1:2} max={key === 'radius' ? 14 : 16} value={brush[key]} onChange={e => setBrush({ ...brush, [key]: Number(e.target.value) })}/></label>)}<label title="Без буфера не создаёт кольцо и не изменяет ρ; в stencil линия не появляется. Пигментная линия записывается отдельно."><input type="checkbox" checked={bufferMode==='off'} onChange={e=>{const next=e.target.checked?'off':'full';updateMeta({bufferMode:next})}}/> Без буфера</label><label>Проекция <select value={mode} onChange={e => updateMeta({mode:e.target.value as Mode})}><option value="tone">Тональная</option><option value="stencil">Трафарет</option></select></label></fieldset>
    <p data-group="scene">Касание — один импульс. Esc отменяет ввод. История: {history.undoCount} назад / {history.redoCount} вперёд.</p>
    {problem&&<section aria-label="Восстановление документа"><p>Автосохранение остановлено. Чтобы оставить обе версии, сначала нажмите «Сохранить документ»: вы скачаете .tfw этой вкладки. Открытие актуальной версии заменит её только здесь.</p>
      <button disabled={busy} onClick={()=>void openLatest()}>Открыть актуальную версию</button>
      {problem==='error'&&<button disabled={busy} onClick={()=>{failed.current=false;setProblem('');void persist(new Map())}}>Повторить сохранение</button>}</section>}
<div className="hud-aux">
    <fieldset disabled={locked} className="transfer-controls workspace-tools" data-group="document"><label>Имя документа <input maxLength={100} value={meta.name} onChange={e=>updateMeta({name:e.target.value})}/></label>
    </fieldset>
    <fieldset disabled={locked} className="transfer-controls" data-group="document"><button onClick={() => { if (!active.current) download(new Blob([encodeField(field)]), 'поле.tfd') }}>Экспорт поля</button><button disabled={!durable} onClick={() => choose('document')}>Импорт поля</button><button disabled={!durable} onClick={()=>{if(unsaved()||!window.confirm('Создать новый документ вместо текущего? Сохраните отдельную копию, если она нужна.'))return;const next=defaults(),patch=replacement(field,freshField(size));setHistory(new TileHistory());setLast(null);stopReplay();setReport('');setScene('Чистое поле');restoreColor(next);metaRef.current=next;setMeta(next);resetView();paint();void persist(patch,next,undefined,'after',true)}}>Новый документ</button><button disabled={!durable} onClick={()=>choose('document')}>Открыть документ</button><input hidden type="file" accept=".tfd,.tfw" ref={picker} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void load(file) }}/><button onClick={() => { if (!active.current) canvas.current?.toBlob(blob => { if (blob) download(blob, 'проекция.png') }, 'image/png') }}>Экспорт PNG</button></fieldset>
    <button data-group="document" disabled={busy||!ready} onClick={exportDocument}>Сохранить документ</button>
    <fieldset ref={printPanel} data-group="document" disabled={locked}><FieldPrint canvas={()=>canvas.current} widthMm={meta.widthMm} onWidthMmChange={n=>{if(Number.isFinite(n)&&n>0&&n<=2000)updateMeta({widthMm:n})}}/></fieldset>
<fieldset disabled={locked} className="transfer-controls" data-group="reference"><legend>Подложка и линворк</legend>
      <button disabled={!durable} onClick={()=>choose('image')}>Импорт PNG/JPEG reference</button><label>Непрозрачность <input type="range" min="0" max="1" step="0.01" disabled={!meta.reference} value={meta.opacity} onChange={e=>updateMeta({opacity:Number(e.target.value)})}/></label><button disabled={!meta.reference} onClick={()=>setReferenceHidden(!referenceHidden)}>{referenceHidden?'Показать':'Скрыть'} reference</button><button disabled={!meta.reference} onClick={()=>{setReferenceHidden(false);updateMeta({reference:null})}}>Удалить reference</button>
      {meta.reference&&<RasterTools key={meta.reference} reference={meta.reference} width={WIDTH} height={HEIGHT} commit={commitSegments}/>}
    </fieldset>
    <section data-group="diagnostic" aria-label="Диагностика жеста"><label><input type="checkbox" checked={record} disabled={locked} onChange={e=>{setRecord(e.target.checked);stopReplay();setLast(null);setReport('')}}/> Записывать последний жест</label>
    {record && <><p>Пером проведите медленную петлю с резким разворотом. Пройдите точно по линии, затем рядом. Сделайте короткие касания. После каждого жеста сравните повтор до следующего касания. Давление только записывается.</p>
    {last && <><p data-gesture-summary>Источник: {last.source}; кисть: {last.brush.shape??'round'} {last.brush.radius}/{last.brush.buffer}; точек: {last.samples.length}; пакетов: {last.packets}; пик очереди до ограничения: {last.peak}; отброшено: {last.dropped}. {last.cancelled?'Отменена. ':''}{last.reason}{last.dropped?' Прорежена.':''}{last.available?'Полная запись.':''}</p>
    <details><summary>Начало и конец записи (XY, мс, давление)</summary><pre>{[last.samples[0],last.samples.at(-1)].map(p=>p&&`${p.x.toFixed(2)}, ${p.y.toFixed(2)} · ${p.time?.toFixed(2)} · ${p.pressure}`).join('\n')}</pre></details>
    <button disabled={locked||!last.available} onClick={compare}>Повторить и сравнить</button><p data-gesture-report>{report}</p></>}</>}</section></div></aside>
    <div className="workspace-view" ref={viewport} data-paper={paper}><div className="sheet-bar"><b>Лист / {mode==='tone'?'тон':'трафарет'}</b><label>Бумага · вид <select value={paper} onChange={e=>setPaper(e.target.value)}><option value="warm">Тёплая</option><option value="ash">Пепельная</option><option value="raw">Без коррекции</option></select></label><button aria-label="Шаг назад" title="Шаг назад" disabled={locked||!history.undoCount} onClick={()=>travel(false)}><span>Шаг назад</span></button><button aria-label="Шаг вперёд" title="Шаг вперёд" disabled={locked||!history.redoCount} onClick={()=>travel(true)}><span>Шаг вперёд</span></button></div><DensitySection size={size} gesture={panel==='diagnostic'||panel==='all'?last:null} locked={locked||tool!=='draw'}><div className="hud-sheet"><div className="workspace-plane"><canvas tabIndex={0} onKeyDown={e=>{if(tool!=='pan'||locked)return;const d:Record<string,number[]>={ArrowRight:[-10,0],ArrowLeft:[10,0],ArrowDown:[0,-10],ArrowUp:[0,10]};if(d[e.key]){e.preventDefault();navigate(view.current.zoom,view.current.x+d[e.key][0],view.current.y+d[e.key][1])}}} ref={canvas} width={WIDTH} height={HEIGHT} aria-label="Поле плотности" onPointerDown={down} onPointerMove={e => advance(e, false)} onPointerUp={e => advance(e, true)} onPointerCancel={e => { if (active.current?.id === e.pointerId) cancel() }} onLostPointerCapture={e => { if(drag.current?.id===e.pointerId)drag.current=null; if (active.current?.id === e.pointerId && !active.current.ended) cancel() }} />{meta.reference&&!referenceHidden&&<img className="workspace-reference" src={meta.reference} alt="Локальная подложка" draggable={false} style={{opacity:meta.opacity}}/>}</div></div></DensitySection></div>
    </section><footer className="hud-status"><b>{scene}</b><p role="status">{status}</p></footer></main></>
}
