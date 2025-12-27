export enum RejectReason {
	Unknown = 0xff,
	NotSupportTypeS = 0x01,
	NotSupportTypeP = 0x02,
	TransactionNotOpen = 0x03,
	NotSelected = 0x04,
}
