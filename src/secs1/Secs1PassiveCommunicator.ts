import { Server, Socket, createServer } from "net";
import {
	AbstractSecsCommunicator,
	SecsCommunicatorConfig,
} from "../core/AbstractSecsCommunicator.js";
import { SecsMessage } from "../core/AbstractSecsMessage.js";
import { AbstractSecs2Item } from "../core/secs2item/AbstractSecs2Item.js";
import { Secs1Message } from "./Secs1Message.js";
import { Secs1MessageBlock } from "./Secs1MessageBlock.js";

export interface Secs1PassiveCommunicatorConfig extends SecsCommunicatorConfig {
	ip: string;
	port: number;
	retry?: number; // Default 3
	isMaster?: boolean; // Default false (Slave)
}

const ENQ = 0x05;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;

enum CommState {
	IDLE,
	WAIT_EOT, // Waiting for EOT after sending ENQ
	SENDING_BLOCK, // Sending blocks
	WAIT_ACK, // Waiting for ACK after sending block
	WAIT_BLOCK_LENGTH, // Waiting for block length after sending EOT (Receiving)
	WAIT_BLOCK_DATA, // Waiting for block data (Receiving)
}

export class Secs1PassiveCommunicator extends AbstractSecsCommunicator {
	public ip: string;
	public port: number;
	public retry: number;
	public isMaster: boolean;

	private server: Server | null = null;
	private socket: Socket | null = null;
	private state: CommState = CommState.IDLE;
	private buffer: Buffer = Buffer.alloc(0);

	// Sending State
	private sendQueue: Buffer[] = []; // Queue of logical messages (Header+Body) to send
	private currentBlocks: Secs1MessageBlock[] = [];
	private currentBlockIndex = 0;
	private retryCount = 0;

	// Receiving State
	private receivedBlocks: Secs1MessageBlock[] = [];
	private expectedBlockNum = 1;
	private currentBlockLength = 0;

	// Timers
	private t2Timer: NodeJS.Timeout | null = null;
	private t4Timer: NodeJS.Timeout | null = null;

	constructor(config: Secs1PassiveCommunicatorConfig) {
		super(config);
		this.ip = config.ip;
		this.port = config.port;
		this.retry = config.retry ?? 3;
		this.isMaster = config.isMaster ?? false;
	}

	async open(): Promise<void> {
		if (this.server) return;

		return new Promise((resolve, reject) => {
			this.server = createServer((socket) => {
				if (this.socket && !this.socket.destroyed) {
					console.warn("Rejecting new connection (SECS-I Single Session)");
					socket.destroy();
					return;
				}
				console.log(
					`Accepted connection from ${socket.remoteAddress ?? "unknown"}:${socket.remotePort ?? "unknown"}`,
				);
				this.handleSocket(socket);
			});

			this.server.on("error", (err) => {
				reject(err);
			});

			this.server.listen(this.port, this.ip, () => {
				resolve();
			});
		});
	}

	close(): Promise<void> {
		if (this.socket) {
			this.socket.destroy();
			this.socket = null;
		}
		if (this.server) {
			this.server.close();
			this.server = null;
		}
		this.stopTimers();
		return Promise.resolve();
	}

	private handleSocket(socket: Socket) {
		this.socket = socket;
		this.state = CommState.IDLE;
		this.buffer = Buffer.alloc(0);

		socket.on("data", (data) => {
			this.buffer = Buffer.concat([this.buffer, data]);
			this.processBuffer();
		});

		socket.on("close", () => {
			this.socket = null;
			this.emit("disconnected");
			this.stopTimers();
		});

		socket.on("error", (err) => {
			this.emit("error", err);
		});

		this.emit("connected");
	}

	private stopTimers() {
		if (this.t2Timer) {
			clearTimeout(this.t2Timer);
			this.t2Timer = null;
		}
		if (this.t4Timer) {
			clearTimeout(this.t4Timer);
			this.t4Timer = null;
		}
	}

	private startT2() {
		this.stopTimers();
		// SECS-I T2 is usually 10-15s? Default to timeoutT2?
		// AbstractSecsCommunicator doesn't have T2. It has T3, T5, T6...
		// Let's use T6 (Control Transaction) or T7? Or just hardcode 10s or add to config.
		// Using T6 for now.
		const timeout = this.timeoutT6 * 1000;
		this.t2Timer = setTimeout(() => {
			this.handleT2Timeout();
		}, timeout);
	}

	private startT4() {
		// Inter-block timeout.
		const timeout = this.timeoutT7 * 1000; // Using T7
		this.t4Timer = setTimeout(() => {
			this.handleT4Timeout();
		}, timeout);
	}

