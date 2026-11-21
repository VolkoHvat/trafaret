export interface EnergyInputSample {
  x: number
  y: number
  time: number
  pressure?: number
  pointerType: 'pen' | 'mouse' | 'touch'
}

export interface EnergyImpulse {
  energy: number
  power: number
  speed: number
  source: 'fixed' | 'measured-pressure' | 'velocity-only'
  confidence: 'fixed' | 'measured' | 'modelled'
}

const zero = (source: EnergyImpulse['source'], confidence: EnergyImpulse['confidence']): EnergyImpulse => ({
  energy: 0, power: 0, speed: 0, source, confidence,
})

export class FixedEnergyInput {
  private readonly energy: number

  constructor(energy = 1) {
    if (!Number.isFinite(energy) || energy < 0) throw new Error('Invalid fixed energy')
    this.energy = energy
  }

  next(): EnergyImpulse {
    return { energy: this.energy, power: 0, speed: 0, source: 'fixed', confidence: 'fixed' }
  }

  reset() {}
}

export class MeasuredEnergyInput {
  private previous?: EnergyInputSample

  private static metadata(sample: EnergyInputSample) {
    return sample.pressure !== undefined
      ? { source: 'measured-pressure' as const, confidence: 'measured' as const }
      : { source: 'velocity-only' as const, confidence: 'modelled' as const }
  }

  next(sample: EnergyInputSample): EnergyImpulse {
    if (![sample.x, sample.y, sample.time].every(Number.isFinite)) throw new Error('Invalid input sample')
    const metadata = MeasuredEnergyInput.metadata(sample)
    const previous = this.previous
    this.previous = { ...sample }
    if (!previous) return zero(metadata.source, metadata.confidence)
    const duration = sample.time - previous.time
    if (duration <= 0) return zero(metadata.source, metadata.confidence)
    const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y)
    const speed = distance / duration
    const force = sample.pressure ?? (sample.pointerType === 'pen' ? 0.5 : sample.pointerType === 'touch' ? 0.8 : 1)
    const power = force * speed
    return { energy: power * duration, power, speed, ...metadata }
  }

  reset() { this.previous = undefined }
}
