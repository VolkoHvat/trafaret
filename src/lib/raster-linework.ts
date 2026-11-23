export type RasterLineworkParams = { threshold:number; edgeSensitivity:number; minSegment:number; simplify:number }
export const defaultRasterLineworkParams = ():RasterLineworkParams => ({threshold:180,edgeSensitivity:32,minSegment:3,simplify:1})
export type Segment = {x:number;y:number;endX:number;endY:number}

// Scan both axes for contiguous, dark-side boundary runs. Coordinates are sample centres.
export function rasterToLinework(rgba:Uint8ClampedArray,width:number,height:number,params:RasterLineworkParams){
  if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=512)||rgba.length!==width*height*4)throw Error('Некорректный растр')
  if(!Number.isFinite(params.threshold)||params.threshold<0||params.threshold>255
    ||!Number.isFinite(params.edgeSensitivity)||params.edgeSensitivity<1||params.edgeSensitivity>255
    ||!Number.isFinite(params.minSegment)||!Number.isInteger(params.minSegment)||params.minSegment<1||params.minSegment>20
    ||!Number.isFinite(params.simplify)||!Number.isInteger(params.simplify)||params.simplify<1||params.simplify>8){
    throw Error('Некорректные параметры линворка')
  }
  const gray=new Uint8Array(width*height)
  let transparent=0
  for(let i=0;i<gray.length;i++){
    const j=i*4, a=rgba[j+3]/255
    gray[i]=Math.round(255*(1-a)+a*(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]))
    if(a<1)transparent++
  }
  const segments:Segment[]=[];let candidates=0
  for(const vertical of [false,true]){
    const rows=vertical?width:height,cols=vertical?height:width
    for(let row=0;row<rows;row++){
      let start=-1,last=-1
      const finish=()=>{if(start>=0&&last-start+1>=params.minSegment){segments.push(vertical?{x:row+.5,y:start+.5,endX:row+.5,endY:last+.5}:{x:start+.5,y:row+.5,endX:last+.5,endY:row+.5})}start=-1}
      for(let col=0;col<cols;col++){
        const x=vertical?row:col,y=vertical?col:row,i=y*width+x,g=gray[i]
        const prev=vertical?(x?gray[i-1]:255):(y?gray[i-width]:255),next=vertical?(x+1<width?gray[i+1]:255):(y+1<height?gray[i+width]:255)
        if(g<255&&g<=params.threshold&&Math.max(prev,next)-g>=256-params.edgeSensitivity){if(start<0)start=col;last=col;candidates++}
        else if(col-last>=params.simplify)finish()
      }
      finish()
    }
  }
  return {segments,candidates,transparent,width,height}
}
export type RasterPreview=ReturnType<typeof rasterToLinework>
