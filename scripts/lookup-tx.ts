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

const TXID = '13a20d91369da54281c14d11d0930494ba48814633ae834815a16fea073b96ca';
const hashBuf = Buffer.from(TXID, 'hex');
const hashBufRev = Buffer.from([...hashBuf].reverse());

async function checkServer(host: string, label: string): Promise<void> {
  const client = new walletrpc.CompactTxStreamer(host, grpc.credentials.createSsl());
  
  return new Promise((resolve) => {
    // 1. Try normal byte order
    client.GetTransaction({ hash: hashBuf }, (err1: any, res1: any) => {
      if (!err1 && res1 && res1.data) {
        console.log(`[${label}] FOUND (normal byte order)!`);
        console.log(`  Block Height: ${res1.height}`);
        handleTxData(res1);
        return resolve();
      }

      // 2. Try reversed byte order
      client.GetTransaction({ hash: hashBufRev }, (err2: any, res2: any) => {
        if (!err2 && res2 && res2.data) {
          console.log(`[${label}] FOUND (reversed byte order)!`);
          console.log(`  Block Height: ${res2.height}`);
          handleTxData(res2);
        } else {
          console.log(`[${label}] Not found (Error: ${err1?.message || err2?.message})`);
        }
        resolve();
      });
    });
  });
}

function handleTxData(res: any) {
  const rawData = Buffer.from(res.data, 'base64');
  console.log(`  Raw Transaction Byte Length: ${rawData.length}`);
  console.log(`  Hex: ${rawData.toString('hex')}`);
}

async function main() {
  console.log(`Searching for Transaction: ${TXID}\n`);
  await checkServer('testnet.zec.rocks:443', 'Testnet (zec.rocks)');
  await checkServer('zcash-testnet.zec.rocks:443', 'Testnet 2 (zec.rocks)');
  await checkServer('na.zec.rocks:443', 'Mainnet (na.zec.rocks)');
  process.exit(0);
}

main();
