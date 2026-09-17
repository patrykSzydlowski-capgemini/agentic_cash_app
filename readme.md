# poc_cash — Cash Matching Dashboard

CAP Node.js 10 with a TypeScript backend and local SQLite. The Fiori Elements
List Report/Object Page in `app/cashsync-ui` remains JavaScript; no UI migration
or changes to the OData model are required for backend TypeScript.

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
migration.

## Checks and production build

```sh
npm test                 # five HTTP tests against the TypeScript server
npm run typecheck        # regenerate CDS types, then check active backend/tests
npm run build:server     # CAP production build, including TypeScript compilation
npm run test:built       # rebuild, then five HTTP tests against compiled JS
npm run typecheck:all    # includes agents using explicit local integration mocks
```

`npm run cds:types` generates ignored `@cds-models` declarations from CDS.
The service uses these declarations for its action payload type. The
`tsconfig.cdsbuild.json` build excludes tests and inactive agents; output is
`gen/srv/srv/cat-service.js`, accompanied by the compiled CAP model and package
files. `npm start` is the production `cds-serve` entrypoint; use it from the built
`gen/srv` package with the required dependencies and database configuration,
not as the development TypeScript launcher.

`test:built` creates a temporary copy under ignored `_out/`, adds only fixture
CSVs (not a second CDS schema), and runs the compiled service with plain Node.js.
The test runner uses tsx, but the compiled **server process does not**. Both test
modes use disposable in-memory databases and stop their server after the tests.

## Known boundaries

- Agents are not wired into the service. Missing GenAI/S4 imports are commented
  out and replaced by explicit local mocks in `srv/agents/integration-mocks.ts`.
  Extraction ignores PDF contents and returns synthetic data with zero confidence;
  payer resolution returns no matches. These are development placeholders, not
  real integrations. `typecheck:all` checks all agents and now passes.
- `analyzeWithGemini` remains declared without a handler, as before. The existing
  `ingestAgentMatch` implementation still ignores `review_reason`.
- The migration fixes the old entity lookup: `cds.entities('poc.cash')` exposes
  the short `MatchResult` key. Actions retain their statuses and confidence > 0.8
  threshold.
- HANA/HDI, XSUAA, approuter and MTA deployment readiness are separate tasks.
  No deployment or cloud binding changes were made.
- The dependency installation reported 61 audit findings. No automatic or
  forceful audit fixes were applied; review them separately with `npm audit`.

## References

- [CAP TypeScript](https://cap.cloud.sap/docs/node.js/typescript)
- [CDS Typer and build integration](https://cap.cloud.sap/docs/tools/cds-typer)
- [CAP deployment build](https://cap.cloud.sap/docs/guides/deploy/build)
