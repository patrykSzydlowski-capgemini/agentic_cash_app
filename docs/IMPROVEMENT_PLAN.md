# План улучшений и рефакторинга: переход от PoC к Enterprise CAP

Документ составлен на основе аудита production-шаблона DHL (`dhl-template-master`) и фиксирует перечень улучшений архитектуры, UI, сборки MTA, package.json и code style для проекта `agentic_cash_app`.

---

## 1. Модуляризация UI-аннотаций (`app/cashsync-ui/annotations/`)
* **Текущее состояние:** Монолитный файл `app/cashsync-ui/annotations.cds` (380+ строк), содержащий аннотации для `Payments`, `MatchResult`, `ProposedMatches` и `OpenItem`.
* **Целевое состояние:** Полноценная модульная структура по аналогии с DHL:
  * `app/cashsync-ui/annotations/index.cds` — агрегатор.
  * `app/cashsync-ui/annotations/payments/` (`entity.cds`, `fields.cds`, `list.cds`, `page.cds`).
  * `app/cashsync-ui/annotations/matches/` (`entity.cds`, `fields.cds`, `list.cds`, `page.cds`).
  * `app/cashsync-ui/annotations/openitems/` (`fields.cds`, `list.cds`).
  * `app/services.cds` ссылается на `annotations/index.cds`.
* **Задачи:**
  1. Создать структуру директорий в `app/cashsync-ui/annotations/`.
  2. Разделить аннотации по зонам ответственности:
     - `entity.cds`: HeaderInfo, Capabilities (DeleteRestrictions, InsertRestrictions, UpdateRestrictions).
     - `fields.cds`: Метки (`@title`, `@Common.Label`), ValueList, TextArrangement.
     - `list.cds`: `UI.LineItem`, `UI.SelectionFields`, `UI.SelectionPresentationVariant`.
     - `page.cds`: `UI.Facets`, `UI.FieldGroup`, `UI.Identification`.
  3. Перенаправить импорт в `app/services.cds`.
  4. Проверить компиляцию CSN через `cds build`.

---

## 2. Явное управление шириной колонок и оформление таблиц
* **Текущее состояние:** Автоматическая ширина колонок `ResponsiveTable`. При длинных текстовых значениях (пояснения AI, обоснования расхождений) верстка плывет, колонки сжимаются.
* **Целевое состояние:** Точное задание ширины каждой колонки через `![@HTML5.CssDefaults]: {width: '...rem'}` в аннотациях `UI.LineItem`.
* **Задачи:**
  1. Добавить `![@HTML5.CssDefaults]: {width: '...rem'}` для полей сущностей `Payments`, `MatchResult`, `OpenItem`:
     - Статусы / критичность: `10rem` - `12rem`.
     - Суммы / валюты: `8rem` - `10rem`.
     - Даты проводки и валютирования: `10rem`.
     - Контрагент / плательщик: `16rem`.
     - Пояснение AI / обоснование: `22rem` - `26rem`.
     - Идентификаторы документов: `12rem` - `14rem`.
  2. Проверить отображение в превью.

---

## 3. Инспектор контекста AI и сырых данных (Custom Section с CodeEditor)
* **Текущее состояние:** Данные авизо, входящие платежные цепочки и сырые ответы нейросети выводятся как плоские строки.
* **Целевое состояние:** Кастомная секция ObjectPage на базе `sap.ui.codeeditor.CodeEditor`, позволяющая просматривать JSON/raw-структуры (результаты работы Gemini, данные открытых позиций из S/4HANA) с подсветкой синтаксиса в раскрывающихся панелях (`sap.m.Panel`).
* **Задачи:**
  1. Создать XML-фрагмент `app/cashsync-ui/webapp/fragments/AIContextViewer.fragment.xml`.
  2. Добавить `sap.ui.codeeditor` в библиотеки `manifest.json`.
  3. Подключить фрагмент в `manifest.json` в `controlConfiguration` для `PaymentsObjectPage` или `MatchResultObjectPage`.
  4. Обеспечить корректное отображение отформатированного JSON/текста.

---

## 4. Стандартизация сборки UI и MTA (`package.json`, `ui5.yaml`)
* **Текущее состояние:** Скрипт `"build:mta"` выполняет ручной `cp -r app/cashsync-ui/webapp/. approuter/resources/` без запуска UI5-бандлера (нет `Component-preload.js`, нет минификации, сырые файлы).
* **Целевое состояние:** Корректный билд UI5 через `@ui5/cli`, сборка `dist/` с `Component-preload.js`.
* **Задачи:**
  1. Добавить скрипт `"build"` в `app/cashsync-ui/package.json` (`ui5 build --clean-dest`).
  2. Обновить `build:mta` в корневом `package.json`, чтобы сначала запускался `npm --prefix app/cashsync-ui run build`, а затем сформированный бандл `dist/` копировался в `approuter/resources`.
  3. Проверить успешное создание `Component-preload.js`.

