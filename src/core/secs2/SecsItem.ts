import { SecsItemType } from '../enums/SecsItemType.js';

export abstract class SecsItem<T = unknown> {
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

	static fromBuffer(buffer: Buffer): { item: SecsItem; consumed: number } {
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

		let item: SecsItem;

		switch (itemType) {
			case SecsItemType.L: {
				const items: SecsItem[] = [];
				let offset = 0;
				// valueBuffer contains the list items
				while (offset < valueBuffer.length) {
					const result = SecsItem.fromBuffer(valueBuffer.subarray(offset));
					items.push(result.item);
					offset += result.consumed;
				}
				item = new SecsList(items);
				break;
			}
			case SecsItemType.A:
				item = new SecsAscii(valueBuffer.toString("ascii"));
				break;
			case SecsItemType.B:
				item = new SecsBinary(valueBuffer);
				break;
			case SecsItemType.BOOLEAN: {
				// Parse boolean array
				const bools = [];
				for (const byte of valueBuffer) {
					bools.push(byte !== 0);
				}
				item = new SecsBoolean(bools.length === 1 ? bools[0] : bools);
				break;
			}
			case SecsItemType.I1:
			case SecsItemType.I2:
			case SecsItemType.I4:
			case SecsItemType.I8:
			case SecsItemType.U1:
			case SecsItemType.U2:
			case SecsItemType.U4:
			case SecsItemType.U8:
			case SecsItemType.F4:
			case SecsItemType.F8:
				item = SecsNumber.fromBuffer(itemType, valueBuffer);
				break;
			default:
        throw new Error(`Unknown item type: 0x${(itemType as number).toString(16)}`);
    }

    return { item, consumed };
	}
}

export class SecsList extends SecsItem<SecsItem[]> {
	constructor(value: SecsItem[]) {
		super(SecsItemType.L, value);
	}

	toSml(): string {
		if (this._value.length === 0) {
			return "<L[0] >";
		}
		const lines = ["<L"];
		for (const item of this._value) {
			lines.push("  " + item.toSml().replace(/\n/g, "\n  "));
		}
		lines.push(">");
		return lines.join("\n");
	}

	toBuffer(): Buffer {
		const buffers = this._value.map((item) => item.toBuffer());
		const valueBuffer = Buffer.concat(buffers);
		const header = this.createHeader(valueBuffer.length);
		return Buffer.concat([header, valueBuffer]);
	}
}

export class SecsAscii extends SecsItem<string> {
	constructor(value: string) {
		super(SecsItemType.A, value);
	}

	toSml(): string {
		return `<A "${this._value}">`;
	}

	toBuffer(): Buffer {
		const valueBuffer = Buffer.from(this._value, "ascii");
		const header = this.createHeader(valueBuffer.length);
		return Buffer.concat([header, valueBuffer]);
	}
}

export class SecsBinary extends SecsItem<Buffer> {
	constructor(value: Buffer | number[]) {
		super(SecsItemType.B, Buffer.isBuffer(value) ? value : Buffer.from(value));
	}

	toSml(): string {
		const hex = [];
		for (const byte of this._value) {
			hex.push("0x" + byte.toString(16).toUpperCase().padStart(2, "0"));
		}
		return `<B ${hex.join(" ")}>`;
	}

	toBuffer(): Buffer {
		const header = this.createHeader(this._value.length);
		return Buffer.concat([header, this._value]);
	}
}

export class SecsBoolean extends SecsItem<boolean | boolean[]> {
	constructor(value: boolean | boolean[]) {
		super(SecsItemType.BOOLEAN, value);
	}

	get valueAsArray(): boolean[] {
		return Array.isArray(this._value) ? this._value : [this._value];
	}

	toSml(): string {
		const values = this.valueAsArray.map((v) => (v ? "T" : "F")); // Using T/F for brevity, standard might be TRUE/FALSE
		return `<BOOLEAN ${values.join(" ")}>`;
	}

	toBuffer(): Buffer {
		const values = this.valueAsArray;
		const buffer = Buffer.alloc(values.length);
		values.forEach((v, i) => buffer.writeUInt8(v ? 1 : 0, i)); // Or 0xFF? Python says 0xFF if v else 0x00?
		// Python code: 0xFF if v else 0x00.
		// Let's check pysemisecs again.
		// return bytes([(0xFF if v else 0x00) for v in self._value])
		// So 0xFF.
		values.forEach((v, i) => buffer.writeUInt8(v ? 0xff : 0x00, i));
		const header = this.createHeader(buffer.length);
		return Buffer.concat([header, buffer]);
	}
}

export class SecsNumber extends SecsItem<
  number | number[] | bigint | bigint[]
