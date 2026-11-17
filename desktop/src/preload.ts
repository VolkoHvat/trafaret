import { contextBridge, ipcRenderer } from 'electron'
import { SyncAuthError } from '../../src/lib/sync/types'

const NOT_SIGNED_IN = 'NOT_SIGNED_IN'

function toSyncError(error: unknown): SyncAuthError {
  const message = error instanceof Error ? error.message : String(error)
  if (message === NOT_SIGNED_IN) return new SyncAuthError('not-signed-in')
  return new SyncAuthError('unknown', message)
}

contextBridge.exposeInMainWorld('trafaretNative', {
  platform: 'electron',
  auth: {
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('trafaret:auth:isConfigured'),
    getSessionState: (): Promise<'active' | 'signed-out' | 'not-configured'> =>
      ipcRenderer.invoke('trafaret:auth:getSessionState'),
    getConfig: (): Promise<{ clientId: string; clientSecret: string }> =>
      ipcRenderer.invoke('trafaret:auth:getConfig'),
    setConfig: (config: { clientId: string; clientSecret?: string }): Promise<boolean> =>
      ipcRenderer.invoke('trafaret:auth:setConfig', config),
    signIn: (): Promise<boolean> => ipcRenderer.invoke('trafaret:auth:signIn'),
    signOut: (): Promise<void> => ipcRenderer.invoke('trafaret:auth:signOut'),
    getLastError: (): Promise<string | null> => ipcRenderer.invoke('trafaret:auth:getLastError'),
    getAccessToken: async (scopes: string[]): Promise<string> => {
      try {
        return await ipcRenderer.invoke('trafaret:auth:getAccessToken', scopes)
      } catch (error) {
        throw toSyncError(error)
      }
    },
    onAuthChange: (listener: (signedIn: boolean) => void): (() => void) => {
      const handler = (_event: unknown, signedIn: boolean) => listener(signedIn)
      ipcRenderer.on('trafaret:auth:changed', handler)
      return () => ipcRenderer.removeListener('trafaret:auth:changed', handler)
    },
  },
})
