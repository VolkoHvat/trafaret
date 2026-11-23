import { useCallback, useEffect, useRef, useState } from 'react'
import { configureGoogleClientId, getAuthProvider, getSyncEngine, setRemoteUpdateListener, subscribeSyncStatus } from '../lib/sync/client'
import type { SyncConflictInfo, SyncPayload, SyncStatus } from '../lib/sync/types'

export interface CloudSyncOptions {
  projectId: string
  revision: number
  /** JSON текущего проекта или null, если снимок сделать нельзя. */
  takeSnapshot: () => string | null
  /** Применить скачанную из облака версию (заменяет локальный проект). */
  applyRemote: (json: string) => Promise<void> | void
  hydrated: boolean
}

export interface CloudSyncApi {
  status: SyncStatus
  online: boolean
  authKind: 'native' | 'browser' | 'none'
  authConfigured: boolean
  /** Нативная сессия: выполнен вход. */
  signedIn: boolean
  /** Последняя честная ошибка нативного входа/настройки. */
  authError: string | null
  conflict: SyncConflictInfo | null
  notifyLocalChange: () => void
  syncNow: () => Promise<void>
  resolveConflict: (choice: 'local' | 'remote') => Promise<void>
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  saveClientId: (clientId: string) => Promise<void>
  saveNativeConfig: (config: { clientId: string; clientSecret?: string }) => Promise<void>
}

export function useCloudSync(options: CloudSyncOptions): CloudSyncApi {
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof getSyncEngine>> | null>(null)
  const [status, setStatus] = useState<SyncStatus>({ state: 'needs-setup' })
  const [online, setOnline] = useState(() => navigator.onLine)
  const [authInfo, setAuthInfo] = useState<{ kind: 'native' | 'browser' | 'none'; configured: boolean; signedIn: boolean; error: string | null }>({ kind: 'none', configured: false, signedIn: false, error: null })

  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const buildPayload = useCallback((): SyncPayload | null => {
    const { projectId, revision, takeSnapshot } = optionsRef.current
    if (!projectId) return null
    const json = takeSnapshot()
    return json ? { projectId, revision, json } : null
  }, [])

  const refreshAuthInfo = useCallback(async () => {
    const provider = getAuthProvider().current
    const configured = await provider.isConfigured().catch(() => false)
    const sessionState = await provider.getSessionState?.().catch(() => 'signed-out' as const)
    const error = await provider.getLastError?.().catch(() => null) ?? null
    setAuthInfo({ kind: provider.kind, configured, signedIn: sessionState === 'active', error })
  }, [])

  useEffect(() => {
    let alive = true
    void getSyncEngine().then(async instance => {
      if (!alive) return
      setEngine(instance)
      instance.updatePayload(buildPayload())
      await refreshAuthInfo()
      // Подхватываем вход/выход, выполненные в нативной оболочке.
      getAuthProvider().onChange(() => {
        void refreshAuthInfo()
        void instance.syncNow()
      })
    })
    return () => { alive = false }
  }, [buildPayload, refreshAuthInfo])

  useEffect(() => subscribeSyncStatus(setStatus), [])

  useEffect(() => setRemoteUpdateListener(json => optionsRef.current.applyRemote(json)), [])

  useEffect(() => {
    engine?.updatePayload(buildPayload())
  }, [engine, buildPayload, options.projectId, options.revision, options.takeSnapshot])

  useEffect(() => {
    const goOnline = () => {
      setOnline(true)
      engine?.handleOnline()
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [engine])

  const notifyLocalChange = useCallback(() => {
    if (!optionsRef.current.hydrated) return
    const payload = buildPayload()
    if (payload) engine?.notifyLocalChange(payload)
  }, [engine, buildPayload])

  const syncNow = useCallback(async () => {
    if (!engine) return
    engine.updatePayload(buildPayload())
    await engine.syncNow()
    await refreshAuthInfo()
  }, [engine, buildPayload, refreshAuthInfo])

  const resolveConflict = useCallback(async (choice: 'local' | 'remote') => {
    await engine?.resolveConflict(choice)
  }, [engine])

  const signIn = useCallback(async () => {
    const provider = getAuthProvider()
    try {
      await provider.beginAuthorization?.()
      await refreshAuthInfo()
      await syncNow()
    } catch {
      setStatus(previous => previous.state === 'needs-sign-in' ? previous : { state: 'needs-sign-in' })
    }
  }, [refreshAuthInfo, syncNow])

  const signOut = useCallback(async () => {
    await getAuthProvider().endSession?.()
    await refreshAuthInfo()
  }, [refreshAuthInfo])

  const saveClientId = useCallback(async (clientId: string) => {
    await configureGoogleClientId(clientId)
    await refreshAuthInfo()
  }, [refreshAuthInfo])

  const saveNativeConfig = useCallback(async (config: { clientId: string; clientSecret?: string }) => {
    const provider = getAuthProvider().current
    if (provider.setConfig) await provider.setConfig(config)
    await refreshAuthInfo()
    await getSyncEngine().then(engine => engine.syncNow())
  }, [refreshAuthInfo])

  return {
    status,
    online,
    authKind: authInfo.kind,
    authConfigured: authInfo.configured,
    signedIn: authInfo.signedIn,
    authError: authInfo.error,
    conflict: engine?.getConflict() ?? null,
    notifyLocalChange,
    syncNow,
    resolveConflict,
    signIn,
    signOut,
    saveClientId,
    saveNativeConfig,
  }
}
