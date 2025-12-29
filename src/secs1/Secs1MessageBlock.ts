export class Secs1MessageBlock {
	// The full block bytes: [Length(1)] + [Header(10)] + [Body(0-244)] + [Checksum(2)]
	constructor(public readonly buffer: Buffer) {}

	get length(): number {
		return this.buffer[0];
	}

	get header(): Buffer {
		return this.buffer.subarray(1, 11);
	}

	get body(): Buffer {
		return this.buffer.subarray(11, this.buffer.length - 2);
	}

	get checksum(): number {
		return this.buffer.readUInt16BE(this.buffer.length - 2);
	}

	// Parsed fields
	get deviceId(): number {
		const bs = this.buffer.subarray(1, 3);
		return ((bs[0] << 8) & 0x7f00) | bs[1];
	}

	get rBit(): boolean {
		return (this.buffer[1] & 0x80) === 0x80;
	}

	get stream(): number {
		return this.buffer[3] & 0x7f;
	}

	get wBit(): boolean {
		return (this.buffer[3] & 0x80) === 0x80;
	}

	get func(): number {
		return this.buffer[4];
	}

	get blockNumber(): number {
		const bs = this.buffer.subarray(5, 7);
		return ((bs[0] << 8) & 0x7f00) | bs[1];
	}

	get eBit(): boolean {
		return (this.buffer[5] & 0x80) === 0x80;
	}

	get systemBytes(): number {
		return this.buffer.readUInt32BE(7);
	}

	isValid(): boolean {
		if (this.buffer.length < 13) return false; // Len(1) + Head(10) + Sum(2)
		if (this.buffer[0] !== this.buffer.length - 3) return false; // Length byte excludes itself and checksum?
		// Wait, SECS-I Length Byte is the number of bytes in the block EXCLUSIVE of the length byte itself and the checksum?
		// No, standard says: "Length byte is the number of bytes in the block header plus the text." (Header + Body).
		// So Length = 10 + BodyLength.
		// Total buffer size = 1 (LenByte) + Length + 2 (Checksum).
		// So Buffer Length = 1 + Length + 2 = Length + 3.
		// So Length Byte value should be BufferLength - 3.

		const calculatedSum = this.calculateChecksum();
		return calculatedSum === this.checksum;
	}

	private calculateChecksum(): number {
		// Sum of bytes from Header to end of Body (excluding Length byte and Checksum bytes)
		// i.e., indices 1 to length-3
		let sum = 0;
		for (let i = 1; i < this.buffer.length - 2; i++) {
			sum += this.buffer[i];
		}
		return sum & 0xffff;
	}

	static fromParts(
		deviceId: number,
		stream: number,
		func: number,
		wBit: boolean,
		eBit: boolean,
		blockNum: number,
		systemBytes: number,
		body: Buffer,
		rBit = false,
	): Secs1MessageBlock {
		const header = Buffer.alloc(10);
		// Byte 0: R-Bit + DeviceID MSB
		let b0 = (deviceId >> 8) & 0x7f;
		if (rBit) b0 |= 0x80;
		header[0] = b0;
		// Byte 1: DeviceID LSB
		header[1] = deviceId & 0xff;

		// Byte 2: W-Bit + Stream
		let b2 = stream & 0x7f;
		if (wBit) b2 |= 0x80;
		header[2] = b2;

		// Byte 3: Function
		header[3] = func & 0xff;

		// Byte 4: E-Bit + BlockNum MSB
		let b4 = (blockNum >> 8) & 0x7f;
		if (eBit) b4 |= 0x80;
		header[4] = b4;

		// Byte 5: BlockNum LSB
		header[5] = blockNum & 0xff;

		// Byte 6-9: System Bytes
		header.writeUInt32BE(systemBytes, 6);

		// Calculate Length
		const length = 10 + body.length;
		if (length > 254) throw new Error("Block too large");

		// Calculate Checksum
		let sum = 0;
		for (const b of header) sum += b;
		for (const b of body) sum += b;
		const checksum = sum & 0xffff;

		const block = Buffer.alloc(1 + 10 + body.length + 2);
		block[0] = length;
		header.copy(block, 1);
		body.copy(block, 11);
		block.writeUInt16BE(checksum, block.length - 2);

		return new Secs1MessageBlock(block);
	}
}
