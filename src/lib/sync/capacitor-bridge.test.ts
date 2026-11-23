import { describe, expect, it } from 'vitest'
import { wrapAndroidAuth } from './capacitor-bridge'
import type { AndroidAuthPlugin } from './capacitor-bridge'

type Listener = (event: { signedIn: boolean }) => void

function makePlugin(overrides: Partial<AndroidAuthPlugin> = {}) {
  const listeners: Listener[] = []
  const plugin: AndroidAuthPlugin = {
    isConfigured: async () => ({ value: true }),
    getAccessToken: async ({ scopes }) => ({ token: `tok:${scopes.join(',')}` }),
    signIn: async () => ({ signedIn: true }),
    signOut: async () => {},
    getSessionState: async () => ({ state: 'active' }),
    getLastError: async () => ({ error: null }),
    addListener: async (_name, listener) => {
      listeners.push(listener)
      return { remove: () => {} }
    },
    ...overrides,
  }
  return { plugin, listeners }
}

describe('wrapAndroidAuth', () => {
  it('маппирует методы плагина на контракт trafaretNative.auth', async () => {
    const { plugin } = makePlugin()
    const bridge = wrapAndroidAuth(plugin)
    expect(bridge.platform).toBe('android')
    expect(await bridge.auth.isConfigured()).toBe(true)
    expect(await bridge.auth.getSessionState()).toBe('active')
    expect(await bridge.auth.getLastError()).toBeNull()
    expect(await bridge.auth.signIn()).toBe(true)
    await bridge.auth.signOut()
  })

  it('пробрасывает scopes в getAccessToken', async () => {
    const { plugin } = makePlugin()
    const bridge = wrapAndroidAuth(plugin)
    expect(await bridge.auth.getAccessToken(['https://www.googleapis.com/auth/drive.file']))
      .toBe('tok:https://www.googleapis.com/auth/drive.file')
  })

  it('пробрасывает события authChanged в listener и возвращает отписку', async () => {
    const { plugin, listeners } = makePlugin()
    const bridge = wrapAndroidAuth(plugin)
    const seen: boolean[] = []
    const unsubscribe = bridge.auth.onAuthChange(signedIn => seen.push(signedIn))
    await Promise.resolve()
    expect(listeners).toHaveLength(1)
    for (const listener of listeners) listener({ signedIn: true })
    expect(seen).toEqual([true])
    unsubscribe()
  })

  it('честно отдаёт ошибки нативного слоя', async () => {
    const { plugin } = makePlugin({ getLastError: async () => ({ error: 'Нет сети' }) })
    const bridge = wrapAndroidAuth(plugin)
    expect(await bridge.auth.getLastError()).toBe('Нет сети')
  })
})
