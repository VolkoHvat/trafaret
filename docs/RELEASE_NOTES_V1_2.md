# Release Notes — v1.2.0

Выпуск **Трафарета 1.2** — бесплатной автономной студии тату-линворка. Разработано командой «Кир».

Статус: подготовлено к публикации. Windows-установщик и подписанный Android APK собраны и проверены. Подпись Android совпадает с v1.1; при обновлении с v1.0 сначала удалите старую версию, затем установите v1.1 или v1.2.

## Файлы

| Платформа | Файл | Размер, байт | SHA-256 |
|---|---|---|---|
| Windows 10/11 x64 | `Trafaret-Windows-x64.exe` | 110 627 689 | `abc8cc861f7b23aaa0fb08c81cfdcce06e11c322c47a5e2640a36d3afc599713` |
| Android 7.0+ | `Trafaret-Android.apk` | 4 188 203 | `32922f8e2d51af39af990d7cacbf57329d4cdfcd015692d565f817af98a2f8e8` |

Проверка хеша (Windows, PowerShell): `Get-FileHash .\Trafaret-Windows-x64.exe -Algorithm SHA256`
Проверка хеша (Linux/macOS): `sha256sum Trafaret-Android.apk`

Исходники: [github.com/VolkoHvat/trafaret](https://github.com/VolkoHvat/trafaret). Тег: `v1.2.0`.

## Мета-данные Android APK

- applicationId: `ru.trafaret.studio`
- versionCode: `3`, versionName: `1.2.0`
- minSdk: 24 (Android 7.0), targetSdk: 36
- Подпись: APK Signature Scheme v2/v3
- Сертификат подписи (SHA-256): `d8c85326755621dc544e58c70a9bf1f5335b41beb1aa20689a3ced12033badd3`

Windows-сборка не имеет коммерческой кодовой подписи: SmartScreen может показать предупреждение при запуске установщика.

## Новое в v1.2

- **Кривые Безье и управляющие ручки**: Alt+drag узла создаёт кривую; ручки редактируются отдельно и сохраняются в проекте и SVG.
- **Сегменты**: Alt+click вставляет узел с de Casteljau-разбиением, double-click удаляет его.
- **Профиль толщины по узлам**: Alt+колесо меняет множитель от ×0,1 до ×4, отдельная толщина сегментов в Canvas и SVG.
- **Множественный выбор и групповые трансформации**: Shift+click, общий bounding box, move/scale/rotate группы с одной Undo-записью.
- **Flattened PSD**: импорт и экспорт RGB/RGBA 8-bit, raw и RLE. Слои, маски и эффекты PSD не поддерживаются.
- **ABR presets**: базовые descriptor-пресеты; bitmap tips, textures и dynamics не поддерживаются.
- **ICC**: экспорт PNG с валидным профилем sRGB или Display P3, включая преобразование пикселей в P3. Произвольные ICC-профили и CMYK не поддерживаются.
- **Plugin API**: безопасные декларативные JSON-манифесты для кисти, симметрии, трафарета, фильтров и векторных путей; JavaScript/eval и сетевые вызовы не поддерживаются.

Возможности v1.1 сохранены: vector control points, line width redraw, crash recovery, predicted stroke, nondestructive filters и print color modes.

## Проверки

- Unit-тесты: **134/134 PASS** в 22 файлах; `lint`, `build`, `desktop:typecheck`: **PASS**.
- Production regression: **8/8 PASS**.
- Advanced regression: **15/15 PASS**, включая Безье, сегменты, профиль, группы, PSD, ABR, ICC и plugin API.
- Media regression: **3/3 PASS**.
- StrictMode regression: **PASS**.
- Runtime A/B/C и latency-замер E: **PASS**.
- Electron: **PASS** в режимах default и disable-gpu: sandbox/security, 10 диагностик, pen/palm/pinch, без ошибок и внешних запросов.
- Windows NSIS: **собран успешно**. Android release APK: **собран и подписан успешно**, versionCode 3 / versionName 1.2.0.

## Что не проверено (NOT_TESTED)

- Реальные Wacom / WinTab / Windows Ink и физический дигитайзер.
- Физический touchscreen / GPU устройства.
- Принтер и бумага.
- Реальный Google Drive с учётными данными.
- Реальный запуск Windows-установщика и установка APK на Android-устройство.

Диагностика проверяет API-слой браузера и Electron; это не сертификация драйверов, оборудования или физической печати.

---

Разработано командой «Кир» · [Все выпуски](https://github.com/VolkoHvat/trafaret/releases)
