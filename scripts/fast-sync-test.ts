import { startSync, getChainTip } from '@ledgerhq/zcash-utils';

const KEY = 'uviewtest1fry3jd07rpz444xl30jyvl73l9nlsxf06ngfh4kakrtx8dcqasx028gffsezrl8axfg8qtwwl7hw6277w77d38xq4qkqg44uvnsy46uss77ggjctn3t232aqfdww2w8d9xyr74uxkxkg0xhudwzw04fht002nk6nh9vfk5v02pcl8ecxhzz7ltwtk9f5nl074xp3n78pr2jq907e2efy7m92y476539726pknkn6sw0hry427txcnfwxg6pv77zsn6lhr3vs3vmtsc4zl0yqgw47n63yvskncy5htnwfdzvdqckwnjuzc00pvmh4kjkx28e3edx8ra23qtzfctn7wre9jhwr3gnltydtzh03etjqkgj99kfv40gj8h3yl8qutlve4pt27cs7eu956phxr3w7vvcsgf4zed0gajz2uznr4jxaxht0zs5ladapuhskvxrczt36k7vxtuvlctlxfzheevjshemtwz82uadjlvyayujn2us5j0s7';
const GRPC_URL = 'https://testnet.zec.rocks:443';

async function fastSync() {
  const tip = await getChainTip(GRPC_URL);
  console.log(`[FastSync] Current Tip: ${tip}`);

  let current = 4523250;
  const batchSize = 1000;
  let totalMatches = 0;

  const startTime = Date.now();

  while (current < tip) {
    const end = Math.min(tip, current + batchSize);
    console.log(`[FastSync] Scanning ${current} to ${end} (${end - current} blocks)...`);

    try {
      const stream = await startSync({
        grpcUrl: GRPC_URL,
        viewingKey: KEY,
        startHeight: current,
        endHeight: end,
        network: 'testnet',
        maxRetries: 3
      });

      let tx;
      while ((tx = await stream.next()) !== null) {
        totalMatches++;
        console.log(`\n>>> [MATCH FOUND] TxID: ${tx.txid} in block #${tx.blockHeight} <<<`);
        console.log('Orchard Notes:', JSON.stringify(tx.orchardNotes, null, 2));
        console.log('Sapling Notes:', JSON.stringify(tx.saplingNotes, null, 2));
      }
      current = end;
    } catch (err: any) {
      console.error(`[FastSync] Error in batch ${current}-${end}:`, err.message);
      current = Math.min(tip, current + 50);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n[FastSync] Completed! Total matches: ${totalMatches}. Time: ${elapsed}s`);
}

fastSync().catch(console.error);
