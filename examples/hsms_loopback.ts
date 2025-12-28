import { HsmsActiveCommunicator } from '../src/hsms/HsmsActiveCommunicator.js';
import { HsmsPassiveCommunicator } from '../src/hsms/HsmsPassiveCommunicator.js';
import { SecsList, SecsAscii } from '../src/core/secs2/SecsItem.js';

async function main() {
    const passive = new HsmsPassiveCommunicator({
        ip: '127.0.0.1',
        port: 5000,
        deviceId: 10,
        isEquip: true
    });

    passive.on('message', async (msg) => {
        console.log(`Passive received: ${msg.toSml()}`);
        if (msg.stream === 1 && msg.func === 1) {
            await passive.reply(msg, 1, 2, false, new SecsList([new SecsAscii('MDLN-A'), new SecsAscii('SOFTREV-1')]));
            console.log('Passive replied S1F2');
        }
    });

    await passive.open();
    console.log('Passive opened');

    const active = new HsmsActiveCommunicator({
        ip: '127.0.0.1',
        port: 5000,
        deviceId: 10,
        isEquip: false
    });

    await active.open();
    console.log('Active opened');
    
    // Active usually sends SelectReq first
    const status = await active.sendSelectReq();
    console.log(`Active Selected: ${status}`);

    const reply = await active.send(1, 1, true);
    console.log(`Active received reply: ${reply?.toSml()}`);
    
    await active.close();
    await passive.close();
}

main().catch(console.error);
