import { describe, expect, it } from 'vitest'
import { RecoverySession } from './recovery'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

describe('RecoverySession', () => {
  it('detects an unclean previous session and clears the marker on clean exit', () => {
    const session = new RecoverySession(new MemoryStorage() as unknown as Storage)

    expect(session.start()).toBe(false)
    expect(session.start()).toBe(true)
    session.finish()
    expect(session.start()).toBe(false)
  })

  it('falls back to a normal start when storage is unavailable', () => {
    const storage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    } as unknown as Storage
    const session = new RecoverySession(storage)

    expect(session.start()).toBe(false)
    expect(() => session.finish()).not.toThrow()
  })
})
