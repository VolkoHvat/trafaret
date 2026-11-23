import { describe, expect, it } from 'vitest'
import { flatCheck, sleeveUV } from './composition-review'

const wrap = { circumference:300, length:300, widthMm:100, full:true, seamDeg:-90 }
describe('composition review', () => {
  it('three views sample the same sheet, rotating the seam moves the sampled artwork', () => {
    expect([-90,0,90].map(yaw=>sleeveUV(0,.5,yaw,wrap,1))).toEqual([[0,.5],[.25,.5],[.5,.5]])
    expect(sleeveUV(0,.5,-90,{...wrap,seamDeg:90},1)).toEqual([.5,.5])
    expect(sleeveUV(0,.5,360,wrap,1)).toEqual(sleeveUV(0,.5,0,wrap,1))
  })
  it('preserves physical width and aspect for a single motif without repeating it', () => {
    const motif={...wrap,full:false}
    expect(sleeveUV(0,.5,90,motif,2)).toEqual([.5,.5]); expect(sleeveUV(0,.5,-90,motif,2)).toBeNull()
    expect(sleeveUV(0,.6,90,motif,2)).toBeNull();expect(sleeveUV(0,.6,90,motif,1)?.[1]).toBeCloseTo(.8)
  })
  it('separates quiet and contrast regions in either projection without changing the source', () => {
    for(const neutral of [176,247]){
      const data=Uint8ClampedArray.from([neutral,neutral-30,neutral-80,neutral].flatMap(v=>[v,v,v,255])),before=data.slice(),image={width:2,height:2,data}
      const three=flatCheck(image,neutral,3), two=flatCheck(image,neutral,2)
      expect(three.contrast).toEqual([0,30,80,0]);expect(three.quiet).toBe(.5)
      expect([three.data[0],three.data[4],three.data[8]]).toEqual([242,147,42]);expect(two.data[4]).toBe(42);expect(data).toEqual(before)
    }
  })
})
