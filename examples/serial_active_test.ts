import { A, L, Secs1SerialCommunicator, SecsMessage } from "../src/index.js";

async function SerialActive() {
	const active = new Secs1SerialCommunicator({
		path: "COM5",
		baudRate: 9600,
		deviceId: 10,
		isEquip: false,
	});

	active.on("message", (msg: SecsMessage) => {
		void (async () => {
			console.log(`Active received: ${msg.toSml()}`);
			if (msg.stream === 1 && msg.func === 1) {
				await active.reply(msg, 1, 2, L(A("MDLN-A"), A("SOFTREV-1")));
			}
		})();
	});

	await active.open();
	console.log("Active opened");
}

SerialActive().catch((err) => console.error(err));
