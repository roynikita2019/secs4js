import { EventEmitter } from "events";
import { SecsMessage } from "./AbstractSecsMessage.js";
import { AbstractSecs2Item } from "./secs2item/AbstractSecs2Item.js";

export interface SecsCommunicatorConfig {
	deviceId: number;
	isEquip: boolean;
	name?: string;
	timeoutT3?: number;
	timeoutT5?: number;
	timeoutT6?: number;
	timeoutT7?: number;
	timeoutT8?: number;
}

export abstract class AbstractSecsCommunicator extends EventEmitter {
	public readonly deviceId: number;
	public readonly isEquip: boolean;
	public readonly name: string;

	public timeoutT3 = 45;
	public timeoutT5 = 10;
	public timeoutT6 = 5;
	public timeoutT7 = 10;
	public timeoutT8 = 5;

	protected _systemBytesCounter = 0;
	protected _transactions = new Map<
		number,
		{
			resolve: (msg: SecsMessage) => void;
			reject: (err: Error) => void;
			timer: NodeJS.Timeout;
		}
	>();

	constructor(config: SecsCommunicatorConfig) {
		super();
		this.deviceId = config.deviceId;
		this.isEquip = config.isEquip;
		this.name = config.name ?? "SecsCommunicator";
		if (config.timeoutT3 !== undefined) this.timeoutT3 = config.timeoutT3;
		if (config.timeoutT5 !== undefined) this.timeoutT5 = config.timeoutT5;
		if (config.timeoutT6 !== undefined) this.timeoutT6 = config.timeoutT6;
		if (config.timeoutT7 !== undefined) this.timeoutT7 = config.timeoutT7;
		if (config.timeoutT8 !== undefined) this.timeoutT8 = config.timeoutT8;
	}

	abstract open(): Promise<void>;
	abstract close(): Promise<void>;

	// This method sends the message bytes. To be implemented by subclasses.
	protected abstract sendBuffer(buffer: Buffer): Promise<void>;

	protected abstract createMessage(
		stream: number,
		func: number,
		wBit: boolean,
		body: AbstractSecs2Item | null,
		systemBytes: number,
	): SecsMessage;

	async send(
		stream: number,
		func: number,
		wBit: boolean,
		body: AbstractSecs2Item | null = null,
	): Promise<SecsMessage | null> {
		const systemBytes = this.getNextSystemBytes();
		const msg = this.createMessage(stream, func, wBit, body, systemBytes);

		if (wBit) {
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					if (this._transactions.has(systemBytes)) {
						this._transactions.delete(systemBytes);
						reject(
							new Error(
								`T3 Timeout waiting for reply to S${String(stream)}F${String(func)} [SysBytes=${String(systemBytes)}]`,
							),
						);
					}
				}, this.timeoutT3 * 1000);

				this._transactions.set(systemBytes, { resolve, reject, timer });

				this.sendBuffer(msg.toBuffer()).catch((err: unknown) => {
					clearTimeout(timer);
					this._transactions.delete(systemBytes);
					reject(err instanceof Error ? err : new Error(String(err)));
				});
			});
		} else {
			await this.sendBuffer(msg.toBuffer());
			return null;
		}
	}

	async reply(
		primaryMsg: SecsMessage,
		stream: number,
		func: number,
		body: AbstractSecs2Item | null = null,
	): Promise<void> {
		const msg = this.createMessage(
			stream,
			func,
			false,
			body,
			primaryMsg.systemBytes,
		);
		console.log("Reply Buffer:", msg.toBuffer());
		console.log(`Reply: ${msg.toSml()}`);
		await this.sendBuffer(msg.toBuffer());
	}

	protected getNextSystemBytes(): number {
		this._systemBytesCounter = (this._systemBytesCounter + 1) >>> 0; // Ensure 32-bit unsigned
		return this._systemBytesCounter;
	}

	protected handleMessage(msg: SecsMessage) {
		// Check if it's a reply
		// Usually, if we have a transaction waiting for this SystemBytes, we treat it as a reply.
		// However, Stream 0 (HSMS Control) messages are never replies to SECS-II messages.
		// SECS-II replies usually have the same SystemBytes as the primary.

		const tx = this._transactions.get(msg.systemBytes);
		if (tx) {
			clearTimeout(tx.timer);
			this._transactions.delete(msg.systemBytes);
			tx.resolve(msg);
			return;
		}

		// If not a reply, emit event
		this.emit("message", msg);
	}
}
