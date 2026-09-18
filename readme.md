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
- `srv/genai/openai-compatible-client.ts` — OpenAI-compatible chat client
  aimed at OpenRouter (any compatible endpoint via `OPENROUTER_BASE_URL`).
  Inert unless `CASH_AI_ENABLED=true` with `OPENROUTER_API_KEY`; otherwise it
  throws `IntegrationUnavailableError` instead of silently mocking. Default
  model is configurable with `OPENROUTER_MODEL`; verify current availability,
  PDF/file-input support and pricing in the OpenRouter catalog.
- `srv/s4/open-items-client.ts` — destination-backed S/4 read adapter
  (`HD0_BAS` by default, `S4_DESTINATION_NAME` to override). Requires
  `CASH_S4_ENABLED=true`; rejects paginated responses instead of matching on
  partial data. Local pipeline runs read from SQLite `poc.cash.OpenItem`.
- `srv/s4/clearing-client.ts` — posting client with injected HTTP layer;
  disabled unless `CASH_S4_ENABLED=true`. Unit-tested in
  `test/clearing-client.test.ts`.
- `scripts/run-extraction-fixtures.ts`, `scripts/run-matching-fixtures.ts` —
  manual fixture runners against `test-fixtures/remittance-samples/`.
  `scripts/mail-read.ts` — IMAP mailbox diagnostic (needs a MAIL destination;
  review before pointing it at a real mailbox).
- New unbound action `CashSyncService.processPaymentDocument(pdfBase64)`:
  extracts (mock provider by default), matches against local open items, and
  persists `poc.cashapp.Payments` + `ProposedMatches`, exposed as read-only
  OData entities with UI annotations. Runnable against a running dev server
  with `npm run ai:process` (see the AI connection guide below).
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

По умолчанию используется явный локальный mock. Реальный провайдер включается
только при `CASH_AI_ENABLED=true`. Провайдер выбирается `CASH_AI_PROVIDER`:
`openrouter` (по умолчанию, OpenAI-совместимый клиент, нацеленный на
OpenRouter) либо `aicore` (SAP AI Core / AI Hub Orchestration — оставлен
переключаемой альтернативой). Ошибка выбранного live-провайдера никогда не
подменяется mock-результатом.

### Быстрый старт: OpenRouter — вставить ключ и запустить

1. Создайте API-ключ на <https://openrouter.ai/keys>.
2. В **корне репозитория** скопируйте шаблон и вставьте ключ в `.env`
   (файл игнорируется Git; ключ — только в этот файл, не в `.env.example`):
   ```sh
   cp .env.example .env
   ```
   Затем откройте `.env` и приведите строки к виду:
   ```env
   CASH_AI_ENABLED=true
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
3. Запустите проект и проверьте подключение:
   ```sh
   npm run dev        # терминал 1 — сервер на http://localhost:4004
   npm run ai:check   # терминал 2 — отправляет fixture PDF в OpenRouter
   npm run ai:process # терминал 2 — полный цикл: извлечение -> матчинг -> печать результатов
   ```
   `ai:check` печатает `Live extraction via openrouter succeeded` при успехе.
   `ai:process` вызывает action `processPaymentDocument` на запущенном сервере
   и печатает извлечённый платёж и предложенные матч-результаты (результаты
   сохраняются в `Payments` / `ProposedMatches`). Другой PDF можно передать
   аргументом: `npm run ai:process -- путь/к/файлу.pdf`.
4. Дальше обычная работа: `npm run dev` + UI на
   <http://localhost:4004>; данные кампании видны на
   `/odata/v4/cash-sync/Payments` и `/odata/v4/cash-sync/ProposedMatches`.

Обе проверки могут передать внешнему провайдеру содержимое документа и вызвать
расходы по аккаунту; запускайте их только осознанно. Содержимое документа и
ключ в консоль не печатаются. Для отключения live-вызовов верните
`CASH_AI_ENABLED=false` и перезапустите сервер — pipeline вернётся к явным
mock-результатам (нулевая уверенность, без разрешения плательщика).

### Если что-то не подключилось

| Симптом | Причина | Что сделать |
| --- | --- | --- |
| 503 `AI is disabled` | `CASH_AI_ENABLED` не `true` | поставьте `true` в `.env`, перезапустите сервер |
| 503 `OPENROUTER_API_KEY is missing` | ключ не вставлен / пустой `.env` | вставьте ключ в `.env` в корне репозитория |
| `AI provider request failed (401)` / `(403)` | неверный или просроченный ключ | создайте новый ключ на openrouter.ai/keys |
| ошибка 401/403 даже с новым ключом в `.env` | старый `OPENROUTER_API_KEY` экспортирован в терминале — переменные окружения имеют приоритет над `.env` | `unset OPENROUTER_API_KEY` (или откройте новый терминал) и перезапустите сервер |
| `AI provider request failed (402)` | нет кредитов / исчерпана квота модели | пополните баланс или возьмите модель `:free` |
| `AI provider request failed (404)` | модель недоступна | выберите другую в каталоге OpenRouter |
| `Cannot reach http://localhost:4004` | сервер не запущен | сначала `npm run dev` |

### Локально: SAP AI Core / AI Hub (опция)

Установите/привяжите SAP AI Core по официальной инструкции и укажите:

```env
CASH_AI_ENABLED=true
CASH_AI_PROVIDER=aicore
AICORE_MODEL=имя-доступной-модели
AICORE_RESOURCE_GROUP=default
AICORE_SERVICE_KEY='{"clientid":"...","clientsecret":"...","url":"...","serviceurls":{"AI_API_URL":"..."}}'
```

`AICORE_SERVICE_KEY` — полный JSON service key в одну строку. Не добавляйте его
в `.env.example`, Git, `mta.yaml` или MTAR. Вместо локального service key можно
использовать `cds bind`/hybrid profile. В Cloud Foundry предпочтительна нативная
привязка AI Core: SDK сам читает binding из `VCAP_SERVICES`.

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

- Live AI and S/4 calls stay disabled by default (`CASH_AI_ENABLED` /
  `CASH_S4_ENABLED`). Without them the pipeline uses the explicit local mocks
  from `srv/agents/integration-mocks.ts` (zero confidence, no payer
  resolution) — never presented as real results.
- `postClearing` posts sequentially without durable per-item progress; a
  failure mid-batch can duplicate already-posted items on retry. It is not
  reachable without `CASH_S4_ENABLED=true`.
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