> {
  get valueAsArray(): (number | bigint)[] {
    return Array.isArray(this._value) ? this._value : [this._value];
  }

  toSml(): string {
    const typeName = SecsItemType[this.type];
		const values = this.valueAsArray.map((v) => v.toString());
		return `<${typeName} ${values.join(" ")}>`;
	}

	toBuffer(): Buffer {
		const values = this.valueAsArray;
		let elementSize = 0;
		let writeFunc: (val: number | bigint, buf: Buffer, offset: number) => void;

		switch (this.type) {
			case SecsItemType.I1:
				elementSize = 1;
				writeFunc = (v, b, o) => b.writeInt8(Number(v), o);
				break;
			case SecsItemType.I2:
				elementSize = 2;
				writeFunc = (v, b, o) => b.writeInt16BE(Number(v), o);
				break;
			case SecsItemType.I4:
				elementSize = 4;
				writeFunc = (v, b, o) => b.writeInt32BE(Number(v), o);
				break;
			case SecsItemType.I8:
				elementSize = 8;
				writeFunc = (v, b, o) => b.writeBigInt64BE(BigInt(v), o);
				break;
			case SecsItemType.U1:
				elementSize = 1;
				writeFunc = (v, b, o) => b.writeUInt8(Number(v), o);
				break;
			case SecsItemType.U2:
				elementSize = 2;
				writeFunc = (v, b, o) => b.writeUInt16BE(Number(v), o);
				break;
			case SecsItemType.U4:
				elementSize = 4;
				writeFunc = (v, b, o) => b.writeUInt32BE(Number(v), o);
				break;
			case SecsItemType.U8:
				elementSize = 8;
				writeFunc = (v, b, o) => b.writeBigUInt64BE(BigInt(v), o);
				break;
			case SecsItemType.F4:
				elementSize = 4;
				writeFunc = (v, b, o) => b.writeFloatBE(Number(v), o);
				break;
			case SecsItemType.F8:
				elementSize = 8;
				writeFunc = (v, b, o) => b.writeDoubleBE(Number(v), o);
				break;
			default:
				throw new Error(`Unsupported numeric type: ${this.type.toString()}`);
		}

		const buffer = Buffer.alloc(values.length * elementSize);
		values.forEach((v, i) => {
			writeFunc(v, buffer, i * elementSize);
		});
		const header = this.createHeader(buffer.length);
		return Buffer.concat([header, buffer]);
	}

	static fromBuffer(type: SecsItemType, buffer: Buffer): SecsNumber {
		let elementSize = 0;
		let readFunc: (buf: Buffer, offset: number) => number | bigint;

		switch (type) {
			case SecsItemType.I1:
				elementSize = 1;
				readFunc = (b, o) => b.readInt8(o);
				break;
			case SecsItemType.I2:
				elementSize = 2;
				readFunc = (b, o) => b.readInt16BE(o);
				break;
			case SecsItemType.I4:
				elementSize = 4;
				readFunc = (b, o) => b.readInt32BE(o);
				break;
			case SecsItemType.I8:
				elementSize = 8;
				readFunc = (b, o) => b.readBigInt64BE(o);
				break;
			case SecsItemType.U1:
				elementSize = 1;
				readFunc = (b, o) => b.readUInt8(o);
				break;
			case SecsItemType.U2:
				elementSize = 2;
				readFunc = (b, o) => b.readUInt16BE(o);
				break;
			case SecsItemType.U4:
				elementSize = 4;
				readFunc = (b, o) => b.readUInt32BE(o);
				break;
			case SecsItemType.U8:
				elementSize = 8;
				readFunc = (b, o) => b.readBigUInt64BE(o);
				break;
			case SecsItemType.F4:
				elementSize = 4;
				readFunc = (b, o) => b.readFloatBE(o);
				break;
			case SecsItemType.F8:
				elementSize = 8;
				readFunc = (b, o) => b.readDoubleBE(o);
				break;
			default:
				throw new Error(`Unsupported numeric type: ${type.toString()}`);
		}

		const count = buffer.length / elementSize;
		if (!Number.isInteger(count)) {
			throw new Error(
				`Buffer length ${buffer.length.toString()} is not multiple of element size ${elementSize.toString()}`,
			);
		}

		const values: (number | bigint)[] = [];
		for (let i = 0; i < count; i++) {
			values.push(readFunc(buffer, i * elementSize));
		}

		// Return single value if count is 1?
		// Python implementation:
		// if tuple or list: return tuple
		// else: return tuple (always tuple?)
		// AbstractSecs2NumberBody __init__ uses tuple(value)
		// But get_value might return single.

		// In TypeScript, it's better to be consistent.
		// I will return array if length > 1, or single value if length === 1.
		// Actually, strict types are better. I'll store it as is.
		// If the buffer came from `fromBuffer`, we likely want to represent it as an array if it was intended as such, but we don't know the intent.
		// The safest is to return array for multiple items, and single for one.

		return new SecsNumber(type, values.length === 1 ? values[0] : values);
	}
}
