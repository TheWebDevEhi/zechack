import { startSync, getChainTip } from '@ledgerhq/zcash-utils';

const KEY = 'uviewtest1fry3jd07rpz444xl30jyvl73l9nlsxf06ngfh4kakrtx8dcqasx028gffsezrl8axfg8qtwwl7hw6277w77d38xq4qkqg44uvnsy46uss77ggjctn3t232aqfdww2w8d9xyr74uxkxkg0xhudwzw04fht002nk6nh9vfk5v02pcl8ecxhzz7ltwtk9f5nl074xp3n78pr2jq907e2efy7m92y476539726pknkn6sw0hry427txcnfwxg6pv77zsn6lhr3vs3vmtsc4zl0yqgw47n63yvskncy5htnwfdzvdqckwnjuzc00pvmh4kjkx28e3edx8ra23qtzfctn7wre9jhwr3gnltydtzh03etjqkgj99kfv40gj8h3yl8qutlve4pt27cs7eu956phxr3w7vvcsgf4zed0gajz2uznr4jxaxht0zs5ladapuhskvxrczt36k7vxtuvlctlxfzheevjshemtwz82uadjlvyayujn2us5j0s7';
const GRPC_URL = 'https://testnet.zec.rocks:443';

async function main() {
  console.log('=== Deep Debug Scanner ===');
  console.log('Key:', KEY.slice(0, 30) + '...' + KEY.slice(-20));

  try {
    const tip = await getChainTip(GRPC_URL);
    console.log('Current Testnet Chain Tip:', tip);

    const startHeight = 4523200;
    const endHeight = tip;

    console.log(`Scanning range: ${startHeight} to ${endHeight} (${endHeight - startHeight} blocks)...`);

    const stream = await startSync({
      grpcUrl: GRPC_URL,
      viewingKey: KEY,
      startHeight,
      endHeight,
      network: 'testnet',
      orchardOnly: false,
      verbose: true,
      maxRetries: 3
    });

    let tx;
    let count = 0;
    while ((tx = await stream.next()) !== null) {
      count++;
      console.log('\n>>> MATCH FOUND! <<<');
      console.log('TxID:', tx.txid);
      console.log('Block Height:', tx.blockHeight);
      console.log('Orchard Notes:', JSON.stringify(tx.orchardNotes, null, 2));
      console.log('Sapling Notes:', JSON.stringify(tx.saplingNotes, null, 2));
    }

    const stats = await stream.stats();
    console.log('\nScan finished. Matched transactions:', count);
    console.log('Stats:', stats);
  } catch (err: any) {
    console.error('Debug Scan Error:', err);
  }
}

main();
