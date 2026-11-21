import { md5Hex } from './md5'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncEngine } from './engine'
import { DrivePreconditionError, SyncAuthError, projectFileName } from './types'
import type {
  CloudAuthProvider, CloudStorageAdapter, DriveFileInfo, DriveFolderHandle,
  SyncProjectState, SyncStateStore, SyncStatus,
} from './types'

const PROJECT_ID = 'proj-test-1'

function makeJson(revision: number, marker: string) {
  return JSON.stringify({ format: 'trafaret-project', revision, marker })
}

function makePayload(revision: number, marker = `m${revision}`) {
  return { projectId: PROJECT_ID, revision, json: makeJson(revision, marker) }
}

/** In-memory имитация Google Drive: ни одного обращения к сети. */
class MockDriveAdapter implements CloudStorageAdapter {
  readonly kind = 'mock-drive'
  readonly folder: DriveFolderHandle = { id: 'folder-1', name: 'Трафарет' }
  private files = new Map<string, { info: DriveFileInfo; json: string }>()
  private etagCounter = 0
  calls = { ensureFolder: 0, find: 0, upload: 0, update: 0, download: 0 }
  private staleEtag = ''
  failNextUpdateWithStaleEtag = false
  failNextUpdateWithError = false
  failNextDownloadWithError = false
  /** Искусственная задержка download/update для имитации медленной сети. */
  downloadDelayMs = 0
  updateDelayMs = 0

  forceStaleEtagOnNextUpdate() {
    this.failNextUpdateWithStaleEtag = true
    this.staleEtag = 'etag-stale'
  }

  async ensureAppFolder() { this.calls.ensureFolder += 1; return this.folder }

  async findProjectFile(_folderId: string, projectId: string): Promise<DriveFileInfo | null> {
    this.calls.find += 1
    const name = projectFileName(projectId)
    for (const { info } of this.files.values()) {
      if (info.name === name) return { ...info }
    }
    return null
  }

  async uploadProject(_folderId: string, projectId: string, json: string): Promise<DriveFileInfo> {
    this.calls.upload += 1
    const info: DriveFileInfo = {
      id: `file-${this.calls.upload}`, name: projectFileName(projectId),
      md5: md5Of(json), etag: `etag-${++this.etagCounter}`, modifiedTime: new Date().toISOString(),
      revision: revisionOf(json), size: json.length,
    }
    this.files.set(info.id, { info, json })
    return { ...info }
  }

  async updateProject(fileId: string, _projectId: string, json: string, ifMatchEtag: string | null): Promise<DriveFileInfo> {
    this.calls.update += 1
    if (this.updateDelayMs > 0) await new Promise(resolve => setTimeout(resolve, this.updateDelayMs))
    if (this.failNextUpdateWithError) {
      this.failNextUpdateWithError = false
      throw new Error('update failed')
    }
    const entry = this.files.get(fileId)
    if (!entry) throw new Error('Файл не найден')
    // Имитация гонки: etag у файла успел измениться между find и update.
    const effectiveEtag = this.failNextUpdateWithStaleEtag ? this.staleEtag : ifMatchEtag
    this.failNextUpdateWithStaleEtag = false
    if (effectiveEtag && entry.info.etag !== effectiveEtag) throw new DrivePreconditionError()
    entry.info = {
      ...entry.info, md5: md5Of(json), etag: `etag-${++this.etagCounter}`,
      modifiedTime: new Date().toISOString(), revision: revisionOf(json), size: json.length,
    }
    entry.json = json
    return { ...entry.info }
  }

  async downloadProject(fileId: string) {
    this.calls.download += 1
    if (this.downloadDelayMs > 0) await new Promise(resolve => setTimeout(resolve, this.downloadDelayMs))
    if (this.failNextDownloadWithError) {
      this.failNextDownloadWithError = false
      throw new Error('download failed')
    }
    const entry = this.files.get(fileId)
    if (!entry) throw new Error('Файл не найден')
    return { json: entry.json, info: { ...entry.info } }
  }

  /** Имитация изменения файла на другом устройстве. */
  simulateRemoteEdit(fileId: string, revision: number, marker: string) {
    const entry = this.files.get(fileId)
    if (!entry) throw new Error('Файл не найден')
    entry.json = makeJson(revision, marker)
    entry.info = {
      ...entry.info, md5: md5Of(entry.json), etag: `etag-${++this.etagCounter}`,
      modifiedTime: new Date().toISOString(), revision, size: entry.json.length,
    }
  }

  /** Имитация удаления файла из облака. */
  deleteRemoteFile(fileId: string) {
    this.files.delete(fileId)
  }

