# Project Vision — AI-Assisted Cash Application (Payment Matching) PoC — v2

## 0. One-line pitch
Three focused AI agents run the pipeline end to end with no human in the loop until the review step: **Agent 1 (Ingestion)** watches an AR mailbox (and optionally a bank statement feed) and pulls in new remittance/statement documents on its own; **Agent 2 (Extraction)** reads whatever PDF format shows up and turns it into structured payment data; **Agent 3 (Matching)** matches that data against open items already in S/4HANA Public Cloud and proposes a status. The accountant's job starts at *reviewing and approving* a ready-made queue — not at finding or uploading documents — and approval is what triggers the S/4HANA API call that posts the clearing document.

**What changed from v1:** the accountant no longer uploads the PDF. An ingestion agent does that autonomously by reading the mailbox (and, optionally, a bank statement feed). Manual upload still exists, but only as a fallback for the odd case that never arrives through the normal channel.

---

## 1. Reasoning: why an ingestion *agent*, and what it changes

**Step 1 — Why does fetching the document need to be an agent, not just a scheduled download job?**
A plain script can poll an inbox and grab every attachment — but an AR mailbox also receives invoice queries, dispute emails, marketing, and other noise, and different banks/customers name and format their attachments differently. Deciding *"is this email actually a remittance advice or a bank statement, or is it unrelated correspondence?"* is a classification judgment, not a fixed rule. That's the same reason Agents 2 and 3 exist: wherever a decision requires reading for meaning rather than matching a fixed pattern, an LLM-backed agent generalizes better than hardcoded rules — and it's the same underlying tool-calling pattern already used elsewhere in this design, so it doesn't introduce a new kind of complexity, just a new instance of the same one.

