import { decodeSurfaceProject } from './customer-surface-profile'

const store = 'projects', key = 'surface'
export function openSurfaceCheckpoint(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('trafaret-surface-checkpoint', 1)
    let blocked = false
    req.onupgradeneeded = () => req.result.createObjectStore(store)
    req.onblocked = () => { blocked = true; reject(Error('Хранилище занято другой вкладкой')) }
    req.onerror = () => reject(req.error)
    req.onsuccess = () => { if (blocked) req.result.close(); else resolve(req.result) }
  })
}
export function unpackCheckpoint(record: unknown) {
  if (record === undefined) return null
  if (!record || typeof record !== 'object' || !('token' in record) || typeof record.token !== 'string' || !record.token || !('bytes' in record) || !(record.bytes instanceof ArrayBuffer)) throw Error('Повреждена локальная копия')
  return {token:record.token, ...decodeSurfaceProject(record.bytes)}
}
export async function readSurfaceCheckpoint(db: IDBDatabase) {
  const record = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(store), req = tx.objectStore(store).get(key)
    tx.oncomplete = () => resolve(req.result)
    tx.onabort = () => reject(tx.error ?? Error('Чтение прервано'))
  })
  return unpackCheckpoint(record)
}
// Distinct successor tokens prevent a queued write from matching another tab's successor.
export function writeSurfaceCheckpoint(db: IDBDatabase, expected:string|null, token:string, bytes:ArrayBuffer): Promise<void> {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(store,'readwrite',{durability:'strict'}), objects = tx.objectStore(store)
    const read = objects.get(key)
    let conflict = false
    read.onsuccess = () => {
      if (expected === null ? read.result !== undefined : read.result?.token !== expected) { conflict = true; tx.abort(); return }
      objects.put({token,bytes},key)
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(conflict ? Error('Конфликт: локальная копия изменилась в другой вкладке') : tx.error ?? Error('Запись прервана'))
  })
}
