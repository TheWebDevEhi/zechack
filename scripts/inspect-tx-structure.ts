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

client.GetBlock({ height: '4523503' }, (err: any, block: any) => {
  if (err) throw err;
  console.log('=== Block 4523503 Details ===');
  console.log('Block height:', block.height);
  console.log('Block time:', new Date(Number(block.time) * 1000).toISOString());
  console.log('vtx length:', block.vtx ? block.vtx.length : 0);

  if (block.vtx) {
    block.vtx.forEach((tx: any, idx: number) => {
      const txid = Buffer.from(tx.txid || '').toString('hex');
      const txidRev = Buffer.from([...Buffer.from(tx.txid || '')].reverse()).toString('hex');
      console.log(`\nTx #${idx}:`);
      console.log('  raw txid hex:', txid);
      console.log('  reversed txid hex:', txidRev);
      console.log('  Sapling outputs:', tx.outputs ? tx.outputs.length : 0);
      console.log('  Orchard actions:', tx.actions ? tx.actions.length : 0);
      console.log('  Transparent inputs (vin):', tx.vin ? tx.vin.length : 0);
      console.log('  Transparent outputs (vout):', tx.vout ? tx.vout.length : 0);
      if (tx.vout && tx.vout.length > 0) {
        tx.vout.forEach((vo: any, i: number) => {
          console.log(`    vout[${i}] value:`, Number(vo.value) / 1e8, 'ZEC, scriptPubKey length:', vo.scriptPubKey ? vo.scriptPubKey.length : 0);
        });
      }
    });
  }
  process.exit(0);
});
