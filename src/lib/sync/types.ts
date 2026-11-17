export const DRIVE_FOLDER_NAME = 'Трафарет'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const DRIVE_FILE_EXT = '.tattoo.json'
export const REVISION_PROPERTY = 'trafaret-revision'
export const PROJECT_ID_PROPERTY = 'trafaret-project-id'

export type SyncAuthErrorCode = 'not-configured' | 'not-signed-in' | 'denied' | 'network' | 'unknown'

export class SyncAuthError extends Error {
  readonly code: SyncAuthErrorCode
  constructor(code: SyncAuthErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'SyncAuthError'
    this.code = code
  }
}

export class DriveRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'DriveRequestError'
    this.status = status
  }
}

/** 412 Precondition Failed — удалённый файл изменился во время upload. */
export class DrivePreconditionError extends DriveRequestError {
  constructor() {
    super(412, 'Удалённый файл изменился с момента последней синхронизации')
    this.name = 'DrivePreconditionError'
  }
}

export interface DriveFileInfo {
  id: string
  name: string
  md5: string | null
  etag: string | null
  modifiedTime: string | null
  revision: number
  size: number
}

export interface DriveFolderHandle {
  id: string
  name: string
}

/**
 * Облачный адаптер хранилища. Реализация — Google Drive REST (drive.file),
 * но контракт не привязан к Google, чтобы можно было добавить другой бэкенд.
 */
export interface CloudStorageAdapter {
  readonly kind: string
  ensureAppFolder(): Promise<DriveFolderHandle>
  findProjectFile(folderId: string, projectId: string): Promise<DriveFileInfo | null>
  uploadProject(folderId: string, projectId: string, json: string): Promise<DriveFileInfo>
  updateProject(fileId: string, projectId: string, json: string, ifMatchEtag: string | null): Promise<DriveFileInfo>
  downloadProject(fileId: string): Promise<{ json: string; info: DriveFileInfo }>
}

/**
 * Провайдер OAuth-доступа. Нативные оболочки (Electron/Android) реализуют
 * getAccessToken через системный браузер/Custom Tab; браузерное PWA —
 * через Google Identity Services. Токены живут только у провайдера.
 */
export interface CloudAuthProvider {
  readonly kind: 'native' | 'browser' | 'none'
  isConfigured(): Promise<boolean>
  getAccessToken(): Promise<string>
  beginAuthorization?(): Promise<boolean>
  endSession?(): Promise<void>
  onChange?(listener: () => void): () => void
  /** Нативные провайдеры: состояние сессии для честного UI входа/выхода. */
  getSessionState?(): Promise<'active' | 'signed-out' | 'not-configured'>
  getLastError?(): Promise<string | null>
  /** Нативная настройка Client ID / Secret (desktop хранит в userData). */
  getConfig?(): Promise<{ clientId: string; clientSecret: string } | null>
  setConfig?(config: { clientId: string; clientSecret?: string }): Promise<boolean>
}

export interface SyncRuntimeConfig {
  googleClientId?: string
}

export type SyncStatus =
  | { state: 'disabled' }
  | { state: 'needs-setup' }
  | { state: 'needs-sign-in' }
  | { state: 'pending' }
  | { state: 'offline' }
  | { state: 'syncing' }
  | { state: 'synced'; at: string }
  | { state: 'downloaded'; at: string }
  | { state: 'conflict'; fileId: string; remoteRevision: number; remoteModifiedTime: string | null }
  | { state: 'error'; message: string }

export interface SyncConflictInfo {
  fileId: string
  remoteRevision: number
  remoteModifiedTime: string | null
}

export interface SyncProjectState {
  fileId: string | null
  remoteMd5: string | null
  remoteRevision: number
  lastSyncedLocalRevision: number
}

export interface SyncStateStore {
  load(projectId: string): SyncProjectState | null
  save(projectId: string, state: SyncProjectState): void
}

export interface SyncPayload {
  projectId: string
  revision: number
  json: string
}

export function projectFileName(projectId: string) {
  return `Трафарет-${projectId}${DRIVE_FILE_EXT}`
}

export function defaultSyncState(): SyncProjectState {
  return { fileId: null, remoteMd5: null, remoteRevision: -1, lastSyncedLocalRevision: 0 }
}
