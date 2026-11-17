import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ru.trafaret.studio',
  appName: 'Трафарет',
  webDir: 'dist',
  android: {
    // Приложение обязано работать офлайн: ассеты подаются локальным сервером Capacitor.
    allowMixedContent: false,
  },
}

export default config
