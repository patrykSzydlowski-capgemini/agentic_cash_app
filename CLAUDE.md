# CLAUDE.md — poc_cash (AI Agent Cash Matching Dashboard)

Runtime: CAP Node.js + TypeScript backend (@sap/cds v10 / cds-dk v10) · DB: SQLite local-first (HANA later) · UI: Fiori Elements LROP/OOP (cashsync-ui) · Auth: XSUAA (scaffolded, not bound locally) · No approuter/destinations active locally.

## Project map

- `db/schema.cds` (namespace `poc.cash`): OpenItem, SourceSystem, BankStatementLine, Remittance(+Item), MatchResult, ManualTask, AgentDefinition, AgentRun.
- `srv/cat-service.cds` → `CashSyncService`: OpenItem + MatchResult (+CriticalityCode calc) + `triggerAIAgent` + `ingestAgentMatch`. OpenItem is **local-first** (`poc.cash.OpenItem`); `srv/external/ZAC_OPENITEMS_MOC_O4.cds` kept for reference only.
- `db/data/*.csv`: local seed (OpenItem OP-100x, MatchResult MATCH-00x).
- `app/cashsync-ui`: Fiori Elements LROP on `/MatchResult`; annotations in `app/services.cds`.
- `mta.yaml` / `xs-security.json` / `approuter/xs-app.json`: BTP scaffolding (build ok, deploy only on explicit approval). HANA service binding is a future step (`@cap-js/hana` not yet added).

## Iron rules (always obey)

- CAP/CDS: `search_model` (cds-mcp) FIRST for entity/field/service questions; `search_docs` EVERY TIME before creating/modifying `*.cds` or using CAP APIs / cds CLI. Trust compiled CSN over file reads. Sources of truth: <https://cap.cloud.sap/docs/>.
- Fiori: `list_fiori_apps` before UI work; edits via `list_functionality` → `get_functionality_details` → `execute_functionality`.
- UI5: `get_guidelines` BEFORE writing UI5 code; after changes run `run_ui5_linter` + `run_manifest_validation`.
- HANA: connection resolution `default-env-admin.json > .cdsrc-private.json > .env/VCAP > default-env.json > ~/.hana-cli/default.json`.
- NEVER commit `default-env.json`, service keys, or tokens. `cf deploy` / `cds deploy` / `btp` mutations only after explicit user approval.
- Node ≥20.17 baseline. Test locally (`cds watch`, UI5 lint, Fiori preview) before MTA build. Keep `xs-security.json`, `xs-app.json`, `mta.yaml` consistent after renames.
- Cite sources for SAP-specific claims with markdown links.

## TypeScript scope

- Backend implementation: `srv/cat-service.ts`; UI remains JavaScript.
- `npm run dev`: watch with disposable in-memory SQLite; `npm run watch`: existing DB configuration.
- `npm test` and `npm run test:built`: HTTP tests against source TS and compiled JS respectively.
- `npm run typecheck`: active backend/tests; `npm run typecheck:all`: includes all agents.
- At the user's request, missing GenAI/S4 imports in `srv/agents` are commented out and replaced by explicit mocks in `integration-mocks.ts`. PDF contents are not processed; mock extraction has zero confidence and payer resolution returns no matches. Agents remain disconnected from the service.
- `npm run build:server`: official CAP build with cds-typer; `npm start` is for the built server package.
- Generated model declarations live in ignored `@cds-models`. See README for commands and remaining limitations.

## Standard flows

```bash
npm install
cds watch                      # local run
npx cds build --production     # build ok anytime
mbt build -t gen --mtar mta.tar  # build ok anytime
# deploy ONLY when user says so:
cf login -a <CF_API> --sso; cf target -o <ORG> -s <SPACE>; cf deploy gen/mta.tar
```
