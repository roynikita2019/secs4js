import { Secs1SerialCommunicator, SecsMessage, L, A } from "../src/index.js";

async function SerialPassive() {
	const passive = new Secs1SerialCommunicator({
		path: "COM5",
		baudRate: 9600,
		deviceId: 10,
		isEquip: true,
	});

	passive.on("message", (msg: SecsMessage) => {
		void (async () => {
			if (msg.stream === 1 && msg.func === 1) {
				await passive.reply(msg, 1, 2, L(A("MDLN-A"), A("SOFTREV-1")));
			}
			console.log(`Passive received: ${msg.toSml()}`);
		})();
	});

	await passive.open();
	console.log("Passive opened");
}

SerialPassive().catch((err) => console.error(err));
