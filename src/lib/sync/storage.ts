import type { SyncProjectState, SyncStateStore } from './types'

const KEY = 'trafaret-sync-state-v1'

/** Состояние синхронизации по проектам — в localStorage, только служебные метаданные. */
export class LocalStorageSyncStore implements SyncStateStore {
  private readAll(): Record<string, SyncProjectState> {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, SyncProjectState>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  load(projectId: string): SyncProjectState | null {
    return this.readAll()[projectId] ?? null
  }

  save(projectId: string, state: SyncProjectState) {
    try {
      const all = this.readAll()
      all[projectId] = state
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch { /* хранилище переполнено/недоступно — синхронизация продолжит работать в пределах сессии */ }
  }
}
