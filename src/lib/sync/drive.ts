import { DRIVE_FOLDER_NAME, DRIVE_SCOPE, DrivePreconditionError, DriveRequestError, PROJECT_ID_PROPERTY, REVISION_PROPERTY, projectFileName } from './types'
import type { CloudStorageAdapter, DriveFileInfo, DriveFolderHandle } from './types'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FILE_FIELDS = 'id,name,md5Checksum,etag,modifiedTime,size,appProperties'
const FOLDER_FIELDS = 'id,name'

interface DriveFileResource {
  id?: string
  name?: string
  md5Checksum?: string
  etag?: string
  modifiedTime?: string
  size?: string
  appProperties?: Record<string, string>
}

export class GoogleDriveRestAdapter implements CloudStorageAdapter {
  readonly kind = 'google-drive'

  private readonly getToken: () => Promise<string>

  constructor(getToken: () => Promise<string>) {
    this.getToken = getToken
  }

  private async request(path: string, init: RequestInit = {}, accept: 'json' | 'text' = 'json'): Promise<unknown> {
    const token = await this.getToken()
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    })
    if (response.status === 412) throw new DrivePreconditionError()
    if (response.status === 401 || response.status === 403) {
      throw new DriveRequestError(response.status, 'Нет доступа к Google Drive — войдите заново')
    }
    if (!response.ok) {
      throw new DriveRequestError(response.status, `Google Drive вернул ошибку ${response.status}`)
    }
    return accept === 'text' ? response.text() : response.json()
  }

  private async uploadRequest(path: string, metadata: Record<string, unknown>, body: string, ifMatchEtag: string | null): Promise<DriveFileInfo> {
    const token = await this.getToken()
    const boundary = `trafaret-${Date.now().toString(36)}`
    const payload = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      body,
      `--${boundary}--`,
      '',
    ].join('\r\n')
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    }
    if (ifMatchEtag) headers['If-Match'] = ifMatchEtag
    const response = await fetch(`${UPLOAD_API}${path}?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers,
      body: payload,
    })
    if (response.status === 412) throw new DrivePreconditionError()
    if (response.status === 401 || response.status === 403) {
      throw new DriveRequestError(response.status, 'Нет доступа к Google Drive — войдите заново')
    }
    if (!response.ok) {
      throw new DriveRequestError(response.status, `Google Drive не принял файл (ошибка ${response.status})`)
    }
    return toFileInfo(await response.json() as DriveFileResource)
  }

  async ensureAppFolder(): Promise<DriveFolderHandle> {
    const escaped = DRIVE_FOLDER_NAME.replace(/'/g, "\\'")
    const found = await this.request(
      `/files?q=${encodeURIComponent(`name='${escaped}' and mimeType='${FOLDER_MIME}' and 'root' in parents and trashed=false`)}&fields=files(${FOLDER_FIELDS})&spaces=drive`,
    ) as { files?: DriveFileResource[] }
    const existing = found.files?.[0]
    if (existing?.id && existing.name) return { id: existing.id, name: existing.name }
    const created = await this.request('/files?fields=' + FOLDER_FIELDS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME, parents: ['root'] }),
    }) as DriveFileResource
    if (!created.id || !created.name) throw new DriveRequestError(500, 'Google Drive не создал папку «Трафарет»')
    return { id: created.id, name: created.name }
  }

  async findProjectFile(folderId: string, projectId: string): Promise<DriveFileInfo | null> {
    const name = projectFileName(projectId).replace(/'/g, "\\'")
    const result = await this.request(
      `/files?q=${encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`)}&fields=files(${FILE_FIELDS})&spaces=drive`,
    ) as { files?: DriveFileResource[] }
    const file = result.files?.[0]
    return file?.id ? toFileInfo(file) : null
  }

  uploadProject(folderId: string, projectId: string, json: string): Promise<DriveFileInfo> {
    return this.uploadRequest('/files', {
      name: projectFileName(projectId),
      parents: [folderId],
      appProperties: {
        [PROJECT_ID_PROPERTY]: projectId,
        [REVISION_PROPERTY]: String(readRevision(json)),
      },
    }, json, null)
  }

  updateProject(fileId: string, projectId: string, json: string, ifMatchEtag: string | null): Promise<DriveFileInfo> {
    return this.uploadRequest(`/files/${encodeURIComponent(fileId)}`, {
      appProperties: {
        [PROJECT_ID_PROPERTY]: projectId,
        [REVISION_PROPERTY]: String(readRevision(json)),
      },
    }, json, ifMatchEtag)
  }

  async downloadProject(fileId: string): Promise<{ json: string; info: DriveFileInfo }> {
    const info = toFileInfo(await this.request(`/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`) as DriveFileResource)
    const json = await this.request(`/files/${encodeURIComponent(fileId)}?alt=media`, {}, 'text') as string
    return { json, info }
  }
}

export function driveScope() {
  return DRIVE_SCOPE
}

function toFileInfo(resource: DriveFileResource): DriveFileInfo {
  return {
    id: resource.id ?? '',
    name: resource.name ?? '',
    md5: resource.md5Checksum ?? null,
    etag: resource.etag ?? null,
    modifiedTime: resource.modifiedTime ?? null,
    size: Number(resource.size ?? 0),
    revision: Number(resource.appProperties?.[REVISION_PROPERTY] ?? -1),
  }
}

function readRevision(json: string): number {
  try {
    const parsed = JSON.parse(json) as { revision?: unknown }
    return typeof parsed.revision === 'number' && Number.isFinite(parsed.revision) ? parsed.revision : 0
  } catch {
    return 0
  }
}
