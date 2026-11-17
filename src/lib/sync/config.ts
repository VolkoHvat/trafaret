import type { SyncRuntimeConfig } from './types'

const LOCAL_KEY = 'trafaret-sync-config-v1'
const REMOTE_CONFIG_URL = './sync-config.json'

let cached: SyncRuntimeConfig | null = null

function fromLocalStorage(): SyncRuntimeConfig {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SyncRuntimeConfig
    return typeof parsed?.googleClientId === 'string' && parsed.googleClientId.trim()
      ? { googleClientId: parsed.googleClientId.trim() }
      : {}
  } catch {
    return {}
  }
}

export function saveLocalSyncConfig(config: SyncRuntimeConfig) {
  try {
    if (config.googleClientId) localStorage.setItem(LOCAL_KEY, JSON.stringify(config))
    else localStorage.removeItem(LOCAL_KEY)
  } catch { /* localStorage может быть недоступен — настройка просто не сохранится */ }
  cached = null
}

/**
 * Идентификаторы читаются во время выполнения (без перекомпиляции):
 * 1. глобальную переменную выставляет нативная оболочка;
 * 2. пользовательская настройка в localStorage (вводится в UI облака);
 * 3. статический public/sync-config.json, развёрнутый рядом с сайтом.
 */
export async function loadSyncConfig(): Promise<SyncRuntimeConfig> {
  if (cached) return cached
  const fromGlobal = window.__TRAFARET_SYNC_CONFIG__
  if (fromGlobal?.googleClientId) {
    cached = { googleClientId: fromGlobal.googleClientId }
    return cached
  }
  const fromStorage = fromLocalStorage()
  if (fromStorage.googleClientId) {
    cached = fromStorage
    return cached
  }
  try {
    const response = await fetch(REMOTE_CONFIG_URL)
    if (response.ok) {
      const parsed = (await response.json()) as SyncRuntimeConfig
      if (typeof parsed?.googleClientId === 'string' && parsed.googleClientId.trim()) {
        cached = { googleClientId: parsed.googleClientId.trim() }
        return cached
      }
    }
  } catch { /* файла конфигурации нет — это нормально */ }
  cached = {}
  return cached
}
