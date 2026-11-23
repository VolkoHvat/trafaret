import type { TrafaretNativeAuth } from '../../types/native'
import { DRIVE_SCOPE, SyncAuthError } from './types'
import type { CloudAuthProvider, SyncRuntimeConfig } from './types'

/* Минимальная типизация Google Identity Services — только то, что используем. */
interface GisTokenResponse {
  access_token?: string
  expires_in?: string | number
  error?: string
  error_description?: string
}

interface GisTokenClient {
  requestAccessToken(options?: { prompt?: string }): void
}

interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: GisTokenResponse) => void
    error_callback?: (error: { type: string }) => void
  }): GisTokenClient
  revoke(token: string, done: () => void): void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOAuth2 } }
  }
}

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client'
/** Обновляем токен чуть раньше истечения срока. */
const TOKEN_SKEW_MS = 60_000

let gisScriptPromise: Promise<GisOAuth2> | null = null

function loadGis(): Promise<GisOAuth2> {
  gisScriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SCRIPT
    script.async = true
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2
      if (oauth2) resolve(oauth2)
      else reject(new SyncAuthError('unknown', 'Google Identity Services не загрузился'))
    }
    script.onerror = () => reject(new SyncAuthError('network', 'Не удалось загрузить скрипт Google Identity Services'))
    document.head.appendChild(script)
  })
  return gisScriptPromise
}

/** OAuth через нативную оболочку (Electron/Android). Токен хранит только она. */
class NativeAuthProvider implements CloudAuthProvider {
  readonly kind = 'native' as const
  private readonly bridge: TrafaretNativeAuth

  constructor(bridge: TrafaretNativeAuth) {
    this.bridge = bridge
  }

  isConfigured(): Promise<boolean> {
    return Promise.resolve(this.bridge.isConfigured())
  }

  async getAccessToken(): Promise<string> {
    try {
      const token = await this.bridge.getAccessToken([DRIVE_SCOPE])
      if (!token) throw new SyncAuthError('not-signed-in')
      return token
    } catch (error) {
      if (error instanceof SyncAuthError) throw error
      throw new SyncAuthError('unknown', error instanceof Error ? error.message : 'Нативная авторизация вернула ошибку')
    }
  }

  beginAuthorization(): Promise<boolean> {
    return this.bridge.signIn ? this.bridge.signIn() : Promise.resolve(false)
  }

  getSessionState(): Promise<'active' | 'signed-out' | 'not-configured'> {
    return this.bridge.getSessionState
      ? this.bridge.getSessionState()
      : Promise.resolve('signed-out')
  }

  getConfig(): Promise<{ clientId: string; clientSecret: string } | null> {
    return this.bridge.getConfig ? this.bridge.getConfig() : Promise.resolve(null)
  }

  setConfig(config: { clientId: string; clientSecret?: string }): Promise<boolean> {
    return this.bridge.setConfig ? this.bridge.setConfig(config) : Promise.resolve(false)
  }

  getLastError(): Promise<string | null> {
    return this.bridge.getLastError ? this.bridge.getLastError() : Promise.resolve(null)
  }

  endSession(): Promise<void> {
    return this.bridge.signOut ? this.bridge.signOut() : Promise.resolve()
  }

  onChange(listener: () => void): () => void {
    return this.bridge.onAuthChange?.(() => listener()) ?? (() => {})
  }
}

/**
 * OAuth через Google Identity Services в браузере. Токен держим только в памяти
 * (sessionStorage/localStorage не используем сознательно).
 */
export class BrowserGoogleAuthProvider implements CloudAuthProvider {
  readonly kind = 'browser' as const
  private token: { value: string; expiresAt: number } | null = null
  private pending: Promise<string> | null = null
  private readonly clientId: string

  constructor(clientId: string) {
    this.clientId = clientId
  }

  isConfigured(): Promise<boolean> {
    return Promise.resolve(Boolean(this.clientId))
  }

  getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > TOKEN_SKEW_MS) {
      return Promise.resolve(this.token.value)
    }
    this.pending ??= this.requestToken().finally(() => { this.pending = null })
    return this.pending
  }

  async beginAuthorization(): Promise<boolean> {
    this.token = null
    await this.requestToken({ prompt: 'consent' })
    return true
  }

  async endSession(): Promise<void> {
    const oauth2 = await loadGis().catch(() => null)
    if (oauth2 && this.token) oauth2.revoke(this.token.value, () => {})
    this.token = null
  }

  private async requestToken(options?: { prompt?: string }): Promise<string> {
    const oauth2 = await loadGis()
    return new Promise<string>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPE,
        callback: response => {
          if (response.error || !response.access_token) {
            const denied = response.error === 'popup_closed_by_user' || response.error === 'popup_failed_to_open'
            reject(new SyncAuthError(denied ? 'denied' : 'unknown',
              response.error_description ?? (denied ? 'Окно входа было закрыто' : 'Google не выдал токен доступа')))
            return
          }
          const ttl = Number(response.expires_in ?? 3600)
          this.token = { value: response.access_token, expiresAt: Date.now() + ttl * 1000 }
          resolve(response.access_token)
        },
        error_callback: error => {
          reject(new SyncAuthError('denied', error.type === 'popup_closed' ? 'Окно входа было закрыто' : 'Не удалось выполнить вход через Google'))
        },
      })
      client.requestAccessToken(options)
    })
  }
}

const unavailableProvider: CloudAuthProvider = {
  kind: 'none',
  isConfigured: async () => false,
  getAccessToken: async () => { throw new SyncAuthError('not-configured', 'Облачная синхронизация не настроена') },
}

/**
 * Провайдер-держатель: позволяет заменить способ авторизации в рантайме
 * (например, после ввода Google Client ID в настройках) без пересоздания SyncEngine.
 */
export class DelegatingAuthProvider implements CloudAuthProvider {
  private inner: CloudAuthProvider = unavailableProvider
  private readonly listeners = new Set<() => void>()

  get kind(): 'native' | 'browser' | 'none' {
    return this.inner.kind
  }

  get current(): CloudAuthProvider {
    return this.inner
  }

  setProvider(provider: CloudAuthProvider) {
    this.inner = provider
    for (const listener of this.listeners) listener()
  }

  isConfigured(): Promise<boolean> {
    return this.inner.isConfigured()
  }

  getAccessToken(): Promise<string> {
    return this.inner.getAccessToken()
  }

  beginAuthorization(): Promise<boolean> {
    return this.inner.beginAuthorization?.() ?? Promise.resolve(false)
  }

  endSession(): Promise<void> {
    return this.inner.endSession?.() ?? Promise.resolve()
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export function createAuthProvider(config: SyncRuntimeConfig): CloudAuthProvider {
  if (window.trafaretNative?.auth) return new NativeAuthProvider(window.trafaretNative.auth)
  if (config.googleClientId) return new BrowserGoogleAuthProvider(config.googleClientId)
  return unavailableProvider
}
