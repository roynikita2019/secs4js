import { describe, expect, it } from "vitest";
import { HsmsMessage } from "./HsmsMessage.js";
import { HsmsControlType } from "./enums/HsmsControlType.js";
import { RejectReason } from "./enums/RejectReason.js";
import { SelectStatus } from "./enums/SelectStatus.js";

describe("HsmsMessage", () => {
	it("roundtrips a Data message header", () => {
		const original = new HsmsMessage(
			1,
			2,
			true,
			null,
			0x11223344,
			10,
			0,
			HsmsControlType.Data,
		);
		const parsed = HsmsMessage.fromBuffer(original.toBuffer());
		expect(parsed.sType).toBe(HsmsControlType.Data);
		expect(parsed.stream).toBe(1);
		expect(parsed.func).toBe(2);
		expect(parsed.wBit).toBe(true);
		expect(parsed.systemBytes).toBe(0x11223344);
		expect(parsed.deviceId).toBe(10);
	});

	it("encodes SelectRsp status in byte3", () => {
		const req = HsmsMessage.selectReq(0x01020304);
		const rsp = HsmsMessage.selectRsp(req, SelectStatus.Success);
		const parsed = HsmsMessage.fromBuffer(rsp.toBuffer());
		expect(parsed.sType).toBe(HsmsControlType.SelectRsp);
		expect(parsed.func).toBe(SelectStatus.Success);
		expect(parsed.systemBytes).toBe(0x01020304);
	});

	it("sets RejectReq byte2 based on reason", () => {
		const req = new HsmsMessage(
			0,
			0,
			false,
			null,
			0xaabbccdd,
			0xffff,
			2,
			HsmsControlType.SeparateReq,
		);

		const rejectP = HsmsMessage.rejectReq(req, RejectReason.NotSupportTypeP);
		expect(rejectP.stream).toBe(2);
		expect(rejectP.func).toBe(RejectReason.NotSupportTypeP);

		const rejectS = HsmsMessage.rejectReq(req, RejectReason.NotSupportTypeS);
		expect(rejectS.stream).toBe(HsmsControlType.SeparateReq);
		expect(rejectS.func).toBe(RejectReason.NotSupportTypeS);

		const parsed = HsmsMessage.fromBuffer(rejectS.toBuffer());
		expect(parsed.sType).toBe(HsmsControlType.RejectReq);
		expect(parsed.stream).toBe(HsmsControlType.SeparateReq);
		expect(parsed.func).toBe(RejectReason.NotSupportTypeS);
	});
});
