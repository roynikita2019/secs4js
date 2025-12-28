import { SecsItemType } from "../enums/SecsItemType.js";
import { AbstractSecs2Item } from "./AbstractSecs2Item.js";

export class Secs2ItemList extends AbstractSecs2Item<AbstractSecs2Item[]> {
	constructor(value: AbstractSecs2Item[]) {
		super(SecsItemType.L, value);
	}

	override toSml(): string {
		if (this._value.length === 0) {
			return "<L [0] >";
		}
		const lines = ["<L [", this._value.length.toString(), "] "];
		for (const item of this._value) {
			lines.push("  " + item.toSml().replace(/\n/g, "\n  "));
		}
		lines.push(">");
		return lines.join("\n");
	}

	override toBuffer(): Buffer {
		const buffers = this._value.map((item) => item.toBuffer());
		const valueBuffer = Buffer.concat(buffers);
		const header = this.createHeader(valueBuffer.length);
		return Buffer.concat([header, valueBuffer]);
	}
}
