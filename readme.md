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
- `srv/genai/orchestration-client.ts` — SAP AI Core / Generative AI Hub
  wrapper. Inert unless `CASH_AI_ENABLED=true` (with a configured AI Core
  binding); otherwise it throws `IntegrationUnavailableError` instead of
  silently mocking.
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
  OData entities with UI annotations.
- `MatchResult` gained `confidence` and `review_reason`; `ingestAgentMatch`
  now persists both.

## Checks and production build

```sh
npm test                 # ten tests: HTTP + agents + clearing client
npm run typecheck        # regenerate CDS types, then check active backend/tests
npm run typecheck:all    # whole tree including scripts
npm run build:server     # CAP production build -> gen/srv
npm run test:built       # rebuild, then ten HTTP tests against compiled JS
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

## Enabling real AI

The pipeline runs on explicit local mocks by default. To use real AI through
SAP AI Core / Generative AI Hub (orchestration, via `@sap-ai-sdk/orchestration`):

1. Create an AI Core service instance/key in BTP (or use an existing one) and
   copy `.env.example` to `.env` (git-ignored). Fill `AICORE_SERVICE_KEY` with
   the full service-key JSON and set `CASH_AI_ENABLED=true`.
2. Restart the server (`npm run dev`). The SDK picks the credentials up
   automatically; model/resource-group defaults can be overridden with
   `AICORE_MODEL` / `AICORE_RESOURCE_GROUP`.
3. Call `processPaymentDocument` with a real PDF (base64) — extraction and the
   fuzzy payer-resolution step now go through Generative AI Hub. Mock mode
   remains the default whenever `CASH_AI_ENABLED` is unset/false.

On Cloud Foundry, bind the AI Core instance to the app instead of using `.env`;
the SDK resolves the binding itself. Never commit `.env`, service keys or
tokens.

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
  `mta.yaml`). XSUAA, approuter and MTA deployment are separate tasks; nothing
  was deployed.
- The dependency installation reported audit findings (1 low / 17 moderate /
  34 high / 11 critical). No automatic or forceful audit fixes were applied;
  review them separately with `npm audit`.

## References

- [CAP TypeScript](https://cap.cloud.sap/docs/node.js/typescript)
- [CDS Typer and build integration](https://cap.cloud.sap/docs/tools/cds-typer)
- [CAP deployment build](https://cap.cloud.sap/docs/guides/deploy/build)
- [SAP Cloud SDK](https://sap.github.io/cloud-sdk/docs/js/overview)
- [SAP AI SDK orchestration](https://sap.github.io/ai-sdk/docs/js/orchestration)
