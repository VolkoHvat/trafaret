# Release Notes — v1.1.0

Выпуск **Трафарета 1.1** — бесплатной автономной студии тату-линворка. Разработано командой «Кир».

Статус: подготовлено к публикации. Windows-установщик и Android APK собраны и проверены. Android APK подписан новым release-ключом; обновление поверх v1.0 с другой подписью потребует удаления старой версии.

## Файлы

| Платформа | Файл | Размер, байт | SHA-256 |
|---|---|---|---|
| Windows 10/11 x64 | `Trafaret-Windows-x64.exe` | 110 620 809 | `2942c5c18f2648196d918097f5d7ca816568c198d0632527a10d06f5c5edc214` |
| Android 7.0+ | `Trafaret-Android.apk` | 4 180 011 | `3318aa9552cc3e6d0ded75027926b8a2c13c3b52fc5adcdf9a6054c53f7cedad` |

Проверка хеша (Windows, PowerShell): `Get-FileHash .\Trafaret-Windows-x64.exe -Algorithm SHA256`
Проверка хеша (Linux/macOS): `sha256sum Trafaret-Android.apk`

Исходники: [github.com/VolkoHvat/trafaret](https://github.com/VolkoHvat/trafaret). Предполагаемый тег: `v1.1.0`.

## Мета-данные Android APK

- applicationId: `ru.trafaret.studio`
- versionCode: `2`, versionName: `1.1.0`
- minSdk: 24 (Android 7.0), targetSdk: 36
- Подпись: APK Signature Scheme v2/v3
- Сертификат подписи (SHA-256): `d8c85326755621dc544e58c70a9bf1f5335b41beb1aa20689a3ced12033badd3`
- Подпись новая и не совпадает с v1.0: перед установкой нужно удалить предыдущую версию.

Windows-сборка не имеет коммерческой кодовой подписи: SmartScreen может показать предупреждение при запуске установщика.

## Новое в v1.1

- **Vector control points**: редактирование узлов pen-path и freehand vector-штрихов, выбор ближайшего узла, поддержка трансформированных объектов и точное Undo.
- **Line width redraw**: изменение толщины выбранной векторной линии без изменения глобальной кисти, с Undo/Redo.
- **Crash recovery**: маркер незавершённой сессии, диалог восстановления после сбоя и защита аварийной копии от перезаписи до выбора пользователя.
- **Predicted stroke**: короткое предсказание только в preview, без предсказанных точек в документе или истории.
- **Nondestructive filters**: grayscale, contrast, threshold и invert для raster, vector и image-слоёв без изменения исходных пикселей и объектов.
- **Print color modes**: печать в миллиметрах с режимами color, grayscale и stencil.
- **Глубокие модули движка**: `HistoryStore`, `geometry`, `StrokeSession`, `Compositor`.
- **Исправления**: границы дуги, общий бюджет undo/redo, восстановление конфликтов синхронизации, метаданные пакета и Windows-артефакта.
- **Кроссплатформенные проверки и сборка**: Windows-совместимость аудитов, NSIS, Capacitor и Gradle.

## Проверки

- Unit-тесты: **121/121 PASS** в 18 файлах; `lint`, `build`, `desktop:typecheck`: **PASS**.
- Production regression: **8/8 PASS**.
- Advanced regression: **7/7 PASS**, включая control points, line width redraw, crash recovery, nondestructive filters и print modes.
- Media regression: **3/3 PASS**.
- StrictMode regression: **PASS**.
- Runtime A/B/C и latency-замер E: **PASS**; в финальном прогоне p50 16,30 мс, p95 18,40 мс.
- Electron: **PASS** в режимах default и disable-gpu: sandbox/security, 10 диагностик, pen/palm/pinch, без ошибок и внешних запросов.
- Windows NSIS: **собран успешно**. Android release APK: **собран и подписан успешно**, versionCode 2 / versionName 1.1.0.

## Что не проверено (NOT_TESTED)

- Реальные Wacom / WinTab / Windows Ink и физический дигитайзер.
- Физический touchscreen / GPU устройства.
- Принтер и бумага.
- Реальный Google Drive с учётными данными.
- Реальный запуск Windows-установщика и установка APK на Android-устройство.

Диагностика проверяет API-слой браузера и Electron; это не сертификация драйверов, оборудования или физической печати.

---

Разработано командой «Кир» · [Все выпуски](https://github.com/VolkoHvat/trafaret/releases)
