# Документация проекта CashSync (Agentic Cash Application)

В этом каталоге собраны все архитектурные документы, спецификации, диаграммы и справочные материалы проекта.

---

## 📑 Основные документы

1. **[Master Architecture & Specs (`ARCHITECTURE_AND_SPECS.md`)](./ARCHITECTURE_AND_SPECS.md)**  
   *Главный документ архитектуры.* Полный конспект и спецификация материалов проекта:
   - Бизнес-проблема, цели и KPI (-40% AHT, -20% Unapplied Cash, >90% точность).
   - 5 архитектурных слоев (External Sources, BTP AI Agents, Staging, S/4HANA Cloud, SAP Build).
   - 4 автономных агента (Search, Extract, Validate/Matching, Decision/Posting).
   - End-to-End процессы: Автоматическая разноска (Happy Path) и Разбор исключений (Human-in-the-Loop).
   - Модель данных (ERD сущностей Staging vs System of Record).
   - Ключевые архитектурные принципы и разделение политик уверенности (Extraction Confidence vs Matching Score).

2. **[Draw.io Архитектурные диаграммы](./)**:
   - **[`cashsync_er_diagram.drawio`](./cashsync_er_diagram.drawio)**: Полная ER-диаграмма сущностей (`OPEN_ITEM`, `MATCH_RESULT`, `MANUAL_TASK`, `REMITTANCE`, `BANK_STATEMENT_LINE`, `AGENT_RUN`).
   - **[`cashsync_reference_architecture_sap_style.drawio`](./cashsync_reference_architecture_sap_style.drawio)**: Референсная архитектура в официальном стиле SAP BTP.
   - **[`Reference architecture CashSync app v1 SAP branded.drawio`](./Reference%20architecture%20CashSync%20app%20v1%20SAP%20branded.drawio)**: Брендированная детальная схема взаимодействия BTP, S/4HANA Cloud и Generative AI Hub / Claude.
   - **[`01-architecture-overview.drawio`](./01-architecture-overview.drawio)**: Общий обзор архитектуры CAP.
   - **[`02-end-to-end-sequence.drawio`](./02-end-to-end-sequence.drawio)**: Sequence-диаграмма пайплайна обработки авизо.
   - **[`03-status-lifecycle.drawio`](./03-status-lifecycle.drawio)**: Жизненный цикл статусов платежей и матчинга.
   - **[`04-sap-style-architecture_1.drawio`](./04-sap-style-architecture_1.drawio)**: SAP BTP ландшафт сервисов.

3. **[Upstream Reference (`upstream/`)](./upstream/)**:
   - `CLAUDE.reference.md`: Справочные правила upstream-проекта.
   - `PROJECT_VISION.md`: Исходное видение проекта `ts-agentic-poc`.
   - `mta.upstream.yaml`: Исходный MTA-манифест.
