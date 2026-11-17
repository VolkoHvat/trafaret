import { md5Hex } from './md5'
import { DrivePreconditionError, SyncAuthError, defaultSyncState } from './types'
import type {
  CloudAuthProvider, CloudStorageAdapter, SyncConflictInfo, SyncPayload,
  SyncStateStore, SyncStatus,
} from './types'

export interface SyncEngineOptions {
  adapter: CloudStorageAdapter
  auth: CloudAuthProvider
  store: SyncStateStore
  /** Задержка автосинхронизации после локального изменения, мс. */
  debounceMs?: number
  /** Пауза перед повторной попыткой после ошибки/офлайна, мс. */
  retryMs?: number
  isOnline?: () => boolean
  now?: () => Date
  onStatus?: (status: SyncStatus) => void
  /** Вызывается, когда облачная версия новее и должна заменить локальный проект. */
  onRemoteUpdate?: (json: string) => void | Promise<void>
}

export class SyncEngine {
  private readonly opts: SyncEngineOptions
  private status: SyncStatus
  private conflict: SyncConflictInfo | null = null
  private payload: SyncPayload | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  /** Локальная правка пришла, пока шёл текущий цикл sync. */
  private localChangeDuringRun = false

  constructor(opts: SyncEngineOptions) {
    this.opts = opts
    this.status = opts.auth.kind === 'none' ? { state: 'disabled' } : { state: 'needs-setup' }
  }

  getStatus(): SyncStatus { return this.status }
  getConflict(): SyncConflictInfo | null { return this.conflict }
  getPayload(): SyncPayload | null { return this.payload }

  /** Подменяет текущий локальный снимок без постановки синхронизации в очередь. */
  updatePayload(payload: SyncPayload | null) {
    this.payload = payload
  }

  /** Локальное изменение проекта: синхронизация с debounce. */
  notifyLocalChange(payload: SyncPayload) {
    this.payload = payload
    const state = this.status.state
    if (state === 'conflict' || state === 'disabled' || state === 'needs-sign-in') return
    if (this.running) {
      // Цикл sync уже идёт: параллельный запуск запрещён, но правку не теряем —
      // после завершения текущего цикла будет запланирован ещё один.
      this.localChangeDuringRun = true
      return
    }
    this.schedule()
  }

  cancelPending() {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
  }

  /** Сеть вернулась — пробуем дослать накопленное. */
  handleOnline() {
    const state = this.status.state
    if (state === 'offline' || state === 'error') void this.syncNow()
  }

