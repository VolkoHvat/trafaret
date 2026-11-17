import { DelegatingAuthProvider, createAuthProvider } from './auth'
import { loadSyncConfig, saveLocalSyncConfig } from './config'
import { GoogleDriveRestAdapter } from './drive'
import { SyncEngine } from './engine'
import { LocalStorageSyncStore } from './storage'
import type { SyncRuntimeConfig, SyncStatus } from './types'

const auth = new DelegatingAuthProvider()
const statusListeners = new Set<(status: SyncStatus) => void>()
let remoteListener: ((json: string) => Promise<void> | void) | null = null
let engine: SyncEngine | null = null
let enginePromise: Promise<SyncEngine> | null = null

function buildEngine(config: SyncRuntimeConfig): SyncEngine {
  auth.setProvider(createAuthProvider(config))
  return new SyncEngine({
    adapter: new GoogleDriveRestAdapter(() => auth.getAccessToken()),
    auth,
    store: new LocalStorageSyncStore(),
    onStatus: status => {
      for (const listener of statusListeners) listener(status)
    },
    onRemoteUpdate: json => remoteListener?.(json),
  })
}

export function getSyncEngine(): Promise<SyncEngine> {
  enginePromise ??= loadSyncConfig().then(config => {
    engine = buildEngine(config)
    return engine
  })
  return enginePromise
}

/** Подписка на статус синхронизации для React-компонентов. */
export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function setRemoteUpdateListener(listener: ((json: string) => Promise<void> | void) | null) {
  remoteListener = listener
}

export function getAuthProvider(): DelegatingAuthProvider {
  return auth
}

/** Сохранить Google Client ID из UI и переключить провайдера без перекомпиляции. */
export async function configureGoogleClientId(clientId: string): Promise<void> {
  saveLocalSyncConfig({ googleClientId: clientId })
  const config = await loadSyncConfig()
  auth.setProvider(createAuthProvider(config))
  const current = await getSyncEngine()
  void current.syncNow()
}
