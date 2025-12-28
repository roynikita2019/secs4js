// import { HsmsActiveCommunicator } from "../src/hsms/HsmsActiveCommunicator.js";
import { HsmsActiveCommunicator } from "secs4js";
import { HsmsPassiveCommunicator } from "secs4js";
import { SecsMessage } from "secs4js";
import { createListItem, createAsciiItem } from "secs4js";

async function main() {
	const passive = new HsmsPassiveCommunicator({
		ip: "127.0.0.1",
		port: 5000,
		deviceId: 10,
		isEquip: true,
	});

	passive.on("message", (msg: SecsMessage) => {
		void (async () => {
			console.log(`Passive received: ${msg.toSml()}`);
			if (msg.stream === 1 && msg.func === 1) {
				await passive.reply(
					msg,
					1,
					2,
					createListItem(
						createAsciiItem("MDLN-A"),
						createAsciiItem("SOFTREV-1"),
					),
					// new Secs2ItemList([
					// 	new Secs2ItemAscii("MDLN-A"),
					// 	new Secs2ItemAscii("SOFTREV-1"),
					// ]),
				);
				console.log("Passive replied S1F2");
			}
		})();
	});

	await passive.open();
	setTimeout(() => {
		return 0;
	}, 10000000);
	console.log("Passive opened");

	// const active = new HsmsActiveCommunicator({
	// 	ip: "127.0.0.1",
	// 	port: 5000,
	// 	deviceId: 10,
	// 	isEquip: false,
	// });

	// await active.open();
	// console.log("Active opened");

	// // Active usually sends SelectReq first
	// const status = await active.sendSelectReq();
	// console.log(`Active Selected: ${status}`);

	// const reply = await active.send(1, 1, true);
	// console.log(`Active received reply: ${reply?.toSml()}`);

	// await active.close();
	// await passive.close();
}

main().catch(console.error);
