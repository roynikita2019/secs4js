import { SecsItemType } from "../enums/SecsItemType.js";
import {
	createAsciiItem,
	createBinaryItem,
	createBooleanItem,
	createF4Item,
	createF8Item,
	createI1Item,
	createI2Item,
	createI4Item,
	createI8Item,
	createListItem,
	createU1Item,
	createU2Item,
	createU4Item,
	createU8Item,
} from "./Secs2ItemFactory.js";

export abstract class AbstractSecs2Item<T = unknown> {
	constructor(
		public readonly type: SecsItemType,
		protected readonly _value: T,
	) {}

	get value(): T {
		return this._value;
	}

	/**
	 * Returns the SML representation of the item.
	 */
	abstract toSml(): string;

	/**
	 * Returns the SECS-II encoded buffer of the item.
	 */
	abstract toBuffer(): Buffer;

	/**
	 * Helper to create the header (Type + LengthBytes)
	 */
	protected createHeader(length: number): Buffer {
		let headerByte = this.type;
		let lengthBytes: Buffer;

		if (length > 0xffffff) {
			throw new Error(`Length ${length.toString()} is too large for SECS item`);
		}

		if (length > 0xffff) {
			// 3 bytes length
			headerByte |= 0x03;
			lengthBytes = Buffer.alloc(4);
			lengthBytes.writeUInt8(headerByte, 0);
			lengthBytes.writeUIntBE(length, 1, 3);
		} else if (length > 0xff) {
			// 2 bytes length
			headerByte |= 0x02;
			lengthBytes = Buffer.alloc(3);
			lengthBytes.writeUInt8(headerByte, 0);
			lengthBytes.writeUInt16BE(length, 1);
		} else {
			// 1 byte length
			headerByte |= 0x01;
			lengthBytes = Buffer.alloc(2);
			lengthBytes.writeUInt8(headerByte, 0);
			lengthBytes.writeUInt8(length, 1);
		}
		return lengthBytes;
	}

	static fromBuffer(buffer: Buffer): {
		item: AbstractSecs2Item;
		consumed: number;
	} {
		if (buffer.length === 0) {
			throw new Error("Empty buffer");
		}

		const headerByte = buffer.readUInt8(0);
		const itemType = (headerByte & 0xfc) as SecsItemType; // Clear last 2 bits
		const lengthBytes = headerByte & 0x03;

		let length = 0;
		if (lengthBytes === 1) {
			length = buffer.readUInt8(1);
		} else if (lengthBytes === 2) {
			length = buffer.readUInt16BE(1);
		} else if (lengthBytes === 3) {
			length = buffer.readUIntBE(1, 3);
		} else {
			throw new Error(`Invalid length bytes count: ${lengthBytes.toString()}`);
		}

		const valueStart = 1 + lengthBytes;
		const valueEnd = valueStart + length;

		if (buffer.length < valueEnd) {
			throw new Error(
				`Insufficient buffer length. Expected ${valueEnd.toString()}, got ${buffer.length.toString()}`,
			);
		}

		const valueBuffer = buffer.subarray(valueStart, valueEnd);
		const consumed = valueEnd;

		let item: AbstractSecs2Item;

		switch (itemType) {
			case SecsItemType.L: {
				const items: AbstractSecs2Item[] = [];
				let offset = 0;
				// valueBuffer contains the list items
				while (offset < valueBuffer.length) {
					const result = AbstractSecs2Item.fromBuffer(
						valueBuffer.subarray(offset),
					);
					items.push(result.item);
					offset += result.consumed;
				}
				item = createListItem(...items);
				break;
			}
			case SecsItemType.A:
				item = createAsciiItem(valueBuffer.toString("ascii"));
				break;
			case SecsItemType.B:
				item = createBinaryItem(valueBuffer);
				break;
			case SecsItemType.BOOLEAN: {
				// Parse boolean array
				const bools = [];
				for (const byte of valueBuffer) {
					bools.push(byte !== 0);
				}
				item = createBooleanItem(...bools);
				break;
			}
			case SecsItemType.I1:
				item = createI1Item(...valueBuffer);
				break;
			case SecsItemType.I2:
				item = createI2Item(...valueBuffer);
				break;
			case SecsItemType.I4:
				item = createI4Item(...valueBuffer);
				break;
			case SecsItemType.I8:
				item = createI8Item(...valueBuffer);
				break;
			case SecsItemType.U1:
				item = createU1Item(...valueBuffer);
				break;
			case SecsItemType.U2:
				item = createU2Item(...valueBuffer);
				break;
			case SecsItemType.U4:
				item = createU4Item(...valueBuffer);
				break;
			case SecsItemType.U8:
				item = createU8Item(...valueBuffer);
				break;
			case SecsItemType.F4:
				item = createF4Item(...valueBuffer);
				break;
			case SecsItemType.F8:
				item = createF8Item(...valueBuffer);
				break;
			default:
				throw new Error(
					`Unknown item type: 0x${(itemType as number).toString(16)}`,
				);
		}

		return { item, consumed };
	}
}
