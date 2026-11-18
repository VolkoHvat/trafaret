const SESSION_KEY = 'trafaret-session-active-v1'

export class RecoverySession {
  private readonly storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
  }

  start(): boolean {
    try {
      const unclean = this.storage.getItem(SESSION_KEY) === 'active'
      this.storage.setItem(SESSION_KEY, 'active')
      return unclean
    } catch {
      return false
    }
  }

  finish() {
    try { this.storage.removeItem(SESSION_KEY) } catch { /* Storage can be unavailable. */ }
  }
}
