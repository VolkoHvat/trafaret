import { freshField, PathInput, Transfer, WIDTH, type Brush } from './density-transfer'

const samples = new Map<string, number>()
/** Widest transverse pigment mask through the middle of a horizontal stroke on a clean field. */
export function pigmentSpan(brush:Brush) {
  const key = `${brush.shape ?? 'round'}/${brush.radius}/${brush.buffer}/${brush.bufferMode??'full'}`
  const cached = samples.get(key); if (cached !== undefined) return cached
  const field = freshField(), y = 48
  const kernel=new Transfer(brush), core=new Set<number>();kernel.markCore=i=>core.add(i)
  const path = new PathInput(field, kernel, {x:32,y}); path.move({x:96,y})
  let span = 0
  for (let x=62;x<=65;x++) { let n=0; for(let j=y-brush.radius;j<=y+brush.radius;j++) if(field[j*WIDTH+x]<1||core.has(j*WIDTH+x))n++; span=Math.max(span,n) }
  samples.set(key,span); return span
}
export function fineBrush(targetMm:number, mmPerPixel:number, bufferMode:Brush['bufferMode']='full') {
  let best:Brush={radius:1,buffer:2,shape:'round'}, error=Infinity
  for(let radius=1;radius<=14;radius++) {
    const brush:Brush={radius,buffer:2,shape:'round',bufferMode}, diff=Math.abs(pigmentSpan(brush)*mmPerPixel-targetMm)
    if(diff<error){error=diff;best=brush}
  }
  return best
}
