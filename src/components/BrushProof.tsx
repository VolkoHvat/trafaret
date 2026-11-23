import { useEffect, useRef } from 'react'
import { freshField, PathInput, Transfer, project, WIDTH, type Brush, type Mode } from '../lib/density-transfer'
import { hexPigment } from '../lib/pigment-view'

export default function BrushProof({brush:{radius,buffer,shape,bufferMode},mode,color}:{brush:Brush;mode:Mode;color:string|null}) {
  const ref=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const ctx=ref.current?.getContext('2d');if(!ctx)return
    const field=freshField(), kernel=new Transfer({radius,buffer,shape,bufferMode}), core=new Set<number>()
    kernel.markCore=i=>core.add(i)
    const path=new PathInput(field,kernel,{x:36,y:48})
    for(let x=37;x<166;x+=2)path.move({x,y:48-8*Math.sin((x-36)/20)})
    const image=ctx.createImageData(168,56),ink=color&&mode==='tone'?hexPigment(color):null
    for(let y=0;y<56;y++)for(let x=0;x<168;x++){
      const i=(y+20)*WIDTH+x+16, k=4*(y*168+x), shade=project(field[i],mode)
      if(ink&&(bufferMode==='off'?core.has(i):field[i]<1)){image.data[k]=ink.r;image.data[k+1]=ink.g;image.data[k+2]=ink.b}
      else image.data[k]=image.data[k+1]=image.data[k+2]=shade
      image.data[k+3]=255
    }
    ctx.putImageData(image,0,0)
  },[radius,buffer,shape,bufferMode,mode,color])
  return <canvas className="brush-proof" aria-label="Пробный штрих на чистом поле" ref={ref} width={168} height={56}/>
}
