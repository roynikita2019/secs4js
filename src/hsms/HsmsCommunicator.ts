import { Socket } from "net";
import {
	AbstractSecsCommunicator,
	SecsCommunicatorConfig,
} from "../core/AbstractSecsCommunicator.js";
import { SecsMessage } from "../core/AbstractSecsMessage.js";
import { AbstractSecs2Item } from "../core/secs2item/AbstractSecs2Item.js";
import { HsmsMessage } from "./HsmsMessage.js";
import { HsmsControlType } from "./enums/HsmsControlType.js";
import { SelectStatus } from "./enums/SelectStatus.js";
import { RejectReason } from "./enums/RejectReason.js";

export enum HsmsState {
	NotConnected = "NotConnected",
	Connected = "Connected", // TCP Connected
	Selected = "Selected", // HSMS Selected
}

export interface HsmsCommunicatorConfig extends SecsCommunicatorConfig {
	ip: string;
	port: number;
}

export abstract class HsmsCommunicator extends AbstractSecsCommunicator {
	public ip: string;
	public port: number;

	protected socket: Socket | null = null;
	protected state: HsmsState = HsmsState.NotConnected;
	private buffer: Buffer = Buffer.alloc(0);

	// T6 Timer (Control Transaction)
	// We use the same _transactions map for Control messages if they expect reply

	constructor(config: HsmsCommunicatorConfig) {
		super(config);
		this.ip = config.ip;
		this.port = config.port;
	}

