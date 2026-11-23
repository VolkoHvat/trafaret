import { useState } from 'react'
import { AlertTriangle, Cloud, CloudOff, KeyRound, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { StudioDialog } from './UI'
import { DRIVE_FOLDER_NAME } from '../lib/sync/types'
import type { SyncStatus } from '../lib/sync/types'
import type { CloudSyncApi } from '../hooks/useCloudSync'

function statusText(status: SyncStatus, online: boolean): { tone: 'ok' | 'warn' | 'bad' | 'wait'; text: string } {
  switch (status.state) {
    case 'disabled':
      return { tone: 'warn', text: 'Синхронизация недоступна в этой среде' }
    case 'needs-setup':
      return { tone: 'warn', text: 'Синхронизация не настроена — укажите параметры ниже' }
    case 'needs-sign-in':
      return { tone: 'warn', text: 'Требуется вход в Google-аккаунт' }
    case 'pending':
      return { tone: 'wait', text: 'Локальные изменения ждут отправки…' }
    case 'offline':
    case 'error':
      if (!online) return { tone: 'bad', text: 'Нет сети — синхронизация приостановлена, повторим автоматически' }
      if (status.state === 'error') return { tone: 'bad', text: status.message }
      return { tone: 'bad', text: 'Соединение потеряно' }
    case 'syncing':
      return { tone: 'wait', text: 'Синхронизация с облаком…' }
    case 'synced': {
      const time = new Date(status.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      return { tone: 'ok', text: `Синхронизировано · ${time}` }
    }
    case 'downloaded': {
      const time = new Date(status.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      return { tone: 'ok', text: `Облачная версия применена · ${time}` }
    }
    case 'conflict':
      return { tone: 'bad', text: 'Проект изменён здесь и в облаке одновременно' }
  }
}

export function CloudDialog({ open, onOpenChange, cloud, projectId }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  cloud: CloudSyncApi
  projectId: string
}) {
  const { status, online } = cloud
  const tone = statusText(status, online)
  const busy = status.state === 'syncing'
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)

  // Сброс полей при каждом открытии диалога (корректировка состояния при рендере).
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) { setClientId(''); setClientSecret('') }
  }

  const nativeNeedsSetup = cloud.authKind === 'native' && !cloud.authConfigured
  const showSignIn = cloud.authKind === 'native'
    ? (cloud.authConfigured && !cloud.signedIn)
    : status.state === 'needs-sign-in'
  const showSignOut = cloud.authKind === 'native' ? cloud.signedIn : status.state !== 'needs-sign-in' && cloud.authKind !== 'none'

  const signInLabel = cloud.authKind === 'native' ? 'Войти через приложение' : 'Войти через Google'

  return (
    <StudioDialog open={open} onOpenChange={onOpenChange} title="Облачная синхронизация"
      description={`Проект хранится в видимой папке «${DRIVE_FOLDER_NAME}» вашего Google Drive. Доступ — только к файлам приложения (drive.file).`}>
      <div className="cloud-panel">
        <div className={`cloud-status cloud-status-${tone.tone}`} role="status">
          {tone.tone === 'ok' ? <Cloud size={17} /> : tone.tone === 'wait' ? <RefreshCw size={17} className="cloud-spin" /> : <AlertTriangle size={17} />}
          <span>{tone.text}</span>
        </div>

        {status.state === 'conflict' && cloud.conflict && (
          <div className="cloud-conflict">
            <p className="panel-note">
              Данные не перезаписываются автоматически. Облачная версия изменена
              {cloud.conflict.remoteModifiedTime
                ? ` ${new Date(cloud.conflict.remoteModifiedTime).toLocaleString('ru-RU')}`
                : ' на другом устройстве'}.
              Выберите, какую версию оставить.
            </p>
            <div className="cloud-conflict-actions">
              <button className="export-option" disabled={busy} onClick={() => void cloud.resolveConflict('local')}>
                <strong>Оставить локальную версию</strong>
                <span>Текущее состояние на этом устройстве будет загружено в облако</span>
              </button>
              <button className="export-option" disabled={busy} onClick={() => void cloud.resolveConflict('remote')}>
                <strong>Взять облачную версию</strong>
                <span>Локальный проект будет заменён содержимым из Google Drive</span>
              </button>
            </div>
          </div>
        )}

        {status.state === 'error' && online && (
          <button className="secondary-button full-width" disabled={busy} onClick={() => void cloud.syncNow()}>
            <RefreshCw size={15} />Повторить синхронизацию
          </button>
        )}

        <div className="cloud-actions">
          <button className="accent-button" disabled={busy || status.state === 'disabled' || nativeNeedsSetup} onClick={() => void cloud.syncNow()}>
            <RefreshCw size={15} /><span>Синхронизировать сейчас</span>
          </button>
          {showSignIn && (
            <button className="secondary-button" disabled={busy} onClick={() => void cloud.signIn()}>
              <LogIn size={15} />{signInLabel}
            </button>
          )}
          {showSignOut && (
            <button className="secondary-button" disabled={busy} onClick={() => void cloud.signOut()}>
              <LogOut size={15} />Выйти из аккаунта
            </button>
          )}
        </div>

        {cloud.authError && (
          <p className="cloud-auth-error" role="alert">{cloud.authError}</p>
        )}

        {cloud.authKind === 'none' && (
          <div className="cloud-setup">
            <p className="panel-note">
              В браузере синхронизация работает через ваш Google OAuth Client ID
              (тип «Web application», scope drive.file). В десктопной и мобильной
              версиях «Трафарета» вход выполняется самим приложением — здесь ничего вводить не нужно.
            </p>
            <label className="text-field">
              <span>Google Client ID</span>
              <input value={clientId} onChange={event => setClientId(event.target.value)}
                placeholder="xxxx.apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
            </label>
            <button className="secondary-button" disabled={savingConfig || !clientId.trim()}
              onClick={() => {
                setSavingConfig(true)
                void cloud.saveClientId(clientId.trim()).finally(() => setSavingConfig(false))
              }}>
              <KeyRound size={15} />Сохранить настройку
            </button>
          </div>
        )}

        {cloud.authKind === 'native' && nativeNeedsSetup && (
          <div className="cloud-setup">
            <p className="panel-note">
              Укажите Google OAuth Client ID десктопного приложения (тип «Desktop»,
              scope drive.file). Если Client создан как «Web application» и Google
              требует secret — заполните и второе поле. Значения сохраняются
              локально приложением (userData/sync-config.json), не в браузере.
            </p>
            <label className="text-field">
              <span>Google Client ID</span>
              <input value={clientId} onChange={event => setClientId(event.target.value)}
                placeholder="xxxx.apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
            </label>
            <label className="text-field">
              <span>Client Secret (только если требуется)</span>
              <input value={clientSecret} onChange={event => setClientSecret(event.target.value)}
                type="password" placeholder="GOCSPX-…" autoComplete="off" spellCheck={false} />
            </label>
            <button className="secondary-button" disabled={savingConfig || !clientId.trim()}
              onClick={() => {
                setSavingConfig(true)
                void cloud.saveNativeConfig({ clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined })
                  .finally(() => setSavingConfig(false))
              }}>
              <KeyRound size={15} />Сохранить в приложении
            </button>
          </div>
        )}

        {cloud.authKind === 'native' && !nativeNeedsSetup && (
          <p className="panel-note">Вход выполняется через приложение ({window.trafaretNative?.platform === 'android' ? 'Android' : 'Windows'}): системный браузер откроет страницу Google, токен хранится зашифрованным в профиле приложения.</p>
        )}

        <div className="cloud-meta">
          <span><i />ID проекта: {projectId}</span>
          {!online && <span className="cloud-offline-mark"><CloudOff size={13} />нет сети</span>}
        </div>
      </div>
    </StudioDialog>
  )
}
