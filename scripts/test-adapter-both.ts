import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { startSync } from '@ledgerhq/zcash-utils';

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

const UPSTREAM = 'testnet.zec.rocks:443';
const upstream = new walletrpc.CompactTxStreamer(UPSTREAM, grpc.credentials.createSsl());

export function transformV6toV5(raw: Buffer, network: 'testnet' | 'mainnet' = 'testnet'): Buffer {
  if (raw.length < 24) return raw;
  const header = raw.readUInt32LE(0);
  if (header !== 0x80000006) return raw; // Not a v6 transaction, leave as-is

  const consensusBranchId = network === 'mainnet'
    ? Buffer.from([0x21, 0x96, 0x51, 0x37]) // 0x37519621 NU5 mainnet
    : Buffer.from([0xb4, 0xd0, 0xd6, 0xc2]); // 0xc2d6d0b4 NU5 testnet

  const expiryHeight = raw.slice(16, 20);
  const numSaplingOutputs = raw[23];

  if (numSaplingOutputs > 0) {
    // Sapling outputs present
    const saplingOutputs = raw.slice(24, 24 + numSaplingOutputs * 756);
    const proofs = raw.slice(24 + numSaplingOutputs * 756, 24 + numSaplingOutputs * 756 + numSaplingOutputs * 192);
    const bindingSig = raw.slice(24 + numSaplingOutputs * 756 + numSaplingOutputs * 192, 24 + numSaplingOutputs * 756 + numSaplingOutputs * 192 + 64);

    return Buffer.concat([
      Buffer.from([0x05, 0x00, 0x00, 0x80]), // header 0x80000005
      Buffer.from([0x0a, 0x27, 0xa7, 0x26]), // version_group_id 0x26a7270a
      consensusBranchId,
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // lock_time
      expiryHeight,
      Buffer.from([0x00]),                   // vin count
      Buffer.from([0x00]),                   // vout count
      Buffer.from([0x00]),                   // sapling spend count
      Buffer.from([numSaplingOutputs]),      // sapling output count
      saplingOutputs,                        // output descriptions
      Buffer.alloc(8),                       // valueBalanceSapling
      proofs,                                // zkproofs
      bindingSig,                            // bindingSig
      Buffer.from([0x00])                    // orchard actions count: 0
    ]);
  }

  // Pure Orchard / Ironwood transaction (0 Sapling outputs)
  // In v6 with 0 sapling outputs, raw[24] is flags, raw[25] is numActions
  const numActions = raw[25];
  if (numActions > 0) {
    const orchardPart = raw.slice(24);
    return Buffer.concat([
      Buffer.from([0x05, 0x00, 0x00, 0x80]), // header v5
      Buffer.from([0x0a, 0x27, 0xa7, 0x26]), // version_group_id
      consensusBranchId,
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // lock_time
      expiryHeight,
      Buffer.from([0x00]),                   // vin count
      Buffer.from([0x00]),                   // vout count
      Buffer.from([0x00]),                   // sapling spend count: 0
      Buffer.from([0x00]),                   // sapling output count: 0
      orchardPart                            // orchard bundle
    ]);
  }

  return raw;
}

const server = new grpc.Server();

server.addService(walletrpc.CompactTxStreamer.service, {
  GetLatestBlock: (call: any, cb: any) => upstream.GetLatestBlock(call.request, cb),
  GetBlock: (call: any, cb: any) => upstream.GetBlock(call.request, cb),
  GetBlockRange: (call: any) => {
    const s = upstream.GetBlockRange(call.request);
    s.on('data', (b: any) => call.write(b));
    s.on('end', () => call.end());
    s.on('error', (err: any) => call.destroy(err));
  },
  GetTransaction: (call: any, cb: any) => {
    upstream.GetTransaction(call.request, (err: any, res: any) => {
      if (err) return cb(err);
      const original = Buffer.from(res.data, 'base64');
      const transformed = transformV6toV5(original, 'testnet');
      cb(null, { data: transformed.toString('base64') });
    });
  },
  GetLightdInfo: (call: any, cb: any) => upstream.GetLightdInfo(call.request, cb)
});

const PORT = 9205;
server.bindAsync('127.0.0.1:' + PORT, grpc.ServerCredentials.createInsecure(), async (err) => {
  if (err) throw err;
  console.log(`[Adapter Test] Proxy running on 127.0.0.1:${PORT}`);
  const KEY = 'uviewtest1fry3jd07rpz444xl30jyvl73l9nlsxf06ngfh4kakrtx8dcqasx028gffsezrl8axfg8qtwwl7hw6277w77d38xq4qkqg44uvnsy46uss77ggjctn3t232aqfdww2w8d9xyr74uxkxkg0xhudwzw04fht002nk6nh9vfk5v02pcl8ecxhzz7ltwtk9f5nl074xp3n78pr2jq907e2efy7m92y476539726pknkn6sw0hry427txcnfwxg6pv77zsn6lhr3vs3vmtsc4zl0yqgw47n63yvskncy5htnwfdzvdqckwnjuzc00pvmh4kjkx28e3edx8ra23qtzfctn7wre9jhwr3gnltydtzh03etjqkgj99kfv40gj8h3yl8qutlve4pt27cs7eu956phxr3w7vvcsgf4zed0gajz2uznr4jxaxht0zs5ladapuhskvxrczt36k7vxtuvlctlxfzheevjshemtwz82uadjlvyayujn2us5j0s7';

  // Test scan block 4526882 (the Sapling v6 transaction 045095ce...)
  console.log('[Adapter Test] Scanning block 4526882 (v6 transaction)...');
  const stream = await startSync({
    grpcUrl: `http://127.0.0.1:${PORT}`,
    viewingKey: KEY,
    startHeight: 4526881,
    endHeight: 4526883,
    network: 'testnet'
  });

  let tx;
  let count = 0;
  while ((tx = await stream.next()) !== null) {
    count++;
    console.log('✅ Matched Transaction:');
    console.log('   TxID:', tx.txid);
    console.log('   Block Height:', tx.blockHeight);
    console.log('   Sapling Notes:', JSON.stringify(tx.saplingNotes, null, 2));
  }

  console.log('[Adapter Test] Scan complete. Matches:', count);
  server.forceShutdown();
  process.exit(0);
});
