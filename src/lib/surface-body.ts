import { SMALL, LARGE, type Size } from './field-size'

// Client measurements are centimetres. The renderer works in millimetres.
export const defaults = {
  chest: 96, torsoLength: 48, hips: 98, pelvisLength: 21, headGirth: 56, headLength: 23,
  neckGirth: 36, neckLength: 10, armGirth: 31, armLength: 32, forearmGirth: 26,
  forearmLength: 26, handWidth: 8.5, handLength: 18, thighGirth: 55, thighLength: 44,
  calfGirth: 37, shinLength: 41, footWidth: 10, footLength: 25,
}
export type Preset = 'male' | 'female'
export type Settings = typeof defaults & { preset?: Preset }
export const presets: Record<Preset, Settings> = {
  male: { ...defaults, preset:'male', chest:105, hips:94, armGirth:34, neckGirth:39, thighGirth:56 },
  female: { ...defaults, preset:'female', chest:90, hips:104, torsoLength:44, pelvisLength:22, armGirth:28, neckGirth:33, thighGirth:59, forearmGirth:23, handWidth:8 },
}
function measurement(key: keyof typeof defaults, title: string, min: number, max: number, step = .5) {
  return { key, label: `${title}, см`, min, max, step }
}
export const measurementsDefs = [
  measurement('chest', 'Обхват груди', 68, 150), measurement('torsoLength', 'Длина торса', 32, 65),
  measurement('hips', 'Обхват таза', 68, 150), measurement('pelvisLength', 'Высота таза', 16, 30),
  measurement('headGirth', 'Обхват головы', 48, 66), measurement('headLength', 'Высота головы', 17, 29),
  measurement('neckGirth', 'Обхват шеи', 25, 56), measurement('neckLength', 'Длина шеи', 7, 15),
  measurement('armGirth', 'Обхват плеча', 18, 52), measurement('armLength', 'Длина плеча', 22, 42),
  measurement('forearmGirth', 'Обхват предплечья', 16, 42), measurement('forearmLength', 'Длина предплечья', 18, 36),
  measurement('handWidth', 'Ширина кисти', 6, 12), measurement('handLength', 'Длина кисти', 13, 24),
  measurement('thighGirth', 'Обхват бедра', 32, 85), measurement('thighLength', 'Длина бедра', 31, 57),
  measurement('calfGirth', 'Обхват голени', 22, 58), measurement('shinLength', 'Длина голени', 29, 54),
  measurement('footWidth', 'Ширина стопы', 7, 14), measurement('footLength', 'Длина стопы', 18, 33),
]
export const names = {
  torso: 'Торс', forearm: 'Правое предплечье', shin: 'Левая голень', head: 'Голова и лицо',
  neck: 'Шея', pelvis: 'Таз', upperArm: 'Правое плечо', upperArmLeft: 'Левое плечо',
  forearmLeft: 'Левое предплечье', hand: 'Правая кисть', handLeft: 'Левая кисть',
  thigh: 'Левое бедро', thighRight: 'Правое бедро', shinRight: 'Правая голень', foot: 'Левая стопа', footRight: 'Правая стопа',
}
export type Part = keyof typeof names
export const parts = Object.keys(names) as Part[]
export const tau = Math.PI * 2
// Ramanujan approximation, also used to derive the axes from the entered girth.
export const perimeter = (a: number, b: number) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
function segment(cx: number, bottom: number, height: number, rx: number, rz: number, cap: number, cz = 0, lean = 0, lower = 1, upper = 1) {
  const ry = height / 2, end = Math.min(ry, cap)
  return { cx, cy: bottom + ry, cz, rx, ry, rz, end, core: ry - end, lower, upper, slope: ry > end ? (upper-lower)/(2*(ry-end)) : 0, lean, h: height, r: perimeter(rx, rz) / tau }
}
function handAtWrist(x: number, y: number, s: Settings) {
  return segment(x, y - 10*s.handLength, 10*s.handLength, s.handWidth*5, s.handWidth*2.5, s.handWidth*6)
}
export function body(s: Settings) {
  for (const { key, min, max } of measurementsDefs) {
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max) throw new RangeError(`Мерка: ${key}`)
  }
  const radius = (girth: number, aspect = 1) => 10 * girth / perimeter(1, aspect)
  const chest = radius(s.chest, .67), hip = radius(s.hips, .72), arm = radius(s.armGirth), forearm = radius(s.forearmGirth)
  const leg = radius(s.thighGirth), calf = radius(s.calfGirth), neck = radius(s.neckGirth), skull = radius(s.headGirth, 1.06)
  const ankle = 42, knee = ankle + 10 * s.shinLength - 18, groin = knee + 10 * s.thighLength - 30
  const waist = groin + 10 * s.pelvisLength - 42, shoulder = waist + 10 * s.torsoLength
  const elbow = shoulder - 26 - 10 * s.armLength, wrist = elbow + 20 - 10 * s.forearmLength
  const legX = Math.max(leg * .93, hip * .5, s.footWidth * 5 + 2)
  const outer = Math.max(chest, hip) + Math.max(arm, forearm, s.handWidth * 5) + 14
  const shaped = s.preset !== undefined, female = s.preset === 'female'
  const shoulderWidth = shaped ? chest * (female ? .97 : 1.09) : chest
  const armTop = shoulderWidth - arm * .22, tilt = (armTop - outer) / (10 * s.armLength)
  // The widest ring carries the entered circumference. Distal diameters are
  // proportions, not additional client measurements. Keep legacy cylinders exact.
  const foreAspect = shaped ? (female ? .80 : .84) : 1
  const foreX = radius(s.forearmGirth, foreAspect)
  const calfAspect = shaped ? (female ? 1.08 : 1.14) : 1
  const calfX = radius(s.calfGirth, calfAspect)
  const upper = (sign: number) => segment(sign * (armTop + outer) / 2, elbow, 10 * s.armLength, arm, arm,
    shaped ? arm * 1.18 : arm * .85, 0, sign * tilt, shaped ? (female ? .73 : .66) : 1)
  const lower = (sign: number) => segment(sign * outer, wrist, 10 * s.forearmLength, foreX, foreX * foreAspect,
    shaped ? s.forearmLength * 1.65 : forearm * .85, 0, 0, shaped ? (female ? .60 : .65) : 1)
  // Hand detail can later attach in this wrist-local frame. Keep the two existing
  // hand part IDs/islands; new digital surfaces need versioned UVs, not repacking.
  const hand = (sign: number) => handAtWrist(sign * outer, wrist + 14, s)
  const thigh = (sign: number) => segment(sign * legX, knee, 10 * s.thighLength, leg, leg, leg * .76, 0, 0, shaped ? .69 : 1, female ? 1.07 : 1)
  const shin = (sign: number) => segment(sign * legX, ankle, 10 * s.shinLength, calfX, calfX * calfAspect,
    shaped ? s.shinLength * 2.35 : calf * .76, 0, 0, shaped ? (female ? .53 : .57) : 1)
  const foot = (sign: number) => segment(sign * legX, 0, 80, s.footWidth * 5, s.footLength * 5, 40, s.footLength * 2.2)
  return {
    torso: segment(0, waist - (shaped ? 52 : 0), s.torsoLength * 10 + (shaped ? 52 : 0), chest, chest * .67, shaped ? 82 : 55, 0, 0, shaped ? (female ? .76 : .81) : 1, shaped ? (female ? 1 : 1.09) : 1),
    pelvis: segment(0, groin, s.pelvisLength * 10, hip, hip * .72, 55, 0, 0, 1, shaped ? (female ? .76 : .9) : 1),
    neck: segment(0, shoulder - 14, s.neckLength * 10, neck, neck, 18),
    head: segment(0, shoulder + s.neckLength * 10 - 28, s.headLength * 10, skull, skull * 1.06, s.headLength * 5),
    upperArm: upper(-1), upperArmLeft: upper(1), forearm: lower(-1), forearmLeft: lower(1), hand: hand(-1), handLeft: hand(1),
    thigh: thigh(1), thighRight: thigh(-1), shin: shin(1), shinRight: shin(-1), foot: foot(1), footRight: foot(-1),
  } satisfies Record<Part, ReturnType<typeof segment>>
}
export type Segment = ReturnType<typeof segment>

