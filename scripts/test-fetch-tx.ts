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

// Test with mainnet for finding active shielded transactions
const LIGHTWALLETD_HOST = 'na.zec.rocks:443';
const client = new walletrpc.CompactTxStreamer(
  LIGHTWALLETD_HOST,
  grpc.credentials.createSsl()
);

client.GetLatestBlock({}, (err: any, blockId: any) => {
  if (err) throw err;
  const tip = BigInt(blockId.height);
  console.log(`Current tip: ${tip}. Scanning past 30 blocks for shielded transactions...`);

  const stream = client.GetBlockRange({
    start: { height: (tip - 30n).toString() },
    end: { height: tip.toString() }
  });

  let foundTxHash: Buffer | null = null;
  let foundBlockHeight = 0;

  stream.on('data', (block: any) => {
    if (foundTxHash) return;
    if (block.vtx && block.vtx.length > 0) {
      for (const tx of block.vtx) {
        const saplingCount = tx.outputs ? tx.outputs.length : 0;
        const orchardCount = tx.actions ? tx.actions.length : 0;
        if (saplingCount > 0 || orchardCount > 0) {
          foundTxHash = Buffer.isBuffer(tx.txid) ? tx.txid : Buffer.from(tx.txid || '', 'base64');
          foundBlockHeight = block.height;
          console.log(`\nFound shielded transaction in Block #${block.height}:`);
          console.log(`  TxID (raw bytes hex): ${foundTxHash.toString('hex')}`);
          console.log(`  Sapling outputs: ${saplingCount}, Orchard actions: ${orchardCount}`);
          break;
        }
      }
    }
  });

  stream.on('end', () => {
    if (!foundTxHash) {
      console.log('No shielded tx found in recent 30 blocks.');
      process.exit(0);
    }

    console.log(`\nFetching raw transaction data for ${foundTxHash.toString('hex')} via GetTransaction...`);
    client.GetTransaction({ hash: foundTxHash }, (txErr: any, rawTx: any) => {
      if (txErr) {
        console.error('Error fetching raw tx:', txErr);
        process.exit(1);
      }
      const rawBytes = Buffer.from(rawTx.data, 'base64');
      const rawHex = rawBytes.toString('hex');
      console.log(`Successfully fetched RawTransaction! Byte length: ${rawBytes.length}`);
      console.log(`Hex prefix: ${rawHex.substring(0, 64)}...`);
      console.log('Raw transaction successfully retrieved from lightwalletd!');
      process.exit(0);
    });
  });
});
