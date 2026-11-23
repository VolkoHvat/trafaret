import {
  VoidProcess,
  type ContourMeasurement,
  type EnergyMeasurement,
  type FieldPoint,
  type ObservationRegion,
  type PenLaw,
  type RemodelPoint,
  type SaturationMeasurement,
  type StaticObservation,
} from './void-field.ts'

export type VoidInstruction =
  | { kind: 'field'; saturation: number }
  | { kind: 'pen'; law: PenLaw }
  | { kind: 'source'; point: FieldPoint; time: number; pressure: number }
  | { kind: 'measure'; point: FieldPoint; time: number }
  | { kind: 'contour'; point: FieldPoint; time: number; angle: number; maxDistance: number; step: number }
  | { kind: 'energy'; point: FieldPoint; time: number; angle: number }
  | { kind: 'observe'; region: ObservationRegion; time: number }
  | { kind: 'guide'; point: FieldPoint; pressure: number }
  | { kind: 'remodel'; region: ObservationRegion; time: number; horizon: number; step: number }

export interface VoidProgramResult {
  process: VoidProcess
  measurements: SaturationMeasurement[]
  contours: ContourMeasurement[]
  energies: EnergyMeasurement[]
  observations: StaticObservation[]
  previews: StaticObservation[]
}

function numericArgs(tokens: string[], allowed: string[], required: string[], line: number) {
  const values: Record<string, number> = {}
  for (const token of tokens) {
    const match = /^([A-Za-z]+)=([^\s]+)$/.exec(token)
    if (!match || !allowed.includes(match[1]) || values[match[1]] !== undefined) {
      throw new Error(`Invalid argument at line ${line}: ${token}`)
    }
    const value = Number(match[2])
    if (!Number.isFinite(value)) throw new Error(`Invalid number at line ${line}: ${token}`)
    values[match[1]] = value
  }
  for (const key of required) {
    if (values[key] === undefined) throw new Error(`Missing ${key} at line ${line}`)
  }
  return values
}

function region(values: Record<string, number>): ObservationRegion {
  return {
    minX: values.minX, minY: values.minY, columns: values.columns, rows: values.rows, step: values.gridStep,
  }
}

export function parseVoidProgram(text: string): VoidInstruction[] {
  const instructions: VoidInstruction[] = []
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1
    const line = raw.replace(/\s+(?:#|\/\/).*$/, '').trim()
    if (!line) continue
    const [command, ...tokens] = line.split(/\s+/)
    const args = (allowed: string[], required: string[]) => numericArgs(tokens, allowed, required, lineNumber)
    if (command === 'FIELD') {
      const values = args(['saturation'], ['saturation'])
      instructions.push({ kind: 'field', saturation: values.saturation })
    } else if (command === 'PEN') {
      const values = args(['width', 'diffusion', 'strength', 'aspect', 'angle', 'driftX', 'driftY', 'refill', 'compression', 'buffer', 'reverseInertia', 'damping'], ['width', 'diffusion', 'strength'])
      instructions.push({
        kind: 'pen',
        law: {
          width: values.width, diffusion: values.diffusion, strength: values.strength,
          aspect: values.aspect ?? 1, angle: values.angle ?? 0, refill: values.refill ?? 0,
          compression: values.compression ?? 1, buffer: values.buffer ?? 1.8,
          reverseInertia: values.reverseInertia ?? 0, damping: values.damping ?? 0,
          drift: { x: values.driftX ?? 0, y: values.driftY ?? 0 },
        },
      })
    } else if (command === 'SOURCE') {
      const values = args(['time', 'x', 'y', 'pressure'], ['time', 'x', 'y'])
      instructions.push({ kind: 'source', point: { x: values.x, y: values.y }, time: values.time, pressure: values.pressure ?? 1 })
    } else if (command === 'MEASURE') {
      const values = args(['time', 'x', 'y'], ['time', 'x', 'y'])
      instructions.push({ kind: 'measure', point: { x: values.x, y: values.y }, time: values.time })
    } else if (command === 'CONTOUR') {
      const values = args(['time', 'x', 'y', 'angle', 'maxDistance', 'step'], ['time', 'x', 'y', 'angle'])
      instructions.push({ kind: 'contour', point: { x: values.x, y: values.y }, time: values.time,
        angle: values.angle, maxDistance: values.maxDistance ?? 64, step: values.step ?? 0.25 })
    } else if (command === 'ENERGY') {
      const values = args(['time', 'x', 'y', 'angle'], ['time', 'x', 'y', 'angle'])
      instructions.push({ kind: 'energy', point: { x: values.x, y: values.y }, time: values.time, angle: values.angle })
    } else if (command === 'GUIDE') {
      const values = args(['x', 'y', 'pressure'], ['x', 'y'])
      instructions.push({ kind: 'guide', point: { x: values.x, y: values.y }, pressure: values.pressure ?? 1 })
    } else if (command === 'OBSERVE' || command === 'REMODEL') {
      const values = args(['time', 'minX', 'minY', 'columns', 'rows', 'gridStep', 'horizon', 'step'], ['time', 'minX', 'minY', 'columns', 'rows', 'gridStep'])
      if (command === 'OBSERVE') {
        instructions.push({ kind: 'observe', region: region(values), time: values.time })
      } else {
        if (values.horizon === undefined) throw new Error(`Missing horizon at line ${lineNumber}`)
        instructions.push({ kind: 'remodel', region: region(values), time: values.time, horizon: values.horizon, step: values.step ?? 1 / 120 })
      }
    } else throw new Error(`Unknown command at line ${lineNumber}: ${command}`)
  }
  return instructions
}

export function executeVoidProgram(instructions: VoidInstruction[]): VoidProgramResult {
  let process = new VoidProcess()
  let law: PenLaw | undefined
  const measurements: SaturationMeasurement[] = []
  const contours: ContourMeasurement[] = []
  const energies: EnergyMeasurement[] = []
  const observations: StaticObservation[] = []
  const previews: StaticObservation[] = []
  let guides: RemodelPoint[] = []
  for (const instruction of instructions) {
    if (instruction.kind === 'field') {
      if (process.sourceCount) throw new Error('FIELD must precede sources')
      process = new VoidProcess(instruction.saturation)
    } else if (instruction.kind === 'pen') law = instruction.law
    else if (instruction.kind === 'source') {
      if (!law) throw new Error('SOURCE requires a PEN law')
      process.append({ point: instruction.point, time: instruction.time, pressure: instruction.pressure, law })
    } else if (instruction.kind === 'measure') measurements.push(process.measure(instruction.point, instruction.time))
    else if (instruction.kind === 'contour') contours.push(process.measureContour(instruction.point, instruction.time, instruction.angle, instruction.maxDistance, instruction.step))
    else if (instruction.kind === 'energy') energies.push(process.measureEnergy(instruction.point, instruction.time, instruction.angle))
    else if (instruction.kind === 'observe') observations.push(process.observe(instruction.region, instruction.time))
    else if (instruction.kind === 'guide') guides.push({ point: instruction.point, pressure: instruction.pressure })
    else {
      previews.push(process.remodel(guides, law, instruction.horizon, instruction.step).observe(instruction.region, instruction.time))
      guides = []
    }
  }
  return { process, measurements, contours, energies, observations, previews }
}
