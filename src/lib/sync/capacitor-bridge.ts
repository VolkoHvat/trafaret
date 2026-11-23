/**
 * Мост Capacitor → существующий контракт window.trafaretNative.
 * На Android нативный плагин TrafaretAuth реализует OAuth через Play Services;
 * здесь его методы подмапываются на тот же auth-контракт, что и в Electron.
 * В браузере и Electron модуль ничего не делает.
 */

export interface AndroidAuthPlugin {
  isConfigured(): Promise<{ value: boolean }>
  getAccessToken(opts: { scopes: string[] }): Promise<{ token: string }>
  signIn(): Promise<{ signedIn: boolean }>
  signOut(): Promise<void>
  getSessionState(): Promise<{ state: 'active' | 'signed-out' | 'not-configured' }>
  getLastError(): Promise<{ error: string | null }>
  addListener(eventName: 'authChanged', listenerFunc: (event: { signedIn: boolean }) => void): Promise<{ remove: () => void }>
}

/** Чистая обёртка plugin → контракт trafaretNative.auth (покрыта тестами). */
export function wrapAndroidAuth(plugin: AndroidAuthPlugin): {
  platform: 'android'
  auth: {
    isConfigured(): Promise<boolean>
    getAccessToken(scopes: string[]): Promise<string>
    signIn(): Promise<boolean>
    signOut(): Promise<void>
    getSessionState(): Promise<'active' | 'signed-out' | 'not-configured'>
    getLastError(): Promise<string | null>
    onAuthChange(listener: (signedIn: boolean) => void): () => void
  }
} {
  return {
    platform: 'android',
    auth: {
      isConfigured: async () => (await plugin.isConfigured()).value,
      getAccessToken: async (scopes: string[]) => (await plugin.getAccessToken({ scopes })).token,
      signIn: async () => (await plugin.signIn()).signedIn,
      signOut: () => plugin.signOut(),
      getSessionState: async () => (await plugin.getSessionState()).state,
      getLastError: async () => (await plugin.getLastError()).error,
      onAuthChange: listener => {
        let remove = () => {}
        void plugin.addListener('authChanged', event => listener(event.signedIn)).then(handle => { remove = () => void handle.remove() })
        return () => remove()
      },
    },
  }
}

export async function installAndroidBridge(): Promise<void> {
  if (typeof window === 'undefined' || window.trafaretNative) return
  const { Capacitor } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'android') return
  const { registerPlugin } = await import('@capacitor/core')
  const plugin = registerPlugin<AndroidAuthPlugin>('TrafaretAuth')
  window.trafaretNative = wrapAndroidAuth(plugin)
}