  remoteContent(fileId: string) { return this.files.get(fileId)?.json ?? null }
  remoteInfo(fileId: string) { return this.files.get(fileId)?.info ?? null }
}

function md5Of(json: string) {
  return md5Hex(json)
}

function revisionOf(json: string) {
  try { return Number((JSON.parse(json) as { revision?: number }).revision ?? -1) } catch { return -1 }
}

class MemoryStore implements SyncStateStore {
  private map = new Map<string, SyncProjectState>()
  load(projectId: string) { return this.map.get(projectId) ?? null }
  save(projectId: string, state: SyncProjectState) { this.map.set(projectId, state) }
}

const auth: CloudAuthProvider = {
  kind: 'browser',
  isConfigured: async () => true,
  getAccessToken: async () => 'mock-token',
}

function makeEngine() {
  const adapter = new MockDriveAdapter()
  const store = new MemoryStore()
  const statuses: SyncStatus[] = []
  const appliedRemote: string[] = []
  let online = true
  const engine = new SyncEngine({
    adapter, auth, store,
    debounceMs: 20, retryMs: 30,
    isOnline: () => online,
    onStatus: status => statuses.push(status),
    onRemoteUpdate: json => { appliedRemote.push(json) },
  })
  return {
    adapter, store, statuses, appliedRemote, engine,
    setOnline: (value: boolean) => { online = value },
  }
}

