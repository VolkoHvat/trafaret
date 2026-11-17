import type { SyncRuntimeConfig } from '../lib/sync/types'

/**
 * Контракт нативной оболочки (Electron / Android). Оболочка внедряется как
 * window.trafaretNative ДО загрузки скрипта приложения. Токены и OAuth Client ID
 * живут только внутри оболочки — в коде веб-приложения их быть не должно.
 */
export interface NativeSyncConfig {
  clientId: string
  clientSecret?: string
}

export interface TrafaretNativeAuth {
  getAccessToken(scopes: string[]): Promise<string>
  isConfigured(): Promise<boolean> | boolean
  signIn?(): Promise<boolean>
  signOut?(): Promise<void>
  onAuthChange?(listener: (signedIn: boolean) => void): () => void
  /** Состояние сессии — чтобы UI честно показывал вход/выход. */
  getSessionState?(): Promise<'active' | 'signed-out' | 'not-configured'>
  /** Нативная настройка Client ID / Secret (desktop хранит их в userData). */
  getConfig?(): Promise<{ clientId: string; clientSecret: string } | null>
  setConfig?(config: NativeSyncConfig): Promise<boolean>
  /** Последняя ошибка нативного входа — для честного показа в UI. */
  getLastError?(): Promise<string | null>
}

export interface TrafaretNativeBridge {
  platform: 'electron' | 'android'
  auth: TrafaretNativeAuth
}

declare global {
  interface Window {
    trafaretNative?: TrafaretNativeBridge
    __TRAFARET_SYNC_CONFIG__?: SyncRuntimeConfig
  }
}

export {}
