import { startSync, getChainTip } from '@ledgerhq/zcash-utils';

const KEY = 'uviewtest1fry3jd07rpz444xl30jyvl73l9nlsxf06ngfh4kakrtx8dcqasx028gffsezrl8axfg8qtwwl7hw6277w77d38xq4qkqg44uvnsy46uss77ggjctn3t232aqfdww2w8d9xyr74uxkxkg0xhudwzw04fht002nk6nh9vfk5v02pcl8ecxhzz7ltwtk9f5nl074xp3n78pr2jq907e2efy7m92y476539726pknkn6sw0hry427txcnfwxg6pv77zsn6lhr3vs3vmtsc4zl0yqgw47n63yvskncy5htnwfdzvdqckwnjuzc00pvmh4kjkx28e3edx8ra23qtzfctn7wre9jhwr3gnltydtzh03etjqkgj99kfv40gj8h3yl8qutlve4pt27cs7eu956phxr3w7vvcsgf4zed0gajz2uznr4jxaxht0zs5ladapuhskvxrczt36k7vxtuvlctlxfzheevjshemtwz82uadjlvyayujn2us5j0s7';
const GRPC_URL = 'https://testnet.zec.rocks:443';

async function scanEarlier() {
  const start = 4515000;
  const end = 4523250;
  console.log(`[EarlierScan] Scanning blocks ${start} to ${end} (${end - start} blocks)...`);

  const batchSize = 1000;
  let current = start;
  let matches = 0;

  while (current < end) {
    const chunkEnd = Math.min(end, current + batchSize);
    console.log(`Scanning ${current} to ${chunkEnd}...`);
    try {
      const stream = await startSync({
        grpcUrl: GRPC_URL,
        viewingKey: KEY,
        startHeight: current,
        endHeight: chunkEnd,
        network: 'testnet',
        maxRetries: 3
      });

      let tx;
      while ((tx = await stream.next()) !== null) {
        matches++;
        console.log(`\n========================================`);
        console.log(`>>> MATCH FOUND IN EARLIER BLOCK #${tx.blockHeight}! <<<`);
        console.log('TxID:', tx.txid);
        console.log('Time:', new Date(tx.blockTime * 1000).toISOString());
        console.log('Orchard Notes:', JSON.stringify(tx.orchardNotes, null, 2));
        console.log('Sapling Notes:', JSON.stringify(tx.saplingNotes, null, 2));
        console.log(`========================================\n`);
      }
      current = chunkEnd;
    } catch (err: any) {
      console.error(`Error in chunk ${current}-${chunkEnd}:`, err.message);
      current = Math.min(end, current + 50);
    }
  }

  console.log(`[EarlierScan] Finished. Total matches found: ${matches}`);
}

scanEarlier().catch(console.error);
