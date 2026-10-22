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

const TXID = '13a20d91369da54281c14d11d0930494ba48814633ae834815a16fea073b96ca';
const hashBufRev = Buffer.from([...Buffer.from(TXID, 'hex')].reverse());

client.GetTransaction({ hash: hashBufRev }, (err: any, res: any) => {
  if (err) throw err;
  const raw = Buffer.from(res.data, 'base64');
  console.log('Total Raw Tx bytes:', raw.length);
  console.log('Header (version):', '0x' + raw.readUInt32LE(0).toString(16));
  console.log('Version group ID:', '0x' + raw.readUInt32LE(4).toString(16));
  console.log('Consensus branch ID:', '0x' + raw.readUInt32LE(8).toString(16));
  console.log('Lock time:', '0x' + raw.readUInt32LE(12).toString(16));
  console.log('Expiry height:', raw.readUInt32LE(16));

  // Let's inspect the rest of the bytes
  console.log('Bytes 20..100 (hex):', raw.subarray(20, 100).toString('hex'));
});
