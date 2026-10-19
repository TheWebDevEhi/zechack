import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

const PROTO_DIR = path.resolve(process.cwd(), 'proto');
const PROTO_PATH = path.join(PROTO_DIR, 'service.proto');

console.log('Loading protobuf definitions from:', PROTO_PATH);

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

const LIGHTWALLETD_HOST = process.env.LIGHTWALLETD_HOST || 'testnet.zec.rocks:443';
console.log(`Connecting to Zcash lightwalletd at ${LIGHTWALLETD_HOST}...`);

// Use secure TLS credentials for port 9067
const client = new walletrpc.CompactTxStreamer(
  LIGHTWALLETD_HOST,
  grpc.credentials.createSsl()
);

// 1. Test GetLightdInfo
client.GetLightdInfo({}, (err: any, info: any) => {
  if (err) {
    console.error('Error fetching LightdInfo:', err);
    process.exit(1);
  }
  console.log('\n--- Connected to Zcash Lightwalletd ---');
  console.log('Chain Name:', info.chainName);
  console.log('Lightwalletd Version:', info.version);
  console.log('Vendor:', info.vendor);
  console.log('Current Block Height:', info.blockHeight);
  console.log('Sapling Activation Height:', info.saplingActivationHeight);

  // 2. Test GetLatestBlock
  client.GetLatestBlock({}, (err2: any, blockId: any) => {
    if (err2) {
      console.error('Error fetching LatestBlock:', err2);
      process.exit(1);
    }
    console.log('\n--- Latest Block Tip ---');
    console.log('Height:', blockId.height);
    console.log('Hash (hex):', Buffer.from(blockId.hash, 'base64').toString('hex'));

    // 3. Test GetBlockRange (stream 3 recent blocks)
    const startHeight = BigInt(blockId.height) - 2n;
    const endHeight = BigInt(blockId.height);
    console.log(`\n--- Streaming 3 Compact Blocks (${startHeight} to ${endHeight}) ---`);

    const stream = client.GetBlockRange({
      start: { height: startHeight.toString() },
      end: { height: endHeight.toString() }
    });

    let count = 0;
    stream.on('data', (compactBlock: any) => {
      count++;
      console.log(`\n[Block #${compactBlock.height}]`);
      console.log(`  Hash: ${Buffer.from(compactBlock.hash || '', 'base64').toString('hex')}`);
      console.log(`  Transactions: ${compactBlock.vtx ? compactBlock.vtx.length : 0}`);
      if (compactBlock.vtx && compactBlock.vtx.length > 0) {
        compactBlock.vtx.forEach((tx: any, idx: number) => {
          console.log(`    Tx #${idx}: txid hash = ${Buffer.from(tx.hash || '', 'base64').toString('hex')}`);
          console.log(`      Outputs: Sapling=${tx.outputs ? tx.outputs.length : 0}, Orchard actions=${tx.actions ? tx.actions.length : 0}`);
        });
      }
    });

    stream.on('end', () => {
      console.log(`\nSuccessfully received ${count} compact blocks!`);
      console.log('gRPC test completed successfully.');
      process.exit(0);
    });

    stream.on('error', (streamErr: any) => {
      console.error('Stream error:', streamErr);
      process.exit(1);
    });
  });
});
