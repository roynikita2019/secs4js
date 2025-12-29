import { Socket } from "net";
import {
	HsmsCommunicator,
	HsmsCommunicatorConfig,
} from "./HsmsCommunicator.js";
import { SelectStatus } from "./enums/SelectStatus.js";

export class HsmsActiveCommunicator extends HsmsCommunicator {
	async open(): Promise<void> {
		if (this.socket && !this.socket.destroyed) {
			return; // Already open
		}

		return new Promise((resolve, reject) => {
			const socket = new Socket();

			const onError = (err: Error) => {
				socket.destroy();
				reject(err);
			};

			socket.once("error", onError);

			socket.connect(this.port, this.ip, () => {
				socket.removeListener("error", onError);
				this.handleSocketEvents(socket);
				resolve();
			});
		});
	}

	async untilConnected(): Promise<boolean> {
		return (await this.sendSelectReq()) === SelectStatus.Actived;
	}

	async close(): Promise<void> {
		if (this.socket) {
			this.socket.end();
			this.socket.destroy();
			this.socket = null;
		}
		await Promise.resolve();
	}
}
