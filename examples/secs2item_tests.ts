import { A, L, U1 } from "../src/index.js";
import { SmlParser } from "../src/sml/SmlParser.js";

function testSecs2ItemAscii() {
	const secs2Item = L(L(A("Hello World"), U1(123)));
	console.log(secs2Item.toSml());
	console.log(secs2Item[0][0].type);

	const sml = `
    S1F13
    <L
        <B 0x20>
        <A "Hello World">
    >.
    `;

	const smlBody = `
    <L
        <B 0x20>
        <A "Hello World">
    >.
    `;

	const parsedMessage = SmlParser.parse(sml);
	console.log(
		parsedMessage.stream,
		parsedMessage.func,
		parsedMessage.wBit,
		parsedMessage.body?.[0].value as Buffer,
	);

	const parsedBody = SmlParser.parseBody(smlBody);
	console.log(parsedBody?.toSml());
}

testSecs2ItemAscii();
