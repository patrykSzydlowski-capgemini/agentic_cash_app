# CashSync — Master Architecture & Specification Document

> **Источник:** Конспект и систематизация материалов из архива `OneDrive_2026-09-22.zip`  
> (`CashSync_Architecture_Document.pdf` v0.1 Draft, `CashAppPOC.pptx`, `CashAppSync.pptx`, `CashAppPOC_onepager 2026.06.pptx`, а также схемы ERD и архитектуры в формате Draw.io).  
> **Проект:** Capgemini Poland | SAP AI PoC-s (Agentic Cash Application)  
> **Стек:** SAP BTP · S/4HANA Cloud (ABAP Cloud / RAP) · SAP Build · Python / TypeScript AI Agents · Generative AI Hub / SAP AI Core

---

## 1. Назначение и Бизнес-контекст (Purpose & Business Case)

### 1.1. Бизнес-проблема
Ручная разноска входящих платежей (Manual Cash Application) — это медленный, подверженный человеческим ошибкам процесс, приводящий к высокому объему неразнесенных платежей (unapplied cash), задержкам закрытия дебиторской задолженности (DSO) и операционным рискам.

### 1.2. Решение (Agentic AI Solution)
Мультиагентная AI-система на базе SAP BTP, автоматизирующая процесс полного цикла (End-to-End):
1. **Retrieval (Поиск):** Автоматический сбор платежных авизо (remittances) и банковских выписок из почты, порталов и файловых хранилищ.
2. **Extraction (Извлечение):** Извлечение структурированных атрибутов (плательщик, сумма, валюта, дата, номера инвойсов) с помощью SAP DOX / GenAI.
3. **Matching (Сопоставление):** Интеллектуальное сопоставление с открытыми позициями в ERP (SAP S/4HANA Cloud).
4. **Posting & Review (Разноска и обработка исключений):** Автоматический клиринг (Auto-posting) при однозначном совпадении и эскалация человеку (Human-in-the-Loop) только при спорных случаях.

### 1.3. Целевые метрики и KPI (Benefits)
- **-40% E2E Workflow AHT saving:** Ускорение обработки входящих платежей.
- **-20% Reduction in Unapplied Cash:** Снижение объема зависших платежей, уменьшение безнадежных долгов и утечки выручки.
- **>90% Accuracy:** Высокая точность извлечения и сопоставления.
- **KPI проекта:** Auto matching rate, Auto posting rate, Reduction in manual effort.

---

## 2. Многоуровневая архитектура системы (Layer Responsibilities)

Архитектура состоит из 5 ключевых слоев:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. External Data Sources (Источники данных)                            │
│    Bank Portal · Customer Portal · GMB · Oracle Tx · NACHA / Email     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Банковские выписки, PDF-авизо)
┌───────────────────────────────────▼────────────────────────────────────┐
│ 2. AI Agent Layer (SAP BTP - Cloud Foundry / Kyma Runtime)             │
│    - Search Agent (Intake, классификация файлов)                       │
│    - Extract Agent (SAP DOX / GenAI extraction)                        │
│    - Validation / Matching Agent (Сопоставление с ERP)                 │
│    - Decision Agent (Применение правил уверенности / порогов)          │
│    * LLM Backend: SAP Generative AI Hub / SAP AI Core / Claude         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Staging Data & Match Proposals
┌───────────────────────────────────▼────────────────────────────────────┐
│ 3. Integration & Staging Layer (SAP BTP)                               │
│    - SAP HANA Cloud / SQLite: Staging-таблицы (Bank lines, Remittances)│
│    - SAP Destination Service & Connectivity Service (HD0_BAS, GenAI)   │
│    - SAP Cloud Identity Services (XSUAA / IAS)                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
          ┌─────────────────────────┴────────────────────────┐
          │ OData V4                                         │ Tasks / Approval
