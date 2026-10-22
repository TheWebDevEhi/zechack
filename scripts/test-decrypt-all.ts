import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { decrypt_tx } from '@ledgerhq/zcash-decrypt';

const KEY = 'uviewtest1fry3jd07rpz444xl30jyvl73l9nlsxf06ngfh4kakrtx8dcqasx028gffsezrl8axfg8qtwwl7hw6277w77d38xq4qkqg44uvnsy46uss77ggjctn3t232aqfdww2w8d9xyr74uxkxkg0xhudwzw04fht002nk6nh9vfk5v02pcl8ecxhzz7ltwtk9f5nl074xp3n78pr2jq907e2efy7m92y476539726pknkn6sw0hry427txcnfwxg6pv77zsn6lhr3vs3vmtsc4zl0yqgw47n63yvskncy5htnwfdzvdqckwnjuzc00pvmh4kjkx28e3edx8ra23qtzfctn7wre9jhwr3gnltydtzh03etjqkgj99kfv40gj8h3yl8qutlve4pt27cs7eu956phxr3w7vvcsgf4zed0gajz2uznr4jxaxht0zs5ladapuhskvxrczt36k7vxtuvlctlxfzheevjshemtwz82uadjlvyayujn2us5j0s7';

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

const TXIDS = [
  '54fb4f7e9ceb807d7c3cd3cbef4ea3c9225880cb6a15f03d5f3b6afd447266cb',
  'afc15a9f0028d114b2e1aa2ef095b0ac49bd12680a81a2e693f0615b554b998e',
  '53371702a28673c1abc5626cc39d4ac41120a3d4a16f86cef46970a17672b5a8',
  '60fc9b1f569c5cb56d1b581e27027a4a54247fc7c894a99b24c459a59ea2e506',
  'c0afbb32d53895c015baba0c77374263e0326f133e1e456dfe8a64d1e00085f0',
  'd547952a2baaa9a561217f94d0f6f81498c755a8c11f7c81156d0636d0971e84',
  '76da05e265b98fd5eaa76c7592b11b2971da6e6893f133e808562f1649bf73a3'
];

async function checkTx(txidHex: string): Promise<void> {
  return new Promise((resolve) => {
    // Note: lightwalletd expects tx hash in little-endian (or big-endian depending on RPC).
    // In compact block protobuf, txid is 32 raw bytes.
    // In Zcash display, txid is reversed byte order (RPC display order).
    const hashBuf = Buffer.from(txidHex, 'hex');
    const reversedHash = Buffer.from([...hashBuf].reverse());

    // Try both byte orders for GetTransaction
    client.GetTransaction({ hash: hashBuf }, (err: any, res: any) => {
      let rawData: Buffer | null = null;
      if (!err && res && res.data) {
        rawData = Buffer.from(res.data, 'base64');
      } else {
        // Try reversed
        client.GetTransaction({ hash: reversedHash }, (err2: any, res2: any) => {
          if (!err2 && res2 && res2.data) {
            rawData = Buffer.from(res2.data, 'base64');
          }
          processRaw(rawData, txidHex);
          resolve();
        });
        return;
      }
      processRaw(rawData, txidHex);
      resolve();
    });
  });
}

function processRaw(rawData: Buffer | null, txid: string) {
  if (!rawData) {
    console.log(`[Tx ${txid}] Could not retrieve raw tx.`);
    return;
  }
  const hex = rawData.toString('hex');
  try {
    const result = decrypt_tx(hex, KEY);
    console.log(`[Tx ${txid}] Decrypt result:`, JSON.stringify(result));
    if ((result.orchard_outputs && result.orchard_outputs.length > 0) ||
        (result.sapling_outputs && result.sapling_outputs.length > 0)) {
      console.log(`>>> SUCCESS! MATCH FOUND for Tx ${txid}! <<<`);
    }
  } catch (err: any) {
    console.log(`[Tx ${txid}] Decrypt failed with error:`, err.message || err);
  }
}

async function run() {
  for (const txid of TXIDS) {
    await checkTx(txid);
  }
  process.exit(0);
}

run();