**Step 2 — What does the Ingestion Agent actually do, concretely?**
1. On a schedule, connect to the AR shared mailbox (and, optionally, a bank statement feed) and list new/unread items.
2. For each item, classify it: relevant (remittance advice / bank statement attachment) vs. not.
3. For relevant items, download the attachment (or the statement file) and hand it to the Extraction Agent.
4. Log every item it looked at — including what it decided to ignore and why — so the accountant can audit "did we miss anything" without reading the mailbox themselves.
This keeps the Ingestion Agent's responsibility narrow: *find and fetch the right raw documents.* It doesn't parse payment fields (that's Agent 2's job) or reason about matches (Agent 3's job) — same single-responsibility principle as before, just extended one step further upstream.

**Step 3 — Mailbox and bank statement feed are both "sources," handled the same way.**
Structurally, an email attachment and a bank-delivered statement file are the same thing to the rest of the pipeline: a document that needs to be read. So both are modeled as sources the Ingestion Agent polls, both go through the same Destination-service abstraction used everywhere else in this design (see Step 5), and both hand off to the same Extraction Agent afterward. For the PoC, start with the mailbox only — it's the simpler integration (a single mailbox connection) and, in practice, most remittance advices and many bank statements already arrive as email attachments — and treat the bank statement feed connector as an additive second source once the mailbox path works, not a blocker to getting the PoC running.

**Step 4 — What triggers the pipeline now, if not a human clicking "upload"?**
A lightweight scheduler (an in-process cron inside the CAP app — no extra paid service needed) wakes the Ingestion Agent every few minutes. This keeps the PoC in the free tier and avoids introducing a separate job-scheduling service before it's needed; SAP BTP's managed Job Scheduler service is the natural upgrade if this moves toward production, where you'd want retry/monitoring guarantees an in-process timer doesn't give you.

**Step 5 — How does the mailbox connection fit the "everything outbound goes through Destination service" principle from v1?**
The same way S/4 access does: the mailbox (e.g. Microsoft Graph API for an Exchange Online shared mailbox) is registered as a BTP destination with its own OAuth2 client-credentials setup, and the Ingestion Agent's mailbox tool resolves it through the Destination service rather than hardcoding a connection string. This means swapping mail providers, or adding the bank feed as a second destination, is configuration — not a code change — exactly the same argument that applied to swapping the S/4 sandbox for a real tenant.

**Step 6 — Does this change who approves the S/4 posting, or the matching logic?**
No — Agents 2 and 3, the status model, the hybrid deterministic+LLM matching approach, the human-approval gate before posting, and the Sprint-0 spike on the S/4 write API from v1 are unchanged. This revision only replaces *how a document enters the pipeline*; everything downstream of "a PDF has arrived" is the same as before.

**Step 7 — New risk this introduces, and how it's handled.**
Giving an agent read access to a mailbox is a new trust boundary worth naming explicitly: scope the mailbox connection to read-only, least-privilege access on a dedicated shared AR mailbox (never a personal inbox), never let the agent send/delete/reply, and keep the ingestion log so every access is auditable. This is a standard "grant the agent the minimum permission needed for its one job" precaution, consistent with the human-approval gate already in place for the higher-stakes posting step.

---

## 2. Scope (updated)

**In scope**
- Agent 1 (Ingestion): poll a shared AR mailbox on a schedule, classify attachments as relevant or not, fetch relevant documents, log every decision.
- Agent 2 (Extraction): as in v1 — structured payment data from whatever PDF format arrives.
- Agent 3 (Matching): as in v1 — proposed matches with status and rationale against S/4 open items.
- UI: Open Items list, **Ingestion log** (new — what was found, fetched, or ignored, and when), Matching queue with status badges, Approve/Reject, manual upload as a fallback entry point.
- On approval: call the S/4HANA API to post the clearing document, or fall back to the reviewed-list hand-off into the standard Fiori clearing app if the Sprint-0 spike shows the write API isn't reliably usable on your tenant (unchanged from v1).

**Still out of scope for the PoC**
- Bank statement feed connector (bank statement PDFs arriving other than by email) — planned as an additive second source, not required for the first working version.
- Everything already listed as out-of-scope in v1 (batch statement formats, FX handling, auto-posting without approval, full identity federation).

---

## 3. Architecture

See **`01-architecture-overview.drawio`**.

| Component | Role | Tier |
|---|---|---|
| Scheduler | Wakes the Ingestion Agent periodically | In-process (free — no extra service) |
| **Agent 1 — Ingestion** | Polls mailbox (and optionally bank feed), classifies, fetches relevant documents | Runs inside the CAP service process |
| Agent 2 — Extraction | PDF → structured payment data (unchanged from v1) | Runs inside the CAP service process |
| Agent 3 — Matching | Payment + open items → proposed match & status (unchanged from v1) | Runs inside the CAP service process |
| SAP AI Core / Generative AI Hub | Hosts/orchestrates Claude Sonnet, used by all three agents | BTP trial or 30-day Generative AI Hub trial |
| CAP Service (Node.js/TypeScript) | CDS entities, ingestion log, approval & posting workflow | Cloud Foundry free tier |
| Web UI | Open items, ingestion log, matching queue, approve/reject, manual-upload fallback | Cloud Foundry free tier |
| Persistence | Payments, ProposedMatches, ingestion log, audit trail | SAP HANA Cloud free-tier instance (or SQLite for dev) |
| XSUAA | Authenticates the CAP app | Free for development |
| Destination Service | Resolves mailbox/Graph API, bank feed, S/4 read, and S/4 write — one abstraction for every outbound call | Free/lite plan |
| S/4HANA Public Cloud — read | Customer open items | API Business Hub sandbox now → real tenant later |
| S/4HANA Public Cloud — write | Post clearing document | To validate in Sprint 0 (unchanged risk from v1) |

## 4. End-to-end flow

See **`02-end-to-end-sequence.drawio`**: scheduler triggers the Ingestion Agent → mailbox polled → relevant document classified and fetched → handed to the Extraction Agent → Matching Agent proposes matches → queue shown to the accountant → accountant approves → CAP calls the S/4 clearing API → status updates to Cleared. The accountant's first appearance in the flow is the approval step — everything before that is autonomous.

## 5. Status model

See **`03-status-lifecycle.drawio`** — unchanged from v1 except for a new leading stage, **"Document ingested,"** representing Agent 1's hand-off, ahead of "Payment extracted." Proposed Match statuses (Full / Probable / To be checked / No match) and review statuses (Pending / Approved / Rejected / Posted) are unchanged.

## 6. Suggested project layout (updated)

```
poc-cash-application-agent/
├── app/                          # static SPA: open items, ingestion log, matching queue
├── db/
│   └── schema.cds                # Payments, ProposedMatches, IngestionLog
├── srv/
│   ├── cash-app-service.cds
│   ├── cash-app-service.ts       # handlers: approve, reject, post, manual upload (fallback)
│   ├── scheduler.ts              # in-process cron, triggers the ingestion agent
│   ├── agents/
│   │   ├── ingestion-agent.ts    # Agent 1: mailbox/bank feed -> relevant raw documents
│   │   ├── extraction-agent.ts   # Agent 2: PDF -> structured payment(s)
│   │   └── matching-agent.ts     # Agent 3: payment + open items -> proposed matches
│   ├── connectors/
│   │   ├── mailbox-client.ts     # Graph API via Destination service
│   │   └── bank-feed-client.ts   # optional, added when the second source is in scope
│   ├── s4/
│   │   ├── open-items-client.ts
│   │   └── clearing-client.ts    # Sprint-0 spike lives here
│   └── genai/
│       └── orchestration-client.ts
├── xs-security.json
├── mta.yaml
└── package.json
```

A new entity, `IngestionLog` (timestamp, source, subject/filename, classification decision, linked Payment if fetched), backs the new UI log view.

## 7. Sprint 0 (updated)

1. Everything from v1 §8 (validate the S/4 write API for clearing, confirm the read-side API/communication scenario, decide the fallback).
2. **New:** register the mailbox app (e.g. an Entra ID app registration for Graph API access to the shared AR mailbox) and confirm read-only, least-privilege scopes work end to end through the Destination service before building the rest of the Ingestion Agent around it.

## 8. Risks & mitigations (updated)

All v1 risks still apply. New ones from this revision:

| Risk | Mitigation |
|---|---|
| Ingestion Agent misclassifies an unrelated email as relevant (or misses a real remittance email) | Ingestion log shows every decision, not just the ones it acted on, so misses are auditable; low-confidence classifications route to a "needs manual check" bucket rather than being silently dropped or silently ingested |
| Mailbox access is a new attack surface / trust boundary | Dedicated shared mailbox, read-only least-privilege OAuth scope, no send/delete capability, all access routed and logged through the Destination service |
| Scheduler runs while the CAP app is restarting/scaling on Cloud Foundry, missing a cycle | Low-stakes for a PoC (next poll picks it up); note as a "harden with BTP Job Scheduler" item if this moves toward production |