	protected async sendBuffer(buffer: Buffer): Promise<void> {
		const socket = this.socket;
		if (!socket || socket.destroyed) {
			throw new Error("Socket not connected");
		}
		return new Promise((resolve, reject) => {
			socket.write(buffer, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	protected createMessage(
		stream: number,
		func: number,
		wBit: boolean,
		body: AbstractSecs2Item | null,
		systemBytes: number,
	): SecsMessage {
		// For Data messages, pType=0, sType=0 (Data)
		return new HsmsMessage(
			stream,
			func,
			wBit,
			body,
			systemBytes,
			this.deviceId,
			0,
			HsmsControlType.Data,
		);
	}

	protected handleSocketEvents(socket: Socket) {
		this.socket = socket;
		this.state = HsmsState.Connected;
		this.emit("connected");

		socket.on("data", (data) => {
			this.buffer = Buffer.concat([this.buffer, data]);
			this.processBuffer();
		});

		socket.on("close", () => {
			this.state = HsmsState.NotConnected;
			this.socket = null;
			this.emit("disconnected");
		});

		socket.on("error", (err) => {
			this.emit("error", err);
		});
	}

	private processBuffer() {
		while (true) {
			if (this.buffer.length < 4) return;

			const length = this.buffer.readUInt32BE(0);
			if (this.buffer.length < 4 + length) return;

			const msgBuffer = this.buffer.subarray(0, 4 + length);
			this.buffer = this.buffer.subarray(4 + length);

			try {
				const msg = HsmsMessage.fromBuffer(msgBuffer);
				this.processHsmsMessage(msg);
			} catch (err) {
				if (err instanceof Error) {
					this.emit(
						"error",
						new Error(`Failed to parse HSMS message: ${err.message}`),
					);
				} else {
					this.emit(
						"error",
						new Error(`Failed to parse HSMS message: ${String(err)}`),
					);
				}
			}
		}
	}

	private processHsmsMessage(msg: HsmsMessage) {
		// Handle Control Messages
		if (msg.sType !== HsmsControlType.Data) {
			this.handleControlMessage(msg);
			return;
		}

		// Handle Data Messages
		if (this.state !== HsmsState.Selected) {
			// Received Data message while not Selected -> Reject?
			// Or ignore? Standard says usually Reject with reason NotSelected.
			void this.sendReject(msg, RejectReason.NotSelected);
			return;
		}

		super.handleMessage(msg);
	}

	private handleControlMessage(msg: HsmsMessage) {
		switch (msg.sType as HsmsControlType) {
			case HsmsControlType.SelectReq:
				this.handleSelectReq(msg);
				break;
			case HsmsControlType.SelectRsp:
				this.handleSelectRsp(msg);
				break;
			case HsmsControlType.LinkTestReq:
				this.handleLinkTestReq(msg);
				break;
			case HsmsControlType.LinkTestRsp:
				this.handleLinkTestRsp(msg);
				break;
			case HsmsControlType.SeparateReq:
				this.handleSeparateReq(msg);
				break;
			case HsmsControlType.RejectReq:
				this.emit(
					"error",
					new Error(`Received RejectReq: Reason ${msg.func} (or Byte3)`),
				);
				break;
			default:
				void this.sendReject(msg, RejectReason.NotSupportTypeS);
				break;
		}
	}

	protected handleSelectReq(msg: HsmsMessage) {
		// Subclasses might override, but default behavior:
		// If already selected, return Actived/AlreadyUsed?
		// If not, accept.

		// Note: HSMS-SS says only one host.
		if (this.state === HsmsState.Selected) {
			void this.sendSelectRsp(msg, SelectStatus.Actived); // Or AlreadyUsed?
		} else {
			this.state = HsmsState.Selected;
			void this.sendSelectRsp(msg, SelectStatus.Success);
			this.emit("selected");
		}
	}

	protected handleSelectRsp(msg: HsmsMessage) {
		// Check if we are waiting for this.
		// Usually managed by sendSelectReq promise.
		const tx = this._transactions.get(msg.systemBytes);
		if (tx) {
			// If status is Success, set state to Selected
			// msg.func holds the status (byte 3) if we mapped it correctly in HsmsMessage.fromBuffer
			// In HsmsMessage.fromBuffer, for Control msg, func = byte 3.
			const status = msg.func as SelectStatus;
			if (status === SelectStatus.Success) {
				this.state = HsmsState.Selected;
				this.emit("selected");
			}
			clearTimeout(tx.timer);
			this._transactions.delete(msg.systemBytes);
			tx.resolve(msg);
		}
	}

	protected handleLinkTestReq(msg: HsmsMessage) {
		void this.sendLinkTestRsp(msg);
	}

	protected handleLinkTestRsp(msg: HsmsMessage) {
		const tx = this._transactions.get(msg.systemBytes);
		if (tx) {
			clearTimeout(tx.timer);
			this._transactions.delete(msg.systemBytes);
			tx.resolve(msg);
		}
	}

	protected handleSeparateReq(_msg: HsmsMessage) {
		this.state = HsmsState.Connected; // Downgrade
		// Usually close connection
		void this.close();
	}

	// Helper senders
	protected async sendSelectRsp(req: HsmsMessage, status: SelectStatus) {
		const rsp = HsmsMessage.selectRsp(req, status);
		await this.sendBuffer(rsp.toBuffer());
	}

	protected async sendLinkTestRsp(req: HsmsMessage) {
		const rsp = HsmsMessage.linkTestRsp(req);
		await this.sendBuffer(rsp.toBuffer());
	}

	protected async sendReject(req: HsmsMessage, reason: RejectReason) {
		const rsp = HsmsMessage.rejectReq(req, reason);
		await this.sendBuffer(rsp.toBuffer());
	}

	// Public control methods
	public async sendSelectReq(): Promise<SelectStatus> {
		const systemBytes = this.getNextSystemBytes();
		const msg = HsmsMessage.selectReq(systemBytes);

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this._transactions.delete(systemBytes);
				reject(new Error("T6 Timeout waiting for Select Rsp"));
			}, this.timeoutT6 * 1000);

			this._transactions.set(systemBytes, {
				resolve: (rsp) => {
					resolve(rsp.func as SelectStatus);
				},
				reject,
				timer,
			});

			this.sendBuffer(msg.toBuffer()).catch((err: unknown) => {
				clearTimeout(timer);
				this._transactions.delete(systemBytes);
				reject(err instanceof Error ? err : new Error(String(err)));
			});
		});
	}

	public async sendLinkTestReq(): Promise<void> {
		const systemBytes = this.getNextSystemBytes();
		const msg = HsmsMessage.linkTestReq(systemBytes);

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this._transactions.delete(systemBytes);
				reject(new Error("T6 Timeout waiting for LinkTest Rsp"));
			}, this.timeoutT6 * 1000);

			this._transactions.set(systemBytes, {
				resolve: () => {
					resolve();
				},
				reject,
				timer,
			});

			this.sendBuffer(msg.toBuffer()).catch((err: unknown) => {
				clearTimeout(timer);
				this._transactions.delete(systemBytes);
				reject(err instanceof Error ? err : new Error(String(err)));
			});
		});
	}

	public async sendSeparateReq(): Promise<void> {
		const systemBytes = this.getNextSystemBytes();
		const msg = HsmsMessage.separateReq(systemBytes);
		await this.sendBuffer(msg.toBuffer());
		this.state = HsmsState.Connected;
	}
}
