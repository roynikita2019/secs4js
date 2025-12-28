import { SecsItem } from "./secs2/SecsItem.js";

export class SecsMessage {
	constructor(
		public readonly stream: number,
		public readonly func: number,
		public readonly wBit: boolean,
		public readonly body: SecsItem | null = null,
		public readonly systemBytes = 0, // Typically 4 bytes, treated as integer for convenience if it fits, or Buffer
		public readonly deviceId = 0,
	) {
		if (stream < 0 || stream > 127) throw new Error("Stream must be 0-127");
		if (func < 0 || func > 255) throw new Error("Function must be 0-255");
	}

	/**
	 * Returns the SML representation.
	 */
	toSml(): string {
		const wBitStr = this.wBit ? "W" : "";
		const header = `S${this.stream.toString()}F${this.func.toString()} ${wBitStr}`;
		if (this.body) {
			return `${header}\n${this.body.toSml()}.`;
		}
		return `${header}.`;
	}
}