---

## 5. Улучшения корневого `package.json` и Node/CAP Tooling
* **Текущее состояние:** Отсутствуют декларации приложений `sapux`, пути импортов относительные (`../../`), нет лимита размера тела запросов.
* **Целевое состояние:** 
  - Регистрация приложения в массиве `"sapux": ["app/cashsync-ui"]`.
  - Node.js subpath imports (`#constants`, `#core/*`) в `package.json` и `tsconfig.json`.
  - Аннотация `@cds.server.body_parser.limit: '100mb'` для защиты от `HTTP 413 Payload Too Large` при обработке больших банковских выписок или PDF-документов.
* **Задачи:**
  1. Добавить `"sapux": ["app/cashsync-ui"]` в `package.json`.
  2. Настроить алиасы импортов в `package.json` и `tsconfig.json`.
  3. Настроить лимит парсера тела запроса в CDS-конфигурации.

---

## 6. Централизация констант (`srv/constants/`)
* **Текущее состояние:** В `srv/cat-service.ts` и сопутствующих файлах разбросаны строковые литералы: `'COMPLETED'`, `'PENDING'`, `'MANUAL_REVIEW'`, `'HIGH'`, `'S4_OPENITEM'`, `'S4'`, `'MATCHED'` и т.д.
* **Целевое состояние:** Единый модуль констант `srv/constants/index.ts` с типизированными `enum` / `Object.freeze`.
* **Задачи:**
  1. Создать `srv/constants/index.ts`:
     - `PAYMENT_STATUS`
     - `MATCH_STATUS`
     - `REVIEW_STATUS`
     - `CRITICALITY`
     - `SOURCE_SYSTEM`
     - `AI_MODELS`
  2. Заменить строковые литералы в `srv/cat-service.ts` на импортированные константы.
  3. Запустить `npm run typecheck` и `npm test`.

---

## 7. Структурированное логирование через `cds.log`
* **Текущее состояние:** Вызовы `console.log` и `console.error` без контекста и таймстемпов.
* **Целевое состояние:** Использование встроенного в CAP логгера `const logger = cds.log('cash-sync')` с контекстной информацией (paymentId, matchId, длительность вызова LLM).
* **Задачи:**
  1. Заменить прямые вызовы `console.log`/`console.error` на `logger.info`, `logger.warn`, `logger.error`.
  2. Добавить структурированный контекст к логам вызовов S/4HANA и GenAI Hub.

---

## 8. Стандартизированная обработка ошибок (`ApplicationError`)
* **Текущее состояние:** Выброс обычных `throw new Error(...)` или generic исключений, возвращающих клиенту неинформативные 500-е ошибки.
* **Целевое состояние:** Класс `ApplicationError` в `srv/core/errors/ApplicationError.ts` с полями `code`, `statusCode`, `cause`, `args`, транслирующийся в корректный OData Error Response.
* **Задачи:**
  1. Создать `srv/core/errors/ApplicationError.ts`.
  2. Использовать `ApplicationError` в обработчиках действий (`postToS4`, `triggerAIAgent`, `approveMatch`, `rejectMatch`).

---

## 9. Cloud-Native Health Probes (`/health/live`, `/health/ready`)
* **Текущее состояние:** Отсутствуют стандартные эндпоинты проверки здоровья сервиса.
* **Целевое состояние:** Реализация Liveness и Readiness проб в `srv/server.ts`:
  * `/health/live` — статус сервиса (HTTP 200 `{ status: "UP" }`).
  * `/health/ready` — проверка доступности БД SQLite, конфигурации AI и S/4 назначения.
* **Задачи:**
  1. Создать модуль `srv/core/health/HealthCheck.ts`.
  2. Создать или расширить `srv/server.ts` с хуком `cds.on('bootstrap', ...)`.
  3. Проверить работу эндпоинтов локально.

---

## 10. HTTP-сценарии для тестирования (`test/http/`)
* **Текущее состояние:** Проверка эндпоинтов только через CLI-скрипты.
* **Целевое состояние:** Набор готовых `.http` файлов для VS Code REST Client / SAP CDS:
  * `test/http/Health.http`
  * `test/http/CashSyncService.http`
* **Задачи:**
  1. Создать директорию `test/http/`.
  2. Подготовить запросы для проверки сервисов, действий и health-проб.
