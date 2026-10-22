import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

const PROTO_DIR = path.resolve(process.cwd(), 'proto');
const PROTO_PATH = path.join(PROTO_DIR, 'service.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_DIR]
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const walletrpc = protoDescriptor.cash.z.wallet.sdk.rpc;

const client = new walletrpc.CompactTxStreamer(
  'testnet.zec.rocks:443',
  grpc.credentials.createSsl()
);

client.GetLatestBlock({}, (err: any, blockId: any) => {
  if (err) throw err;
  const tip = BigInt(blockId.height);
  const start = tip - 1500n; // past 1500 blocks (~24-30 hours on testnet)

  console.log(`Scanning testnet blocks ${start} to ${tip} for ANY non-empty transactions...`);

  const stream = client.GetBlockRange({
    start: { height: start.toString() },
    end: { height: tip.toString() }
  });

  let totalTxs = 0;
  let shieldedTxs = 0;

  stream.on('data', (block: any) => {
    if (block.vtx && block.vtx.length > 0) {
      for (const tx of block.vtx) {
        // Index 0 is often coinbase
        totalTxs++;
        const saplingCount = tx.outputs ? tx.outputs.length : 0;
        const orchardCount = tx.actions ? tx.actions.length : 0;
        const voutCount = tx.vout ? tx.vout.length : 0;
        const vinCount = tx.vin ? tx.vin.length : 0;
        const txid = Buffer.isBuffer(tx.txid) ? tx.txid.toString('hex') : Buffer.from(tx.txid || '', 'base64').toString('hex');

        if (saplingCount > 0 || orchardCount > 0 || voutCount > 0) {
          shieldedTxs++;
          console.log(`\nBlock #${block.height} (time: ${new Date(Number(block.time) * 1000).toISOString()}):`);
          console.log(`  TxID: ${txid}`);
          console.log(`  Sapling outputs: ${saplingCount}, Orchard actions: ${orchardCount}`);
          console.log(`  Transparent: vin=${vinCount}, vout=${voutCount}`);
          if (tx.vout && tx.vout.length > 0) {
            tx.vout.forEach((vo: any, i: number) => {
              console.log(`    vout[${i}]: ${Number(vo.value) / 1e8} ZEC`);
            });
          }
        }
      }
    }
  });

  stream.on('end', () => {
    console.log(`\nFinished scanning. Total txs: ${totalTxs}, Non-empty txs: ${shieldedTxs}`);
    process.exit(0);
  });
});