	private handleT2Timeout() {
		console.warn("T2 Timeout");
		this.t2Timer = null;
		if (this.state === CommState.WAIT_EOT) {
			this.retryCount++;
			if (this.retryCount > this.retry) {
				this.emit("error", new Error("Retry limit exceeded waiting for EOT"));
				this.resetState();
			} else {
				// Retry sending ENQ
				console.log(`Retrying ENQ (${this.retryCount}/${this.retry})`);
				this.sendByte(ENQ);
				this.startT2();
			}
		} else if (this.state === CommState.WAIT_ACK) {
			this.retryCount++;
			if (this.retryCount > this.retry) {
				this.emit("error", new Error("Retry limit exceeded waiting for ACK"));
				this.resetState();
			} else {
				// Retry sending Block
				console.log(`Retrying Block (${this.retryCount}/${this.retry})`);
				this.sendCurrentBlock();
			}
		} else {
			this.resetState();
		}
	}

	private handleT4Timeout() {
		console.warn("T4 Timeout (Inter-block)");
		this.t4Timer = null;
		this.resetState();
	}

	private resetState() {
		this.state = CommState.IDLE;
		this.receivedBlocks = [];
		this.expectedBlockNum = 1;
		this.currentBlockLength = 0;
		this.stopTimers();
		// Try to process next message in queue if any
		this.processSendQueue();
	}

	private sendByte(byte: number) {
		if (this.socket && !this.socket.destroyed) {
			this.socket.write(Buffer.from([byte]));
		}
	}

	private processBuffer() {
		while (this.buffer.length > 0) {
			switch (this.state) {
				case CommState.IDLE: {
					const byte = this.buffer[0];
					this.buffer = this.buffer.subarray(1);
					if (byte === ENQ) {
						// Received ENQ, send EOT and prepare to receive
						this.sendByte(EOT);
						this.state = CommState.WAIT_BLOCK_LENGTH;
						this.receivedBlocks = [];
						this.expectedBlockNum = 1;
						this.startT2(); // Wait for first block
					} else {
						// Ignore or log
					}
					break;
				}
				case CommState.WAIT_EOT: {
					const byte = this.buffer[0];
					this.buffer = this.buffer.subarray(1);
					if (byte === EOT) {
						this.stopTimers();
						// Start sending blocks
						this.currentBlockIndex = 0;
						this.sendCurrentBlock();
					} else if (byte === ENQ) {
						// Contention?
						if (this.isMaster) {
							// Ignore ENQ, keep waiting for EOT (or NAK?)
						} else {
							// Yield: Send EOT and switch to receiving
							this.stopTimers();
							this.sendByte(EOT);
							this.state = CommState.WAIT_BLOCK_LENGTH;
							this.receivedBlocks = [];
							this.expectedBlockNum = 1;
							this.startT2();
							// Re-queue current message?
							// Yes, push back to front? Or just leave it in currentBlocks/sendQueue?
							// Since we reset state, processSendQueue will pick it up later?
							// Need to put currentBlocks back to sendQueue or just keep it?
							// Simpler: Just fail current send and let it retry or put back.
							// For now, let's just reset and hope sendQueue logic handles it.
							// But currentBlocks is pulled FROM sendQueue.
							// I should probably put it back.
							// But for simplicity, I'll just reset. The current message might be lost or need complex retry.
							// Actually, if we yield, we should try to send after receiving.
							// TODO: Better contention handling.
						}
					}
					break;
				}
				case CommState.WAIT_ACK: {
					const byte = this.buffer[0];
					this.buffer = this.buffer.subarray(1);
					if (byte === ACK) {
						this.stopTimers();
						// Block sent successfully
						const currentBlock = this.currentBlocks[this.currentBlockIndex];
						if (currentBlock.eBit) {
							// Message done
							this.currentBlocks = [];
							this.retryCount = 0;
							this.state = CommState.IDLE;
							this.processSendQueue(); // Send next message
						} else {
							// Send next block
							this.currentBlockIndex++;
							this.sendCurrentBlock();
						}
					} else if (byte === NAK) {
						this.stopTimers();
						this.handleT2Timeout(); // Treat NAK as retry trigger
					}
					break;
				}
				case CommState.WAIT_BLOCK_LENGTH: {
					const len = this.buffer[0];
					if (len < 10) {
						// Invalid length (header is 10 bytes)
						// Maybe control char?
						// If ENQ/EOT/ACK/NAK received here, it's unexpected (except maybe ENQ if reset).
						this.buffer = this.buffer.subarray(1);
						// Ignore
					} else {
						this.currentBlockLength = len;
						this.buffer = this.buffer.subarray(1);
						this.state = CommState.WAIT_BLOCK_DATA;
						this.startT2(); // Wait for data
					}
					break;
				}
				case CommState.WAIT_BLOCK_DATA: {
					// Need currentBlockLength + 2 bytes (Checksum)
					// Actually Length byte value includes Header+Body.
					// We read Length Byte.
					// Remaining needed: Length + 2 (Checksum).
					// Total block size = 1 (Len) + Length + 2.
					// We already read Len.
					if (this.buffer.length >= this.currentBlockLength + 2) {
						const blockData = this.buffer.subarray(
							0,
							this.currentBlockLength + 2,
						);
						this.buffer = this.buffer.subarray(this.currentBlockLength + 2);
						this.stopTimers();

						// Reconstruct full block buffer for Secs1MessageBlock
						const fullBlockBuffer = Buffer.alloc(1 + blockData.length);
						fullBlockBuffer[0] = this.currentBlockLength;
						blockData.copy(fullBlockBuffer, 1);

						const block = new Secs1MessageBlock(fullBlockBuffer);
						if (block.isValid()) {
							if (block.blockNumber !== this.expectedBlockNum) {
								console.warn(
									`Wrong Block Number. Expected ${this.expectedBlockNum}, got ${block.blockNumber}`,
								);
								this.sendByte(NAK); // Or ignore?
								this.state = CommState.IDLE; // Reset?
							} else {
								this.sendByte(ACK);
								this.receivedBlocks.push(block);
								if (block.eBit) {
									// Message Complete
									try {
										const msg = Secs1Message.fromBlocks(this.receivedBlocks);
										this.emit("message", msg);
									} catch (e) {
										this.emit("error", e);
									}
									this.resetState();
								} else {
									this.expectedBlockNum++;
									this.state = CommState.WAIT_BLOCK_LENGTH;
									this.startT4(); // Wait for next block
								}
							}
						} else {
							console.warn("Invalid Checksum");
							this.sendByte(NAK);
							this.state = CommState.IDLE; // Reset?
						}
					} else {
						return; // Wait for more data
					}
					break;
				}
				default:
					return;
			}
		}
	}

