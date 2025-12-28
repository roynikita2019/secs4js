import { Server, createServer } from "net";
import {
	HsmsCommunicator,
	HsmsCommunicatorConfig,
} from "./HsmsCommunicator.js";

export class HsmsPassiveCommunicator extends HsmsCommunicator {
	private server: Server | null = null;

	async open(): Promise<void> {
		if (this.server) {
			return; // Already listening
		}

		return new Promise((resolve, reject) => {
			this.server = createServer((socket) => {
				// HSMS-SS supports only one connection.
				// If we already have a valid connection, reject the new one.
				if (this.socket && !this.socket.destroyed) {
					console.warn("Rejecting new connection (HSMS-SS Single Session)");
					socket.destroy();
					return;
				}

				console.log(
					`Accepted connection from ${socket.remoteAddress ?? "unknown"}:${socket.remotePort ?? "unknown"}`,
				);
				this.handleSocketEvents(socket);
			});

			const onError = (err: Error) => {
				this.server = null;
				reject(err);
			};

			this.server.once("error", onError);

			this.server.listen(this.port, this.ip, () => {
				this.server?.removeListener("error", onError);
				resolve();
			});
		});
	}

	async close(): Promise<void> {
		// Close client connection first
		if (this.socket) {
			this.socket.end();
			this.socket.destroy();
			this.socket = null;
		}

		// Stop listening
		const server = this.server;
		if (server) {
			return new Promise((resolve, reject) => {
				server.close((err) => {
					this.server = null;
					if (err) reject(err);
					else resolve();
				});
			});
		}
	}
}
