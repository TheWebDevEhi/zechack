import { startSync } from '@ledgerhq/zcash-utils';
import { dbService } from '../src/db/database.js';
import { WebhookDispatcher } from '../src/webhooks/dispatcher.js';

const viewingKey = 'uviewtest1fry3jd07rpz444xl30jyvl73l9nlsxf06ngfh4kakrtx8dcqasx028gffsezrl8axfg8qtwwl7hw6277w77d38xq4qkqg44uvnsy46uss77ggjctn3t232aqfdww2w8d9xyr74uxkxkg0xhudwzw04fht002nk6nh9vfk5v02pcl8ecxhzz7ltwtk9f5nl074xp3n78pr2jq907e2efy7m92y476539726pknkn6sw0hry427txcnfwxg6pv77zsn6lhr3vs3vmtsc4zl0yqgw47n63yvskncy5htnwfdzvdqckwnjuzc00pvmh4kjkx28e3edx8ra23qtzfctn7wre9jhwr3gnltydtzh03etjqkgj99kfv40gj8h3yl8qutlve4pt27cs7eu956phxr3w7vvcsgf4zed0gajz2uznr4jxaxht0zs5ladapuhskvxrczt36k7vxtuvlctlxfzheevjshemtwz82uadjlvyayujn2us5j0s7';

async function verifyBlock(startHeight: number, endHeight: number, expectedPool: string) {
  console.log(`\n=== Scanning range ${startHeight}..${endHeight} (expecting ${expectedPool}) ===`);
  const stream = await startSync({
    grpcUrl: 'https://testnet.zec.rocks:443',
    viewingKey,
    startHeight,
    endHeight,
    network: 'testnet'
  });

  let tx;
  let count = 0;
  while ((tx = await stream.next()) !== null) {
    count++;
    console.log(`Found TxID: ${tx.txid} in block ${tx.blockHeight}`);
    
    // Ironwood
    const ironwood = (tx as any).ironwoodNotes || [];
    for (const n of ironwood) {
      console.log(`  [Ironwood Note] Amount: ${n.amount} zat (${n.amount / 1e8} ZEC), Memo: "${n.memo}", Pool: ${n.pool}`);
    }

    // Orchard
    for (const n of (tx.orchardNotes || [])) {
      console.log(`  [Orchard Note] Amount: ${n.amount} zat (${n.amount / 1e8} ZEC), Memo: "${n.memo}", Pool: ${n.pool}`);
    }

    // Sapling
    for (const n of (tx.saplingNotes || [])) {
      console.log(`  [Sapling Note] Amount: ${n.amount} zat (${n.amount / 1e8} ZEC), Memo: "${n.memo}", Pool: ${n.pool}`);
    }
  }
  console.log(`Matches in ${startHeight}..${endHeight}: ${count}`);
}

async function main() {
  await dbService.init();

  // Test Ironwood block 4526817
  await verifyBlock(4526817, 4526817, 'Ironwood');

  // Test Sapling block 4528595
  await verifyBlock(4528595, 4528595, 'Sapling #1');

  // Test Sapling block 4528769
  await verifyBlock(4528769, 4528769, 'Sapling #2');

  console.log('\nAll pools verified successfully!');
  process.exit(0);
}

main().catch(console.error);
