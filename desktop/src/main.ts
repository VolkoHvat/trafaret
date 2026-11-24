import { app, BrowserWindow, dialog, ipcMain, net, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { randomBytes, webcrypto } from 'node:crypto'
import { betaFeedbackUrl } from '../../src/lib/beta-feedback-url'
import { AuthService } from './auth-service'
import { ConfigStore, defaultConfigPath } from './config'
import { isAllowedNavigation } from './navigation'
import { TokenStore } from './token-store'

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const auth = new AuthService({
  configStore: new ConfigStore(defaultConfigPath(app.getPath('userData'))),
  tokenStore: new TokenStore(join(app.getPath('userData'), 'tokens.json'), {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: value => new Uint8Array(safeStorage.encryptString(value)),
    decryptString: buffer => safeStorage.decryptString(Buffer.from(buffer)),
  }),
  scope: DRIVE_FILE_SCOPE,
  fetchImpl: net.fetch,
  openExternal: url => shell.openExternal(url),
  randomBytes: length => new Uint8Array(randomBytes(length)),
  digestSha256: async input => new Uint8Array(await webcrypto.subtle.digest('SHA-256', input)),
})

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#11130f',
    autoHideMenuBar: true,
    title: 'Трафарет',
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  })

  // Никакого удалённого контента и всплывающих окон: внешние ссылки — в системный браузер.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === betaFeedbackUrl) void shell.openExternal(betaFeedbackUrl).catch(() => console.warn('Не удалось открыть форму GitHub'))
    return { action: 'deny' }
  })
  // Навигация только по allowlist: собственный dist/index.html и (в dev) vite origin.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, {
      appPath: app.getAppPath(),
      devOrigin: app.isPackaged ? null : 'http://localhost:3000',
    })) event.preventDefault()
  })

  // The page blocks unload while autosave is pending or stopped. Without this handler Electron
  // silently cancels the close, so the window seems frozen; ask the user instead.
  mainWindow.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: 'Трафарет',
      message: 'Рисунок ещё не сохранён',
      detail: 'Автосохранение не завершено или остановлено. Чтобы ничего не потерять, вернитесь и нажмите «Сохранить документ».',
      buttons: ['Вернуться', 'Закрыть без сохранения'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (choice === 1) event.preventDefault()
  })

  void mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'))
  mainWindow.on('closed', () => { mainWindow = null })
}

function forwardAuthState(signedIn: boolean) {
  mainWindow?.webContents.send('trafaret:auth:changed', signedIn)
}

app.whenReady().then(() => {
  auth.onChange(forwardAuthState)

  ipcMain.handle('trafaret:auth:isConfigured', () => auth.isConfigured())
  ipcMain.handle('trafaret:auth:getSessionState', () => auth.getSessionState())
  ipcMain.handle('trafaret:auth:getConfig', () => auth.getConfig())
  ipcMain.handle('trafaret:auth:setConfig', (_event, raw: unknown) => auth.saveConfig(raw))
  ipcMain.handle('trafaret:auth:signIn', () => auth.signIn())
  ipcMain.handle('trafaret:auth:signOut', () => auth.signOut())
  ipcMain.handle('trafaret:auth:getAccessToken', (_event, scopes: string[]) => auth.getAccessToken(scopes))
  ipcMain.handle('trafaret:auth:getLastError', () => auth.getLastError())

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch(error => {
  console.error('Не удалось запустить приложение:', error)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
