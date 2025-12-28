import { SecsItemType } from "../enums/SecsItemType.js";
import { AbstractSecs2Item } from "./AbstractSecs2Item.js";

export class Secs2ItemNumeric extends AbstractSecs2Item<
	number | number[] | bigint | bigint[]
> {
	constructor(
		type: SecsItemType,
		value: number | number[] | bigint | bigint[],
	) {
		super(type, value);
	}

	get valueAsArray(): (number | bigint)[] {
		return Array.isArray(this._value) ? this._value : [this._value];
	}

	override toSml(): string {
		const typeName = SecsItemType[this.type];
		const values = this.valueAsArray.map((v) => v.toString());
		return `<${typeName} [${values.length}] ${values.join(" ")}>`;
	}

	override toBuffer(): Buffer {
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

	static fromTypeBuffer(type: SecsItemType, buffer: Buffer): Secs2ItemNumeric {
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

		if (type === SecsItemType.I8 || type === SecsItemType.U8) {
			return new Secs2ItemNumeric(
				type,
				values.length === 1
					? (values[0] as bigint)
					: (values as unknown as bigint[]),
			);
		}

		return new Secs2ItemNumeric(
			type,
			values.length === 1 ? (values[0] as number) : (values as number[]),
		);
	}
}