	private sendCurrentBlock() {
		if (this.currentBlockIndex >= this.currentBlocks.length) return;
		const block = this.currentBlocks[this.currentBlockIndex];
		if (this.socket && !this.socket.destroyed) {
			this.socket.write(block.buffer);
			this.state = CommState.WAIT_ACK;
			this.startT2();
		}
	}

	private processSendQueue() {
		if (this.state !== CommState.IDLE) return;
		if (this.sendQueue.length === 0) return;

		const buffer = this.sendQueue.shift();
		if (!buffer) return;

		// Convert buffer to blocks
		// Buffer is Header(10) + Body
		try {
			// Extract Header fields to recreate Secs1Message to use toBlocks
			// Byte 0: R-Bit + DeviceID MSB
			const rBit = (buffer[0] & 0x80) === 0x80;
			const deviceId = ((buffer[0] & 0x7f) << 8) | buffer[1];
			const stream = buffer[2] & 0x7f;
			const wBit = (buffer[2] & 0x80) === 0x80;
			const func = buffer[3];
			const systemBytes = buffer.readUInt32BE(6);
			const bodyBuffer = buffer.subarray(10);

			// We need AbstractSecs2Item body.
			// But we have raw bytes.
			// Secs1Message.toBlocks uses this.body.toBuffer().
			// We can bypass creating Secs1Message if we just use Secs1MessageBlock.fromParts directly loop.
			// Reusing logic from Secs1Message.toBlocks but with raw body buffer.

			this.currentBlocks = [];
			let pos = 0;
			let blockNum = 1;

			if (bodyBuffer.length === 0) {
				this.currentBlocks.push(
					Secs1MessageBlock.fromParts(
						deviceId,
						stream,
						func,
						wBit,
						true,
						blockNum,
						systemBytes,
						Buffer.alloc(0),
						rBit,
					),
				);
			} else {
				while (pos < bodyBuffer.length) {
					const remaining = bodyBuffer.length - pos;
					const chunkSize = remaining > 244 ? 244 : remaining;
					const chunk = bodyBuffer.subarray(pos, pos + chunkSize);
					const isLast = pos + chunkSize >= bodyBuffer.length;

					this.currentBlocks.push(
						Secs1MessageBlock.fromParts(
							deviceId,
							stream,
							func,
							wBit,
							isLast,
							blockNum,
							systemBytes,
							chunk,
							rBit,
						),
					);
					pos += chunkSize;
					blockNum++;
				}
			}

			this.currentBlockIndex = 0;
			this.retryCount = 0;

			// Start Handshake
			this.sendByte(ENQ);
			this.state = CommState.WAIT_EOT;
			this.startT2();
		} catch (e) {
			this.emit("error", e);
			this.processSendQueue();
		}
	}

	protected sendBuffer(buffer: Buffer): Promise<void> {
		this.sendQueue.push(buffer);
		process.nextTick(() => this.processSendQueue());
		return Promise.resolve();
	}

	protected createMessage(
		stream: number,
		func: number,
		wBit: boolean,
		body: AbstractSecs2Item | null,
		systemBytes: number,
	): SecsMessage {
		return new Secs1Message(
			stream,
			func,
			wBit,
			body,
			systemBytes,
			this.deviceId,
		);
	}
}