┌─────────▼────────────────────────┐       ┌─────────────────▼──────────┐
│ 4. SAP S/4HANA Cloud             │       │ 5. User Interface (SAP UI) │
│    - ABAP Cloud / RAP            │       │    - SAP Build Work Zone   │
│    - Open Items API (Read)       │◄──────┤    - SAP Build Apps / UI5  │
│    - applyCash RAP Action (Post) │       │      (CashSync Dashboard)  │
│    - FI-AR Cash Clearing         │       │    - SAP Build Process     │
│                                  │       │      Automation (Queue)    │
└──────────────────────────────────┘       └────────────────────────────┘
```

### Описание слоев:
1. **External Sources:** Внешние, доступные только для чтения источники (почта, SFTP, клиентские и банковские порталы).
2. **AI Agent Layer:** Оркестрация на Python / Node.js CAP. Забирает документы, распознает данные, сопоставляет с дебиторкой ERP, применяет политики уверенности.
3. **Integration & Staging:** Промежуточное хранение результатов агентов в staging-базе (в BTP). Сырые документы и логи агентов НЕ засоряют S/4HANA.
4. **SAP S/4HANA Cloud (System of Record):** Первичное хранилище открытых позиций (`OpenItem`), результатов разноски и финансовой проводки. Авторизационный барьер.
5. **SAP Build / UI5 Shell:** Интерфейс оператора (Payment Queue / Dashboard) и воркфлоу согласования спорных позиций.

---

## 3. Топология и роли автономных AI-агентов

| Агент | Основная функция | Технологии / API | Результат работы |
|---|---|---|---|
| **1. Search Agent** | Мониторинг почты/порталов, забор файлов, первичная классификация (выписка vs авизо). | Mailbox, SFTP, S3, Event Mesh | Создание записей `BANK_STATEMENT_LINE` и `REMITTANCE` в staging. |
| **2. Extract Agent** | Извлечение заголовка и табличных позиций платежа (плательщик, сумма, дата, инвойсы). | SAP DOX, GenAI Fallback (LLM Hub / Gemini / Claude) | Заполнение `REMITTANCE_ITEM` + расчет `extractionConfidence` (0.00-1.00). |
| **3. Validation / Matching Agent** | Сопоставление извлеченных данных с реальными открытыми позициями ERP (точное, нечеткое, по суммам). | S/4HANA Open Items OData API, Semantic Matcher | Создание `MATCH_RESULT` / `ProposedMatches` со статусом (`full`, `partial`/`toBeChecked`, `noMatch`) и `matchScore`. |
| **4. Decision & Posting Agent** | Применение бизнес-правил порогов уверенности. Авто-постинг или маршрутизация оператору. | SAP Destination, RAP `applyCash` Action, Build Workflow | Автоматический вызов клиринга либо создание `MANUAL_TASK` для оператора. |

---

## 4. Процессы взаимодействия (Process Flows)

### Flow 1: Автоматическая разноска — Happy Path (Unambiguous Match)
1. В систему поступает платежное авизо (PDF) или банковская выписка.
2. **Search Agent** регистрирует документ в staging.
3. **Extract Agent** извлекает плательщика, сумму и ссылки на инвойсы (`extractionConfidence >= 0.6`).
4. **Validation Agent** запрашивает открытые позиции в S/4HANA.
5. При **полном совпадении (Full Match: 100%, 1.00)**:
   - Совпадают номер счета/инвойса, плательщик и сумма.
   - Агент вызывает экшен `applyCash` (RAP) напрямую через OData/Destination.
   - Документ клиринга проводится в FI-AR без участия оператора.

### Flow 2: Ручная верификация — Exception Path (Human-in-the-Loop)
1. Если совпадение **частичное (Partial: ~50-60%)**, **не найдено (No Match: 0%)** или **низкая уверенность извлечения (< 0.60)**:
   - Автоматическая разноска блокируется.
   - Создается запись со статусом `needsReview` (в S/4HANA — `ManualTask` / `MATCH_RESULT` со статусом `pending`).
   - Задача появляется в очереди оператора (SAP Build Process Automation / CashSync Payment Queue).
2. Оператор анализирует обоснование AI (`rationale`), открытую позицию и сумму расхождения (`variance_amount`).
3. Действия оператора:
   - **Approve (Согласовать):** Запускает тот же самый экшен `applyCash` в S/4HANA.
   - **Reject (Отклонить):** Задача закрывается со статусом `rejected`, дело эскалируется в Cash Team для ручного контакта с контрагентом.

---

## 5. Модель данных (Core Data Entities & ERD)

Детальная схема базируется на диаграмме `cashsync_er_diagram.drawio`:

### А. Слой Staging (BTP / HANA Cloud / Staging DB)
- **`BANK_STATEMENT_LINE`**: `line_id` (PK), `source_id` (FK), `value_date`, `amount`, `payer_name`, `reference_text`, `raw_file_ref`.
- **`REMITTANCE`**: `remittance_id` (PK), `source_id` (FK), `agent_run_id` (FK), `received_at`, `extraction_status`, `raw_file_ref`.
- **`REMITTANCE_ITEM`**: `item_id` (PK), `remittance_id` (FK), `invoice_id_extracted`, `vendor_name_extracted`, `amount_extracted`, `confidence`.
- **`AGENT_RUN`**: `run_id` (PK), `agent_type_id` (FK), `started_at`, `ended_at`, `status`, `records_processed`, `summary_message`.
- **`AGENT_DEFINITION`**: `agent_type_id` (PK), `agent_type`, `display_name`, `description`.
- **`SOURCE_SYSTEM`**: `source_id` (PK), `source_name`, `category`, `connector_type`.

### Б. Слой System of Record (S/4HANA Cloud / ABAP Cloud RAP)
- **`OPEN_ITEM`**: `open_item_id` (PK), `company_code`, `customer_account`, `customer_name`, `invoice_amount`, `currency`, `clearing_status`.
- **`MATCH_RESULT`**: `match_id` (PK), `open_item_id` (FK), `bank_line_id` (FK), `remittance_item_id` (FK), `agent_run_id` (FK), `match_status` (`full`, `partial`, `noMatch`), `matched_amount`, `variance_amount`, `source_label`, `action_required`, `review_status`.
- **`MANUAL_TASK`**: `task_id` (PK), `match_id` (FK), `assigned_to`, `priority`, `status`, `comments`.

### В. Слой CAP / UI (`poc.cashapp` в текущем приложении)
- **`Payments`**: Заголовок входящего платежа (`payer`, `amount`, `currency`, `valueDate`, `references`, `extractionConfidence` / эффективный AI Score, `status`).
- **`ProposedMatches`**: Кандидаты сопоставления (`payment_ID`, `openItemId`, `companyCode`, `customerAccount`, `amount`, `matchStatus`, `matchScore`, `rationale`, `reviewStatus`, `postingId`, `documentNumber`).
- **`IngestionLog`**: Лог классификации документа (`source`, `subject`, `filename`, `classificationDecision`, `classificationReason`).

---

## 6. Ключевые архитектурные принципы (Design Decisions)

1. **Единый путь разноски (Single Posting Path):**
   - Как автоматическая разноска агентом, так и ручное подтверждение оператором дергают **один и тот же** механизм — RAP Action `applyCash` (или `postClearing` в нашем сервисе). Агенты не обходят бизнес-логику ERP.
2. **Разделение Staging и System of Record:**
   - Сырые PDF, нераспознанный текст и промежуточные гипотезы хранятся в BTP Staging (HANA Cloud / SQLite). В S/4HANA попадают только валидированные результаты матчинга и документы проводки.
3. **RAP как барьер целостности и авторизации:**
   - Все проверки прав, блокировки драфтов и проводка главной книги выполняются на стороне ABAP Cloud / S/4HANA.
4. **Единый контур исключений (Unified Exception Funnel):**
   - Все виды исключений (частичное совпадение, не найдена позиция, низкая уверенность распознавания) направляются в одну очередь `ManualTask`, а не плодят разрозненные процессы.

---

## 7. Политика уверенности AI и интерпретация порогов (Confidence & Threshold Policy)

### Разделение понятий уверенности:
1. **Extraction Confidence (Уверенность извлечения текста):**
   - Оценивает качество считывания PDF моделью (DOX / LLM). Если текст четкий, уверенность равна `1.00` (100%).
   - Порог отсечения: `LOW_CONFIDENCE_THRESHOLD = 0.60`. Если уверенность < 0.60, сопоставление с ERP не запускается, платеж сразу уходит на ручной разбор (`needsReview`).
2. **Match Score / Confidence (Уверенность сопоставления с ERP):**
   - Оценивает, насколько извлеченный платеж соответствует реальной открытой позиции в S/4HANA:
     - **1.00 (100%):** Совпал номер счета в S/4HANA, совпал плательщик, совпала сумма.
     - **0.50 - 0.65 (~50-60%):** Частичная оплата (например, 1800 EUR из 3000 EUR) или совпадение только по плательщику без четкого счета.
     - **0.00 (0%):** Инвойс или плательщик отсутствует в S/4HANA (как в случае старого образца Acme Corp, который отсутствовал в реальной ERP).
3. **Отображение в UI (Эффективный AI Score):**
   - В списке `Payments` колонка «Pewność AI» отражает **результирующую уверенность решения**:
     - Если документ не имеет совпадений в S/4HANA, результирующий скор равен **0%** (`< 60%`), а статус — **`needsReview`**.
     - Недопустимо показывать оператору "Pewność AI: 100%" при статусе `needsReview` из-за отсутствия матчинга с ERP.
