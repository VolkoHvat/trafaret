# AGENTS.md — «Трафарет» (команда «Кир»)

Постоянный рабочий контур Kimi Code для проекта «Трафарет». Этот файл обязателен
к выполнению в каждой сессии Kimi Code.

## Проект

Тату-редактор лайнворка: лучший инструмент для tattoo linework. НЕ копировать
подходы из animation/3D/comics редакторов. Ориентиры по движкам см. в
`docs/ENGINE_COMPARISON.md`.

Стек: React 19 + TypeScript + Vite + PWA, Electron (desktop), Capacitor (Android),
Vitest, ESLint, Tailwind, perfect-freehand.

## Источник истины и порядок работы

- GitHub `main` — единственный источник истины.
- Любые новые код, тесты, config или docs-правки выполняются **только через
  Kimi Code**; обход (ручные правки мимо агента) запрещён.
- Проект не конвертировать в другой стек и не создавать вторую proprietary
  копию.
- Работа малыми шагами: маленькое изменение → тест → ревью → коммит.
- Irreversible/destructive действия (удаление данных, force-push, сброс
  истории, перезапись ветки и т.п.) — только с явным согласием пользователя.

## Секреты и диагностика

- Секреты, credentials, keystore, private keys не читать в проект, не
  логировать, не коммитить. При обнаружении случайно попавших секретов —
  сообщить, не коммитить.
- Диагностика процессов только без command lines (например, `ps -o pid,comm`
  без `args`), чтобы не светить секреты в cmdline.

## Обязательные проверки перед завершением любой задачи

Выполнять по порядку:

1. `npm test`
2. `npm run lint`
3. `npm run build`
4. `npm run desktop:typecheck`

Затем — релевантные существующие audit/regression-скрипты:

- `npm run audit:runtime` — runtime-аудит.
- `npm run audit:electron` — аудит Electron-обвязки.
- `npm run audit:production` — продакшн-регрессия.
- `npm run audit:strictmode` — StrictMode-регрессия.
- `node scripts/advanced-regression.mjs` — расширенная регрессия.
- `node scripts/media-regression.mjs` — регрессия медиа.

Выбирать те, что относятся к затронутой области изменения.

## Дисциплина проверок

- Не ослаблять assertions и thresholds, чтобы «пройти» проверку.
- Статус PASS только при реальном доказательстве прогоном.
- Если что-то не проверено — явно помечать NOT_TESTED.

## Архитектурные инварианты (не нарушать)

- Единый формат документа `.tattoo.json` и миграции схемы.
- Canvas и SVG рендер идентичны (Canvas/SVG parity).
- Undo + redo с общим memory budget.
- Все transform/bounds вычисляются из одного модуля geometry.
- Offline-first.
- Конфликты (синхронизация) решает пользователь.
- Токены — только в памяти / native secure storage.
- В Electron сохранять `contextIsolation` и `sandbox` (preload CJS, минимальный
  IPC-поверхность).
- Ассеты runtime — локальные (без внешних CDN на горячем пути).

## Оптимизации

- Перед любой оптимизацией — профиль (замеры), не по догадке.
- Не внедрять tiles / dirty rects / binary snapshots без доказательства
  профилем, что текущего подхода недостаточно.

## Модульность

Не дробить код на shallow helpers. Глубокие модули — history, geometry,
stroke-session, compositor — выделять только отдельными проверенными
изменениями (шаг → тест → ревью → коммит на каждый).

## Текущий следующий шаг

P0 и P1 (`history`, `geometry`, `stroke-session`, `compositor`) завершены с
regression tests. Vector control points, line width redraw и crash recovery
реализованы. Следующий кандидат: predicted stroke из раздела «Что заимствовать»
в `docs/ENGINE_COMPARISON.md`.

Новые функции выполнять отдельными проверенными изменениями по правилам выше.