// Fixed islands: a measurement edit deforms the body without moving existing texels.
// Gutters cover even the oblique nib's axis-aligned brush extent.
export const cellMm = 14 // nominal scale on the default profile, not a local surface metric
function atlasLayout() {
  const reference = body(defaults), result = {} as Record<Part, { x: number; y: number; w: number; rows: number }>
  const shelves: Part[][] = [ ['torso', 'thigh', 'thighRight', 'shin', 'shinRight'],
    ['pelvis', 'head', 'upperArm', 'upperArmLeft', 'forearm', 'forearmLeft'], ['neck', 'foot', 'footRight', 'hand', 'handLeft'] ]
  let y = 5
  for (const shelf of shelves) {
    let x = 4, height = 0
    for (const p of shelf) {
      const c = reference[p], w = Math.ceil(tau * c.r / cellMm), rows = Math.ceil((2 * c.core + perimeter(c.end, c.r) / 2) / cellMm)
      result[p] = { x, y, w, rows }; x += w + 32; height = Math.max(height, rows)
    }
    y += height + 32
  }
  return result
}
export function texelBounds(c: { x:number; y:number; w:number; rows:number }) {
  return {left:Math.round(c.x), right:Math.round(c.x+c.w), top:Math.round(c.y), bottom:Math.round(c.y+c.rows)}
}
export const islands = atlasLayout()
const largeIslands = { ...islands }
for (const part of parts) {
  const { x, y, w, rows } = islands[part]
  largeIslands[part] = { x:x*LARGE.width/SMALL.width, w:w*LARGE.width/SMALL.width,
    y:y*LARGE.height/SMALL.height, rows:rows*LARGE.height/SMALL.height }
}
export function islandsFor(atlasSize: Size = SMALL) {
  if (atlasSize.width === SMALL.width && atlasSize.height === SMALL.height) return islands
  if (atlasSize.width === LARGE.width && atlasSize.height === LARGE.height) return largeIslands
  throw new RangeError('surface atlas size')
}
