import { SecsItemType } from "../enums/SecsItemType.js";
import { AbstractSecs2Item } from "./AbstractSecs2Item.js";

export class Secs2ItemBoolean extends AbstractSecs2Item<boolean | boolean[]> {
	constructor(value: boolean | boolean[]) {
		super(SecsItemType.BOOLEAN, value);
	}

	get valueAsArray(): boolean[] {
		return Array.isArray(this._value) ? this._value : [this._value];
	}

	override toSml(): string {
		const values = this.valueAsArray.map((v) => (v ? "T" : "F")); // Using T/F for brevity, standard might be TRUE/FALSE
		return `<BOOLEAN ${values.join(" ")}>`;
	}

	override toBuffer(): Buffer {
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
