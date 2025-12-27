import { SecsItemType } from "../enums/SecsItemType.js";

export abstract class Secs2BodyBase {
	abstract toBytes(): ArrayBuffer;
	abstract fromBytes(bytes: ArrayBuffer): void;
	abstract serializedSml(): string;
	protected buildSecs2Format(
		item: SecsItemType,
		valueBytes: ArrayBuffer,
	): ArrayBuffer {
		const length = valueBytes.byteLength;
		const formatCode = item;

		const result: ArrayBuffer = new ArrayBuffer();
		let headerLength: number;

		// if (length >= 65535) {
		// 	headerLength = 4;
		// 	result = new ArrayBuffer(headerLength + length);
		// 	result[0] = formatCode | 0x03;
		// }
	}
}
