import { AbstractSecs2Item } from "./secs2item/AbstractSecs2Item.js";

export class SecsMessage {
	constructor(
		public readonly stream: number,
		public readonly func: number,
		public readonly wBit: boolean,
		public readonly body: AbstractSecs2Item | null = null,
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

	toBuffer(): Buffer {
		const header = Buffer.from([
			0x02, // SML header
			this.stream,
			this.func,
			this.wBit ? 0x80 : 0x00,
		]);
		const body = this.body?.toBuffer() ?? Buffer.alloc(0);
		const systemBytes =
			typeof this.systemBytes === "number"
				? Buffer.from([
						this.systemBytes >>> 24,
						(this.systemBytes >>> 16) & 0xff,
						(this.systemBytes >>> 8) & 0xff,
						this.systemBytes & 0xff,
					])
				: this.systemBytes;
		const deviceId = Buffer.from([
			this.deviceId >>> 24,
			(this.deviceId >>> 16) & 0xff,
			(this.deviceId >>> 8) & 0xff,
			this.deviceId & 0xff,
		]);
		return Buffer.concat([header, systemBytes, deviceId, body]);
	}
}
