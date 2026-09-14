namespace ZAC_OPENITEMS_MOC_O4;

entity zac_openitems_moc {
  key OpenItemId        : String(20);
      CompanyCode       : String(10);
      CustomerAccount   : String(20);
      CustomerName      : String(100);
      InvoiceAmount     : Decimal(15,2);
      InvoiceAmountCurr : String(5);
      ClearingStatus    : String(10);
      PostingDate       : Date;
      DocumentDate      : Date;
}