  private schedule() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.emit({ state: 'pending' })
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.syncNow()
    }, this.opts.debounceMs ?? 2500)
  }

  private scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.syncNow()
    }, this.opts.retryMs ?? 30_000)
  }

  private emit(status: SyncStatus) {
    this.status = status
    this.opts.onStatus?.(status)
  }

  async syncNow(): Promise<SyncStatus> {
    if (this.running) return this.status
    if (this.conflict) return this.status
    this.cancelPending()
    const payload = this.payload
    if (!payload) {
      this.emit({ state: 'error', message: 'Нет данных проекта для синхронизации' })
      return this.status
    }
    this.running = true
    try {
      if (!(this.opts.isOnline?.() ?? true)) {
        this.emit({ state: 'offline' })
        this.scheduleRetry()
        return this.status
      }
      if (!(await this.opts.auth.isConfigured())) {
        this.emit({ state: 'needs-setup' })
        return this.status
      }
      try {
        await this.opts.auth.getAccessToken()
      } catch (error) {
        if (error instanceof SyncAuthError && error.code !== 'network') {
          this.emit({ state: 'needs-sign-in' })
          return this.status
        }
        throw error
      }
      this.emit({ state: 'syncing' })
      const result = await this.runSync(payload)
      this.emit(result)
      return this.status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ state: 'error', message })
      this.scheduleRetry()
      return this.status
    } finally {
      this.finishRun()
    }
  }

  /**
   * Завершение цикла: снимаем флаг running и, если во время цикла пришла
   * локальная правка, планируем следующий цикл (через debounce, без параллельных
   * запусков). При статусах error/offline повтор уже обеспечивает retry-таймер.
   */
  private finishRun() {
    this.running = false
    const changedDuringRun = this.localChangeDuringRun
    this.localChangeDuringRun = false
    if (changedDuringRun && (this.status.state === 'synced' || this.status.state === 'downloaded')) {
      this.schedule()
    }
  }

  /**
   * Разрешить конфликт: 'local' — принудительно загрузить локальную версию,
   * 'remote' — скачать и применить облачную.
   */
  async resolveConflict(choice: 'local' | 'remote'): Promise<SyncStatus> {
    const payload = this.payload
    const conflict = this.conflict
    if (!payload || !conflict) return this.status
    this.conflict = null
    this.running = true
    try {
      this.emit({ state: 'syncing' })
      const at = this.nowIso()
      if (choice === 'remote') {
        const folder = await this.opts.adapter.ensureAppFolder()
        const remote = await this.opts.adapter.findProjectFile(folder.id, payload.projectId)
        if (!remote) throw new Error('Файл проекта удалён из облака')
        const status = await this.applyRemote(payload, remote.id)
        this.emit(status)
        return this.status
      }
      const folder = await this.opts.adapter.ensureAppFolder()
      const remote = await this.opts.adapter.findProjectFile(folder.id, payload.projectId)
      if (!remote) {
        const uploaded = await this.opts.adapter.uploadProject(folder.id, payload.projectId, payload.json)
        this.opts.store.save(payload.projectId, {
          fileId: uploaded.id, remoteMd5: uploaded.md5 ?? md5Hex(payload.json),
          remoteRevision: payload.revision, lastSyncedLocalRevision: payload.revision,
        })
      } else {
        const updated = await this.opts.adapter.updateProject(remote.id, payload.projectId, payload.json, null)
        this.opts.store.save(payload.projectId, {
          fileId: updated.id, remoteMd5: updated.md5 ?? md5Hex(payload.json),
          remoteRevision: payload.revision, lastSyncedLocalRevision: payload.revision,
        })
      }
      this.emit({ state: 'synced', at })
      return this.status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ state: 'error', message })
      return this.status
    } finally {
      this.finishRun()
    }
  }

  private async runSync(payload: SyncPayload): Promise<SyncStatus> {
    const folder = await this.opts.adapter.ensureAppFolder()
    const remote = await this.opts.adapter.findProjectFile(folder.id, payload.projectId)
    const stored = this.opts.store.load(payload.projectId)
    const state = stored ?? defaultSyncState()
    const localMd5 = md5Hex(payload.json)
    const at = this.nowIso()

    if (!remote) {
      // Файла в облаке нет: восстанавливаем его из локальной копии — в том числе
      // когда локаль чистая (rev === lastSyncedLocalRevision), иначе Drive остаётся
      // пустым, а статус лжёт «synced».
      const neverSynced = stored === null || state.fileId === null
      const localDirty = payload.revision > state.lastSyncedLocalRevision
      if (neverSynced || localDirty || state.fileId !== null) {
        const uploaded = await this.opts.adapter.uploadProject(folder.id, payload.projectId, payload.json)
        this.opts.store.save(payload.projectId, {
          fileId: uploaded.id, remoteMd5: uploaded.md5 ?? localMd5,
          remoteRevision: payload.revision, lastSyncedLocalRevision: payload.revision,
        })
      }
      return { state: 'synced', at }
    }

    // Контент идентичен — просто фиксируем состояние (в т.ч. первый контакт
    // с файлом, созданным на другом устройстве.
    if (remote.md5 === localMd5) {
      this.opts.store.save(payload.projectId, {
        fileId: remote.id, remoteMd5: remote.md5, remoteRevision: remote.revision,
        lastSyncedLocalRevision: payload.revision,
      })
      return { state: 'synced', at }
    }

    const localDirty = payload.revision > state.lastSyncedLocalRevision
    const remoteChanged = state.fileId !== remote.id || state.remoteMd5 === null || remote.md5 !== state.remoteMd5

    // Только облако изменилось — скачиваем.
    if (!localDirty && remoteChanged) {
      return this.applyRemote(payload, remote.id)
    }

    // Только локально изменилось — обновляем файл с проверкой etag.
    if (localDirty && !remoteChanged) {
      try {
        const updated = await this.opts.adapter.updateProject(remote.id, payload.projectId, payload.json, remote.etag)
        this.opts.store.save(payload.projectId, {
          fileId: updated.id, remoteMd5: updated.md5 ?? localMd5,
          remoteRevision: payload.revision, lastSyncedLocalRevision: payload.revision,
        })
        return { state: 'synced', at }
      } catch (error) {
        if (!(error instanceof DrivePreconditionError)) throw error
        // Файл успели изменить с другой стороны между find и update.
        const fresh = await this.opts.adapter.findProjectFile(folder.id, payload.projectId)
        if (fresh && fresh.md5 === localMd5) {
          this.opts.store.save(payload.projectId, {
            fileId: fresh.id, remoteMd5: fresh.md5, remoteRevision: fresh.revision,
            lastSyncedLocalRevision: payload.revision,
          })
          return { state: 'synced', at }
        }
        this.conflict = {
          fileId: remote.id,
          remoteRevision: fresh?.revision ?? remote.revision,
          remoteModifiedTime: fresh?.modifiedTime ?? remote.modifiedTime,
        }
        return { state: 'conflict', ...this.conflict }
      }
    }

    // Обе версии изменились (или рассинхрон без явной ревизии) — конфликт.
    this.conflict = {
      fileId: remote.id,
      remoteRevision: remote.revision,
      remoteModifiedTime: remote.modifiedTime,
    }
    return { state: 'conflict', ...this.conflict }
  }

  private async applyRemote(payload: SyncPayload, fileId: string): Promise<SyncStatus> {
    const { json, info } = await this.opts.adapter.downloadProject(fileId)
    // Пока шёл download, локальный проект мог измениться. Перечитываем актуальный
    // payload: если ревизия сместилась со старта цикла, remote не применяем —
    // иначе свежий локальный штрих затрётся облачной версией. Фиксируем конфликт,
    // пользователь разрешит его явно.
    const current = this.payload
    if (current && current.projectId === payload.projectId && current.revision !== payload.revision) {
      this.conflict = {
        fileId: info.id,
        remoteRevision: info.revision,
        remoteModifiedTime: info.modifiedTime,
      }
      return { state: 'conflict', ...this.conflict }
    }
    const remoteRevision = readRevision(json) ?? info.revision
    // Store помечаем применённым только после успешного onRemoteUpdate:
    // ошибка apply не должна портить sync metadata.
    await this.opts.onRemoteUpdate?.(json)
    this.opts.store.save(payload.projectId, {
      fileId: info.id, remoteMd5: info.md5, remoteRevision,
      lastSyncedLocalRevision: remoteRevision,
    })
    return { state: 'downloaded', at: this.nowIso() }
  }

  private nowIso(): string {
    return (this.opts.now ?? (() => new Date()))().toISOString()
  }
}

function readRevision(json: string): number | null {
  try {
    const parsed = JSON.parse(json) as { revision?: unknown }
    return typeof parsed.revision === 'number' && Number.isFinite(parsed.revision) ? parsed.revision : null
  } catch {
    return null
  }
}
