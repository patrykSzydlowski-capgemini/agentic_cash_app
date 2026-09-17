namespace poc.cash;

using { cuid, managed } from '@sap/cds/common';

entity OpenItem {
  key OpenItemId       : String(36);
      CompanyCode      : String(4);
      CustomerAccount  : String(10);
      CustomerName     : String(100);
      InvoiceAmount    : Decimal(15, 2);
      InvoiceAmountCurr: String(3);
      ClearingStatus   : String(20);
      PostingDate      : Date;
      DocumentDate     : Date;
      matches          : Association to many MatchResult on matches.open_item = $self;
}

entity SourceSystem {
  key source_id      : String(36);
      source_name    : String(100);
      category       : String(50);
      connector_type : String(50);
      bankLines      : Association to many BankStatementLine on bankLines.source = $self;
      remittances     : Association to many Remittance on remittances.source = $self;
}

entity BankStatementLine {
  key line_id        : String(36);
      source         : Association to SourceSystem;
      value_date     : Date;
      amount         : Decimal(15, 2);
      payer_name     : String(100);
      reference_text : String(255);
      raw_file_ref   : String(255);
      matches        : Association to many MatchResult on matches.bank_line = $self;
}

entity Remittance {
  key remittance_id  : String(36);
      source         : Association to SourceSystem;
      agent_run      : Association to AgentRun;
      received_at    : Timestamp;
      extraction_status: String(20);
      raw_file_ref   : String(255);
      items          : Composition of many RemittanceItem on items.remittance = $self;
}

entity RemittanceItem {
  key item_id        : String(36);
      remittance     : Association to Remittance;
      invoice_id_extracted  : String(50);
      vendor_name_extracted : String(100);
      amount_extracted      : Decimal(15, 2);
      confidence            : Decimal(5, 2);
      matches        : Association to many MatchResult on matches.remittance_item = $self;
}

entity MatchResult {
  key match_id        : String(36);
      open_item       : Association to OpenItem;
      bank_line       : Association to BankStatementLine;
      remittance_item : Association to RemittanceItem;
      agent_run       : Association to AgentRun;
      match_status    : String(20);
      matched_amount  : Decimal(15, 2);
      variance_amount : Decimal(15, 2);
      confidence      : Decimal(5, 2);
      review_reason   : String(500);
      source_label    : String(50);
      action_required : Boolean;
      review_status   : String(20);
      tasks           : Association to many ManualTask on tasks.match = $self;
}

entity ManualTask {
  key task_id        : String(36);
      match          : Association to MatchResult;
      assigned_to    : String(100);
      priority       : String(20);
      status         : String(20);
      comments       : String(500);
}

entity AgentDefinition {
  key agent_type_id  : String(36);
      agent_type     : String(50);
      display_name   : String(100);
      description    : String(255);
      runs           : Association to many AgentRun on runs.agent_type = $self;
}

entity AgentRun {
  key run_id           : String(36);
      agent_type       : Association to AgentDefinition;
      batch_run_id     : String(36);
      started_at       : Timestamp;
      ended_at         : Timestamp;
      status           : String(20);
      records_processed: Integer;
      summary_message  : String(500);
      matches          : Association to many MatchResult on matches.agent_run = $self;
      remittances       : Association to many Remittance on remittances.agent_run = $self;
}