describe('SyncEngine', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('первый sync загружает проект в папку «Трафарет»', async () => {
    const { adapter, engine, store, statuses } = makeEngine()
    engine.updatePayload(makePayload(1))

    const status = await engine.syncNow()

    expect(status.state).toBe('synced')
    expect(adapter.calls.upload).toBe(1)
    expect(adapter.calls.update).toBe(0)
    expect(adapter.calls.download).toBe(0)
    const state = store.load(PROJECT_ID)
    expect(state?.fileId).toBe('file-1')
    expect(state?.lastSyncedLocalRevision).toBe(1)
    expect(statuses.at(-1)?.state).toBe('synced')
  })

  it('повторный sync без изменений ничего не отправляет и не скачивает', async () => {
    const { adapter, engine } = makeEngine()
    engine.updatePayload(makePayload(1))

    await engine.syncNow()
    expect(adapter.calls.upload).toBe(1)
    const callsAfterFirst = { ...adapter.calls }

    const status = await engine.syncNow()
    expect(status.state).toBe('synced')
    expect(adapter.calls.upload).toBe(callsAfterFirst.upload)
    expect(adapter.calls.update).toBe(callsAfterFirst.update)
    expect(adapter.calls.download).toBe(callsAfterFirst.download)
  })

  it('скачивает новую облачную ревизию, когда локально не было изменений', async () => {
    const { adapter, engine, appliedRemote, store } = makeEngine()
    engine.updatePayload(makePayload(1))
    await engine.syncNow()
    adapter.simulateRemoteEdit('file-1', 2, 'from-other-device')

    const status = await engine.syncNow()

    expect(status.state).toBe('downloaded')
    expect(adapter.calls.download).toBe(1)
    expect(appliedRemote).toHaveLength(1)
    expect(JSON.parse(appliedRemote[0]).marker).toBe('from-other-device')
    expect(store.load(PROJECT_ID)?.lastSyncedLocalRevision).toBe(2)
    expect(store.load(PROJECT_ID)?.remoteRevision).toBe(2)
  })

  it('загружает локальную правку, когда облако не менялось', async () => {
    const { adapter, engine, store } = makeEngine()
    engine.updatePayload(makePayload(1))
    await engine.syncNow()

    engine.updatePayload(makePayload(2, 'local-edit'))
    const status = await engine.syncNow()

    expect(status.state).toBe('synced')
    expect(adapter.calls.update).toBe(1)
    expect(adapter.remoteContent('file-1')).toBe(makeJson(2, 'local-edit'))
    expect(store.load(PROJECT_ID)?.lastSyncedLocalRevision).toBe(2)
  })

  it('показывает конфликт при одновременных изменениях и применяет облачную версию', async () => {
    const { adapter, engine, appliedRemote, store } = makeEngine()
    engine.updatePayload(makePayload(1))
    await engine.syncNow()
    adapter.simulateRemoteEdit('file-1', 2, 'remote-edit')

    engine.updatePayload(makePayload(3, 'local-edit'))
    const status = await engine.syncNow()

    expect(status.state).toBe('conflict')
    if (status.state === 'conflict') {
      expect(status.remoteRevision).toBe(2)
    }
    // Данные никто не перезаписал.
    expect(adapter.remoteContent('file-1')).toBe(makeJson(2, 'remote-edit'))

    const resolved = await engine.resolveConflict('remote')
    expect(resolved.state).toBe('downloaded')
    expect(appliedRemote).toHaveLength(1)
    expect(JSON.parse(appliedRemote[0]).marker).toBe('remote-edit')
    expect(engine.getStatus().state).not.toBe('conflict')
    expect(store.load(PROJECT_ID)?.lastSyncedLocalRevision).toBe(2)
  })

  it('конфликт решается в пользу локальной версии с принудительной загрузкой', async () => {
    const { adapter, engine, store } = makeEngine()
    engine.updatePayload(makePayload(1))
    await engine.syncNow()
    adapter.simulateRemoteEdit('file-1', 2, 'remote-edit')

    engine.updatePayload(makePayload(3, 'local-edit'))
    const status = await engine.syncNow()
    expect(status.state).toBe('conflict')

    const resolved = await engine.resolveConflict('local')
    expect(resolved.state).toBe('synced')
    expect(adapter.remoteContent('file-1')).toBe(makeJson(3, 'local-edit'))
    expect(store.load(PROJECT_ID)?.lastSyncedLocalRevision).toBe(3)
    expect(adapter.calls.download).toBe(0)
  })

  it.each(['local', 'remote'] as const)('восстанавливает конфликт после ошибки разрешения: %s', async choice => {
    const { adapter, engine, statuses } = makeEngine()
    engine.updatePayload(makePayload(1))
    await engine.syncNow()
    adapter.simulateRemoteEdit('file-1', 2, 'remote-edit')
    engine.updatePayload(makePayload(3, 'local-edit'))
    await engine.syncNow()
    const conflict = engine.getConflict()
    if (!conflict) throw new Error('expected conflict')

    if (choice === 'local') adapter.failNextUpdateWithError = true
    else adapter.failNextDownloadWithError = true
    const failed = await engine.resolveConflict(choice)

    expect(failed).toEqual({ state: 'conflict', ...conflict })
    expect(engine.getConflict()).toEqual(conflict)
    expect(statuses.map(status => status.state)).toContain('error')

    const resolved = await engine.resolveConflict(choice)
    expect(resolved.state).toBe(choice === 'local' ? 'synced' : 'downloaded')
    expect(engine.getConflict()).toBeNull()
  })

  it('при offline честно сообщает статус и повторяет sync после появления сети', async () => {
    const { adapter, engine, setOnline } = makeEngine()
    engine.updatePayload(makePayload(1))
    setOnline(false)

    const status = await engine.syncNow()
    expect(status.state).toBe('offline')
    // Сети нет — к «облаку» обращений не было.
    expect(adapter.calls.ensureFolder).toBe(0)
    expect(adapter.calls.upload).toBe(0)

    setOnline(true)
    const recovered = await engine.syncNow()
    expect(recovered.state).toBe('synced')
    expect(adapter.calls.upload).toBe(1)
  })

  it('автоматически повторяет попытку через retryMs после офлайна', async () => {
    const { adapter, engine, setOnline } = makeEngine()
    engine.updatePayload(makePayload(1))
    setOnline(false)
    await engine.syncNow()
    expect(engine.getStatus().state).toBe('offline')

    setOnline(true)
    await vi.advanceTimersByTimeAsync(30)
    expect(engine.getStatus().state).toBe('synced')
    expect(adapter.calls.upload).toBe(1)
  })

  it('debounce: одно локальное изменение — один sync', async () => {
    const { adapter, engine } = makeEngine()
    engine.updatePayload(makePayload(0))
    engine.notifyLocalChange(makePayload(1, 'a'))
    engine.notifyLocalChange(makePayload(2, 'b'))
    engine.notifyLocalChange(makePayload(3, 'c'))

    expect(engine.getStatus().state).toBe('pending')
    await vi.advanceTimersByTimeAsync(20)
    expect(engine.getStatus().state).toBe('synced')
    expect(adapter.calls.upload).toBe(1)
    expect(adapter.remoteContent('file-1')).toBe(makeJson(3, 'c'))
  })

  it('412 при update превращается в конфликт, а не в перезапись чужих данных', async () => {
    const { adapter, engine } = makeEngine()
    engine.updatePayload(makePayload(1))
    await engine.syncNow()

    adapter.simulateRemoteEdit('file-1', 2, 'race-winner')
    engine.updatePayload(makePayload(3, 'local-edit'))
    adapter.forceStaleEtagOnNextUpdate()

    const status = await engine.syncNow()
    expect(status.state).toBe('conflict')
    expect(adapter.remoteContent('file-1')).toBe(makeJson(2, 'race-winner'))
  })

  it('not-signed-in от провайдера — статус needs-sign-in без вызовов к Drive', async () => {
    const signedOutAuth: CloudAuthProvider = {
      kind: 'browser',
      isConfigured: async () => true,
      getAccessToken: async () => { throw new SyncAuthError('not-signed-in') },
    }
    const adapter = new MockDriveAdapter()
    const engine = new SyncEngine({ adapter, auth: signedOutAuth, store: new MemoryStore() })
    engine.updatePayload(makePayload(1))

    const status = await engine.syncNow()
    expect(status.state).toBe('needs-sign-in')
    expect(adapter.calls.ensureFolder).toBe(0)
  })

  it('не применяет remote, если локаль изменилась во время download', async () => {
    const { adapter, engine, appliedRemote, store } = makeEngine()
    engine.updatePayload(makePayload(1))
    await engine.syncNow()
    adapter.simulateRemoteEdit('file-1', 2, 'remote-edit')
    adapter.downloadDelayMs = 60

    const pending = engine.syncNow()
    await vi.advanceTimersByTimeAsync(10)
    // Пока идёт download, пользователь ставит новый штрих.
    expect(adapter.calls.download).toBe(1)
    engine.notifyLocalChange(makePayload(3, 'fresh-stroke'))
    await vi.advanceTimersByTimeAsync(50)
    const status = await pending

    expect(status.state).toBe('conflict')
    // Remote не применён — свежий штрих не потерян.
    expect(appliedRemote).toHaveLength(0)
    expect(adapter.remoteContent('file-1')).toBe(makeJson(2, 'remote-edit'))
    const state = store.load(PROJECT_ID)
    expect(state?.lastSyncedLocalRevision).toBe(1)
    expect(state?.remoteRevision).toBe(1)

    const resolved = await engine.resolveConflict('local')
    expect(resolved.state).toBe('synced')
    expect(adapter.remoteContent('file-1')).toBe(makeJson(3, 'fresh-stroke'))
  })

  it('правка во время running не теряется: после цикла запускается ещё один sync', async () => {
    const { adapter, engine } = makeEngine()
    engine.updatePayload(makePayload(1))
    await engine.syncNow()
    adapter.updateDelayMs = 60

    engine.updatePayload(makePayload(2, 'first-edit'))
    const pending = engine.syncNow()
    await vi.advanceTimersByTimeAsync(10)
    engine.notifyLocalChange(makePayload(3, 'second-edit'))
    await vi.advanceTimersByTimeAsync(50)
    const first = await pending
    expect(first.state).toBe('synced')

    // Второй цикл идёт через debounce, последовательно (не параллельно).
    await vi.advanceTimersByTimeAsync(80)
    expect(engine.getStatus().state).toBe('synced')
    expect(adapter.calls.update).toBe(2)
    expect(adapter.remoteContent('file-1')).toBe(makeJson(3, 'second-edit'))
  })

  it('восстанавливает удалённый из облака файл даже из чистой локальной версии', async () => {
    const { adapter, engine, store } = makeEngine()
    engine.updatePayload(makePayload(1))
    await engine.syncNow()
    adapter.deleteRemoteFile('file-1')

    const status = await engine.syncNow()

    expect(status.state).toBe('synced')
    expect(adapter.calls.upload).toBe(2)
    expect(adapter.remoteContent('file-2')).toBe(makeJson(1, 'm1'))
    expect(store.load(PROJECT_ID)?.fileId).toBe('file-2')
    expect(store.load(PROJECT_ID)?.lastSyncedLocalRevision).toBe(1)
  })

  it('ошибка onRemoteUpdate не портит sync metadata', async () => {
    const adapter = new MockDriveAdapter()
    const store = new MemoryStore()
    const engine = new SyncEngine({
      adapter, auth, store, debounceMs: 20, retryMs: 30,
      onRemoteUpdate: async () => { throw new Error('apply failed') },
    })
    engine.updatePayload(makePayload(1))
    await engine.syncNow()
    adapter.simulateRemoteEdit('file-1', 2, 'remote-edit')

    const status = await engine.syncNow()

    expect(status.state).toBe('error')
    const state = store.load(PROJECT_ID)
    expect(state?.fileId).toBe('file-1')
    expect(state?.lastSyncedLocalRevision).toBe(1)
    expect(state?.remoteRevision).toBe(1)
    expect(engine.getConflict()).toBeNull()
  })
})
