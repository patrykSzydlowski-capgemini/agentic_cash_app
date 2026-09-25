# poc_cash — Cash Matching Dashboard

CAP Node.js 10 with a TypeScript backend and local SQLite. The Fiori Elements
List Report/Object Page in `app/cashsync-ui` remains JavaScript.

The payment-processing workflow (extraction → matching → review) was imported
from [AlexanderX/ts-agentic-poc](https://github.com/AlexanderX/ts-agentic-poc)
(Apache-2.0, see `LICENSE`). Its agents, GenAI orchestration client, S/4 open
items/clearing clients, fixture scripts and architecture docs are now part of
this project; the `poc.cashapp` CDS namespace (`db/payments.cds`) holds its
payment/proposal model. See `docs/upstream/` for the original project docs.

## Development

Use Node.js 24 (verified: 24.17.0) and npm.

```sh
npm install
npm run dev
```

`dev` starts CAP watch with an in-memory SQLite database and CSV fixtures.
Data resets on restart; your existing `db.sqlite` is not modified. Open the CAP
launch page at http://localhost:4004 and follow the UI link, or request
`/odata/v4/cash-sync/MatchResult`.

`npm run watch` respects the existing database configuration instead. If that
SQLite file has no schema, reads fail; do not confuse this with a TypeScript
error. Database deployment requires explicit approval and is not part of this
integration.

## Imported workflow

- `srv/agents/extraction-agent.ts` / `matching-agent.ts` — extraction and
  matching logic from ts-agentic-poc; AI calls are injectable for tests.
- `srv/genai/orchestration-client.ts` — SAP AI Core / AI Hub Orchestration
  client (**primary** AI path, `CASH_AI_PROVIDER=aicore`). Connects via
  BTP Destination `GenAI` or service key / CF binding.
- `srv/genai/openai-compatible-client.ts` — OpenAI-compatible chat client
  aimed at OpenRouter (any compatible endpoint via `OPENROUTER_BASE_URL`).
  **Unused alternative** (`CASH_AI_PROVIDER=openrouter`). Default
  model is configurable with `OPENROUTER_MODEL`; verify current availability,
  PDF/file-input support and pricing in the OpenRouter catalog.
- `srv/s4/open-items-client.ts` — destination-backed S/4 read adapter
  (`HD0_BAS` by default, `S4_DESTINATION_NAME` to override). Rejects
  paginated responses instead of matching on partial data. Falls back to SQLite cache if unreachable.
- `srv/s4/clearing-client.ts` — posting client with injected HTTP layer;
  posts to S/4 via `@sap-cloud-sdk/http-client`. Unit-tested in
  `test/clearing-client.test.ts`.
- `scripts/run-extraction-fixtures.ts`, `scripts/run-matching-fixtures.ts` —
  manual fixture runners against `test-fixtures/remittance-samples/`.
  `scripts/mail-read.ts` — IMAP mailbox diagnostic (needs a MAIL destination;
  review before pointing it at a real mailbox).
- New unbound actions `CashSyncService.uploadPayment(fileName, fileContent)`
  (UI-facing upload entry mirroring the reference workflow: raw PDF bytes in,
  stored Payment row out) and `processPaymentDocument(pdfBase64)`:
  extract (mock provider by default), match against local open items, and
  persist `poc.cashapp.Payments` + `ProposedMatches`, exposed as read-only
  OData entities with UI annotations. Runnable against a running dev server
  with `npm run ai:process` (see the AI connection guide below).
- `Payments` below extraction confidence 0.6 go straight to `needsReview`
  with no candidates persisted (matching skipped on shaky data).
- Bound `approve()` / `reject()` on `ProposedMatches`: approve posts clearing
  via `postClearing` (SAP message severity ≥ 3 → stays `approved` with
  `postingError`, else `posted`). Reject is a pure `rejected` flip.
- UI: Fiori Elements LROP on `/Payments` (matching queue, Object Page with
  payment details + proposed-matches facet), approve/reject buttons on
  ProposedMatches rows, PDF upload via controller extension, legacy
  `/MatchResult` list retained read-only.
- `MatchResult` gained `confidence` and `review_reason`; `ingestAgentMatch`
  now persists both.

## Checks and production build

```sh
npm test                 # offline HTTP, agents, providers and CF-helper tests
npm run typecheck        # regenerate CDS types, then check active backend/tests
npm run typecheck:all    # whole tree including scripts
npm run build:server     # CAP production build -> gen/srv
npm run test:built       # rebuild, then repeat tests against compiled server JS
mbt build -t gen --mtar mta.mtar   # MTA archive (needs gen/srv)
```

`npm run cds:types` generates ignored `@cds-models` declarations from CDS.
`cds.build.tasks` in `package.json` pins the typescript and nodejs tasks —
each `cds build` wipes `gen/`, so the production artifacts are produced by one
run. Output: `gen/srv`. `npm start` is the production `cds-serve` entrypoint
from the built `gen/srv` package.

`test:built` creates a temporary copy under ignored `_out/`, adds only fixture
CSVs, and runs the compiled service with plain Node.js. Both test modes use
disposable in-memory databases and stop their server after the tests.

## Подключение ИИ: пошаговая инструкция

По умолчанию используется реальный провайдер ИИ (SAP AI Core / AI Hub).
Провайдер выбирается переменной `CASH_AI_PROVIDER`:
`aicore` (по умолчанию — SAP AI Core / AI Hub Orchestration, основной путь)
либо `openrouter` (OpenAI-совместимый клиент, нацеленный на OpenRouter —
неиспользуемая альтернатива). Ошибка выбранного live-провайдера никогда не
подменяется mock-результатом.

### Способ 1 (Рекомендуемый): Подключение через Cloud Foundry (`cds bind`)

Этот способ позволяет не хранить секреты в файле `.env`, а динамически связывать локальное приложение с облачными сервисами в SAP BTP.

1. **Авторизуйтесь в Cloud Foundry через SSO**:
   ```sh
   cf login -a https://api.cf.us10-001.hana.ondemand.com --sso
   ```
   - Перейдите по одноразовой ссылке в браузере, скопируйте временный код аутентификации и вставьте его в терминал.
   - Выберите организацию: `Capgemini Polska Sp. z o.o._capgemini-tech-5-ut5z6aqv`
   - Выберите пространство (space): `CashSync`

2. **Проверьте целевое окружение и доступные сервисы**:
   ```sh
   cf target
   cf services
   ```
   В выводе должны присутствовать инстансы `ai-core-srv` (план `extended`) и `dest-service` (план `lite`).

3. **Свяжите сервисы с локальным проектом (`cds bind`)**:
   Выполните команды в корне проекта:
   ```sh
   cds bind aicore -2 ai-core-srv:ai-core-key
   cds bind destinations -2 dest-service:dest-service-key
   ```
   Эти команды сохранят привязки в локальный файл `.cdsrc-private.json` под профилем `[hybrid]`.

4. **Сгенерируйте TypeScript-модели**:
   ```sh
   npm run cds:types
   ```
   *(Создает модели `@cds-models`, обязательные для работы бэкенда)*.

5. **Запустите локальный сервер в гибридном режиме**:
   ```sh
   cds watch --profile hybrid
   # или сокращенно:
   cds w --profile hybrid
   ```
   *(Либо через npm: `npm run dev`, который запускает watch с in-memory базой).*

   При старте с `--profile hybrid` CAP автоматически:
   - Подключает облачные сервисы:
     ```text
     resolving cloud service bindings...
     bound aicore to cf managed service ai-core-srv:ai-core-key
     bound destinations to cf managed service dest-service:dest-service-key
     ```
   - Загружает TypeScript-хендлер: `impl: 'srv/cat-service.ts'`.

6. **Проверьте работу AI и пайплайна**:
   ```sh
   npm run ai:check   # тестовый запрос к SAP AI Core (gemini-2.5-flash)
   npm run ai:process # тестовый сквозной прогон извлечения и матчинга
   ```
   При успешном подключении `ai:check` выведет:
   ```text
   bound aicore to cf managed service ai-core-srv:ai-core-key
   bound destinations to cf managed service dest-service:dest-service-key
   Live extraction via aicore [model: gemini-2.5-flash] succeeded...
   ```

---

### Способ 2 (Автономный): SAP AI Core — прямой service key в `.env`

Если нет возможности авторизоваться через CF CLI:

1. Получите SAP AI Core service key по официальной инструкции
   ([подключение SAP SDK](https://sap.github.io/ai-sdk/docs/js/connecting-to-ai-core)).
2. В **корне репозитория** скопируйте шаблон и вставьте ключ в `.env`:
   ```sh
   cp .env.example .env
   ```
   Затем откройте `.env` и приведите строки к виду:
   ```env
   CASH_AI_PROVIDER=aicore
   AICORE_MODEL=gemini-2.5-flash
   AICORE_RESOURCE_GROUP=default
   AICORE_SERVICE_KEY='{"clientid":"...","clientsecret":"...","url":"...","serviceurls":{"ai_api_url":"..."}}'
   ```
   `AICORE_SERVICE_KEY` — полный JSON service key в одну строку. Не добавляйте его в `.env.example`, Git, `mta.yaml` или MTAR.
3. Запустите проект:
   ```sh
   npm run dev
   npm run ai:check
   ```

---

### Работа в интерфейсе (Fiori Elements UI)

После запуска `npm run dev`:
- Откройте <http://localhost:4004> и перейдите в UI `cashsync-ui`.
- Вкладка **Payments** отображает очередь платежей.
- Кнопка **«Wgraj awizo (PDF)»** позволяет загрузить одно или несколько awizo (например, `sample-awizo-50pct.pdf` или `sample-awizo-100pct.pdf`), отправляет файл в экшен `uploadPayment`, запускает AI-пайплайн и сохраняет результат матчинга.
- Кнопка **«Przetestuj próbki dokumentów»** запускает пакетную валидацию всех 3 тестовых образцов.

### Если что-то не подключилось

| Симптом | Причина | Что сделать |
| --- | --- | --- |
| 501 `Service "CashSyncService" has no handler for "uploadPayment"` | Не сгенерированы `@cds-models` | Выполните `npm run cds:types` |
| 503 `Destination not found` / `AICORE binding missing` | Сервер запущен без профиля `hybrid` | Запускайте через `cds w --profile hybrid` |
| `AI provider request failed (401)` / `(403)` | Неверный или отозванный сервисный ключ | Выполните `cds bind` заново (см. Способ 1) |
| `Cannot reach http://localhost:4004` | Сервер не запущен | Запустите `cds w --profile hybrid` |

### Альтернатива: OpenRouter (не используется)

Создайте API-ключ на <https://openrouter.ai/keys> и укажите:

```env
CASH_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-ВАШ_КЛЮЧ
```

`OPENROUTER_MODEL` можно не указывать — по умолчанию берётся
`nvidia/nemotron-3-ultra-550b-a55b:free` (бесплатная модель из каталога
OpenRouter). Любую другую модель можно посмотреть в
[каталоге OpenRouter](https://openrouter.ai/models) и указать как
`OPENROUTER_MODEL=provider/model-id`. PDF OpenRouter принимает от любой
модели: если модель не умеет читать файлы сама, OpenRouter распарсит PDF
на своей стороне ([документация](https://openrouter.ai/docs/guides/overview/multimodal/pdfs)).

### Cloud Foundry: тот же OpenRouter key без ключа внутри MTAR

`mta.yaml` связывает backend с **существующим** user-provided service
`poc-cash-ai`. В нём CF хранит ключ и предоставляет его приложению через
`VCAP_SERVICES`. Повторные MTA-деплои используют ту же привязку; ключ не
копируется в архив.

1. Проверьте целевое окружение (особенно `org` и `space`):
   ```sh
   cf target
   ```
2. При первом развёртывании создайте UPS из ключа в корневом `.env`:
   ```sh
   npm run ai:cf:create
   ```
   Скрипт снова покажет CF target и продолжит только после ввода точной фразы
   `create poc-cash-ai`. Он переносит только `OPENROUTER_API_KEY` через временный
   JSON-файл с правами `0600`, не печатает ключ и удаляет файл после операции.
3. При ротации ключа измените `.env`, затем явно выполните:
   ```sh
   npm run ai:cf:update
   cf restart poc-cash-srv
   ```
   Для update требуется фраза `update poc-cash-ai`; скрипт откажется менять
   managed service или сервис другого типа.
4. Соберите свежий backend и MTAR:
   ```sh
   npm run build:server
   mbt build -t gen --mtar poc-cash.mtar
   unzip -l gen/poc-cash.mtar | grep -E '(^|/)(\.env|default-env\.json|credentials\.json)$' \
     && echo 'STOP: secret-like file found' || echo 'No known secret files listed'
   ```
5. Только после проверки архива разверните его:
   ```sh
   cf deploy gen/poc-cash.mtar
   ```
   Не используйте `cf env poc-cash-srv` для диагностики в общих логах/чатах:
   вывод может содержать `VCAP_SERVICES`. Проверяйте только имена binding:
   `cf services` и `cf service poc-cash-ai`.

`npm run ai:cf:create/update` изменяют Cloud Foundry и поэтому не запускаются
автоматически ни при `npm install`, ни при build/deploy. Если UPS отсутствует,
MTA deploy предсказуемо завершится ошибкой вместо запуска без credentials.

Для SAP AI Core в CF замените OpenRouter UPS на нативный existing-service
binding отдельной MTA-конфигурацией; не помещайте SAP service key в properties.
Подключение SAP SDK: <https://sap.github.io/ai-sdk/docs/js/connecting-to-ai-core>.
CF user-provided services: <https://docs.cloudfoundry.org/devguide/services/user-provided.html>.
Bindings/`VCAP_SERVICES` в CAP: <https://cap.cloud.sap/docs/node.js/cds-connect#vcap-services>.
MTA existing services: <https://help.sap.com/docs/SAP_HANA_PLATFORM/4505d0bdaf4948449b7f7379d24d0f0d/4050fee4c469498ebc31b10f2ae15ff2.html>.

## Known boundaries

- Live AI and S/4 calls are permanently enabled by default. If the remote service is temporarily unreachable,
  the system falls back to cached SQLite data or deterministic evaluation.
- `postClearing` posts sequentially without durable per-item progress; a
  failure mid-batch can duplicate already-posted items on retry.
- `analyzeWithGemini` remains declared without a handler, as before.
- The database is SQLite-only by decision (no HANA/HDI module or resource in
  `mta.yaml`). A Cloud Foundry container filesystem is ephemeral, so this MTA
  scaffold does not provide durable production database storage across restarts.
- Full CF runtime readiness is not proven: approuter packaging/static UI wiring
  and authentication/token forwarding still require a separate end-to-end task.
  The AI binding and archive build can be validated independently; nothing was
  deployed by this change.
- The dependency installation reported audit findings (1 low / 17 moderate /
  34 high / 11 critical). No automatic or forceful audit fixes were applied;
  review them separately with `npm audit`.

## References

- [CAP TypeScript](https://cap.cloud.sap/docs/node.js/typescript)
- [CDS Typer and build integration](https://cap.cloud.sap/docs/tools/cds-typer)
- [CAP deployment build](https://cap.cloud.sap/docs/guides/deploy/build)
- [SAP Cloud SDK](https://sap.github.io/cloud-sdk/docs/js/overview)
- [SAP AI SDK orchestration](https://sap.github.io/ai-sdk/docs/js/orchestration)
