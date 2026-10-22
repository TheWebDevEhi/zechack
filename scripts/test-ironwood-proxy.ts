import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { startSync } from '@ledgerhq/zcash-utils';

const KEY = 'uviewtest1fry3jd07rpz444xl30jyvl73l9nlsxf06ngfh4kakrtx8dcqasx028gffsezrl8axfg8qtwwl7hw6277w77d38xq4qkqg44uvnsy46uss77ggjctn3t232aqfdww2w8d9xyr74uxkxkg0xhudwzw04fht002nk6nh9vfk5v02pcl8ecxhzz7ltwtk9f5nl074xp3n78pr2jq907e2efy7m92y476539726pknkn6sw0hry427txcnfwxg6pv77zsn6lhr3vs3vmtsc4zl0yqgw47n63yvskncy5htnwfdzvdqckwnjuzc00pvmh4kjkx28e3edx8ra23qtzfctn7wre9jhwr3gnltydtzh03etjqkgj99kfv40gj8h3yl8qutlve4pt27cs7eu956phxr3w7vvcsgf4zed0gajz2uznr4jxaxht0zs5ladapuhskvxrczt36k7vxtuvlctlxfzheevjshemtwz82uadjlvyayujn2us5j0s7';
const UPSTREAM = 'testnet.zec.rocks:443';
const PROXY_PORT = 9067;

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

// Create upstream client
const upstream = new walletrpc.CompactTxStreamer(
  UPSTREAM,
  grpc.credentials.createSsl()
);

// Create local proxy server
const server = new grpc.Server();

function transformBlock(block: any): any {
  if (block.vtx) {
    for (const tx of block.vtx) {
      if ((!tx.actions || tx.actions.length === 0) && tx.ironwoodActions && tx.ironwoodActions.length > 0) {
        tx.actions = tx.ironwoodActions;
      }
    }
  }
  return block;
}

server.addService(walletrpc.CompactTxStreamer.service, {
  GetLatestBlock: (call: any, callback: any) => {
    upstream.GetLatestBlock(call.request, callback);
  },
  GetBlock: (call: any, callback: any) => {
    upstream.GetBlock(call.request, (err: any, block: any) => {
      if (err) return callback(err);
      callback(null, transformBlock(block));
    });
  },
  GetBlockRange: (call: any) => {
    const upstreamStream = upstream.GetBlockRange(call.request);
    upstreamStream.on('data', (block: any) => {
      call.write(transformBlock(block));
    });
    upstreamStream.on('end', () => call.end());
    upstreamStream.on('error', (err: any) => call.destroy(err));
  },
  GetTransaction: (call: any, callback: any) => {
    upstream.GetTransaction(call.request, callback);
  },
  GetLightdInfo: (call: any, callback: any) => {
    upstream.GetLightdInfo(call.request, callback);
  }
});

server.bindAsync(`127.0.0.1:${PROXY_PORT}`, grpc.ServerCredentials.createInsecure(), async (err, port) => {
  if (err) {
    console.error('Proxy failed to bind:', err);
    process.exit(1);
  }
  console.log(`[Proxy] Listening on 127.0.0.1:${port}, forwarding to ${UPSTREAM}`);

  try {
    console.log('[Test] Scanning block 4523503 via Ironwood Bridge...');
    const stream = await startSync({
      grpcUrl: `http://127.0.0.1:${PROXY_PORT}`,
      viewingKey: KEY,
      startHeight: 4523502,
      endHeight: 4523504,
      network: 'testnet',
      maxRetries: 3
    });

    let tx;
    let count = 0;
    while ((tx = await stream.next()) !== null) {
      count++;
      console.log('\n🎉🎉🎉 [MATCH FOUND VIA IRONWOOD BRIDGE!] 🎉🎉🎉');
      console.log('TxID:', tx.txid);
      console.log('Block Height:', tx.blockHeight);
      console.log('Orchard Notes:', JSON.stringify(tx.orchardNotes, null, 2));
      console.log('Sapling Notes:', JSON.stringify(tx.saplingNotes, null, 2));
    }

    const stats = await stream.stats();
    console.log('\n[Test] Finished. Matches:', count, 'Stats:', stats);
  } catch (syncErr: any) {
    console.error('[Test] Scan error:', syncErr);
  } finally {
    server.forceShutdown();
    process.exit(0);
  }
});
