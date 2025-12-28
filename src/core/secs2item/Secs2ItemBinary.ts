import { SecsItemType } from "../enums/SecsItemType.js";
import { AbstractSecs2Item } from "./AbstractSecs2Item.js";

export class Secs2ItemBinary extends AbstractSecs2Item<Buffer> {
	constructor(value: Buffer | number[]) {
		super(SecsItemType.B, Buffer.isBuffer(value) ? value : Buffer.from(value));
	}

	override toSml(): string {
		const hex = [];
		for (const byte of this._value) {
			hex.push("0x" + byte.toString(16).toUpperCase().padStart(2, "0"));
		}
		return `<B [${this._value.length}] ${hex.join(" ")}>`;
	}

	override toBuffer(): Buffer {
		const header = this.createHeader(this._value.length);
		return Buffer.concat([header, this._value]);
	}
}
