import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { config } from '../config.js';

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

/**
 * Transforms a Zcash Version 6 (ZIP 229 / NU6.3) raw transaction into a
 * canonical Version 5 container format so legacy Rust deserializers can parse
 * shielded Sapling and Orchard note plaintexts and memos without failing.
 */
export function transformV6toV5(raw: Buffer, network: 'testnet' | 'mainnet' = 'testnet'): Buffer {
  if (raw.length < 24) return raw;
  const header = raw.readUInt32LE(0);
  if (header !== 0x80000006) return raw; // Not a v6 transaction, leave unchanged

  const consensusBranchId = network === 'mainnet'
    ? Buffer.from([0x21, 0x96, 0x51, 0x37]) // 0x37519621 (NU5 Mainnet)
    : Buffer.from([0xb4, 0xd0, 0xd6, 0xc2]); // 0xc2d6d0b4 (NU5 Testnet)

  const expiryHeight = raw.slice(16, 20);
  const numSaplingOutputs = raw[23];

  if (numSaplingOutputs > 0) {
    // Sapling bundle present in v6 layout:
    // Fixed 756-byte output descriptions followed by zkproofs (192 bytes each) and binding signature (64 bytes)
    const saplingOutputs = raw.slice(24, 24 + numSaplingOutputs * 756);
    const proofs = raw.slice(24 + numSaplingOutputs * 756, 24 + numSaplingOutputs * 756 + numSaplingOutputs * 192);
    const bindingSig = raw.slice(24 + numSaplingOutputs * 756 + numSaplingOutputs * 192, 24 + numSaplingOutputs * 756 + numSaplingOutputs * 192 + 64);

    return Buffer.concat([
      Buffer.from([0x05, 0x00, 0x00, 0x80]), // header v5 (0x80000005)
      Buffer.from([0x0a, 0x27, 0xa7, 0x26]), // version_group_id (0x26a7270a)
      consensusBranchId,
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // lock_time: 0
      expiryHeight,
      Buffer.from([0x00]),                   // vin count: 0
      Buffer.from([0x00]),                   // vout count: 0
      Buffer.from([0x00]),                   // sapling spend count: 0
      Buffer.from([numSaplingOutputs]),      // sapling output count
      saplingOutputs,                        // Sapling output descriptions (756 bytes each)
      Buffer.alloc(8),                       // valueBalanceSapling
      proofs,                                // zkproofs (192 bytes each)
      bindingSig,                            // bindingSig (64 bytes)
      Buffer.from([0x00])                    // orchard actions count: 0
    ]);
  }

  // Pure Orchard / Ironwood bundle (0 Sapling outputs)
  const numActions = raw[25];
  if (numActions > 0) {
    const orchardPart = raw.slice(24);
    return Buffer.concat([
      Buffer.from([0x05, 0x00, 0x00, 0x80]), // header v5
      Buffer.from([0x0a, 0x27, 0xa7, 0x26]), // version_group_id
      consensusBranchId,
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // lock_time: 0
      expiryHeight,
      Buffer.from([0x00]),                   // vin count: 0
      Buffer.from([0x00]),                   // vout count: 0
      Buffer.from([0x00]),                   // sapling spend count: 0
      Buffer.from([0x00]),                   // sapling output count: 0
      orchardPart                            // Orchard / Ironwood bundle
    ]);
  }

  return raw;
}

/**
 * Transforms a CompactBlock by promoting ironwoodActions (Field 9) into
 * actions (Field 6) if actions is empty, allowing legacy scanners to detect Ironwood notes.
 */
function transformBlock(block: any): any {
  if (block && block.vtx) {
    for (const tx of block.vtx) {
      if ((!tx.actions || tx.actions.length === 0) && tx.ironwoodActions && tx.ironwoodActions.length > 0) {
        tx.actions = tx.ironwoodActions;
      }
    }
  }
  return block;
}

export class ProtocolAdapterProxy {
  private server: grpc.Server | null = null;
  private upstream: any = null;
  private port: number = 0;
  private isStarted: boolean = false;

  public async start(): Promise<string> {
    if (this.isStarted && this.port > 0) {
      return this.getUrl();
    }

    // Parse upstream host
    const rawUrl = config.lightwalletdUrl;
    const cleanHost = rawUrl.replace(/^https?:\/\//, '');

    // Initialize upstream gRPC client with TLS credentials
    this.upstream = new walletrpc.CompactTxStreamer(
      cleanHost,
      grpc.credentials.createSsl()
    );

    this.server = new grpc.Server();

    this.server.addService(walletrpc.CompactTxStreamer.service, {
      GetLatestBlock: (call: any, callback: any) => {
        this.upstream.GetLatestBlock(call.request, callback);
      },
      GetBlock: (call: any, callback: any) => {
        this.upstream.GetBlock(call.request, (err: any, block: any) => {
          if (err) return callback(err);
          callback(null, transformBlock(block));
        });
      },
      GetBlockRange: (call: any) => {
        const upstreamStream = this.upstream.GetBlockRange(call.request);
        upstreamStream.on('data', (block: any) => {
          call.write(transformBlock(block));
        });
        upstreamStream.on('end', () => call.end());
        upstreamStream.on('error', (err: any) => call.destroy(err));
      },
      GetTransaction: (call: any, callback: any) => {
        this.upstream.GetTransaction(call.request, (err: any, res: any) => {
          if (err) return callback(err);
          try {
            const original = Buffer.from(res.data, 'base64');
            const transformed = transformV6toV5(original, config.network);
            callback(null, { data: transformed.toString('base64') });
          } catch (adaptErr) {
            // Fallback to original if transformation encounters unexpected input
            callback(null, res);
          }
        });
      },
      GetLightdInfo: (call: any, callback: any) => {
        this.upstream.GetLightdInfo(call.request, callback);
      }
    });

    return new Promise((resolve, reject) => {
      // Bind to localhost on dynamic/ephemeral port 0 to prevent conflicts
      this.server!.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
        if (err) {
          console.error('[AdapterProxy] Failed to bind local gRPC proxy:', err.message);
          return reject(err);
        }
        this.port = boundPort;
        this.isStarted = true;
        console.log(`[AdapterProxy] Active on 127.0.0.1:${this.port} (Upstream: ${cleanHost}, V6 Auto-Adapt: ON)`);
        resolve(this.getUrl());
      });
    });
  }

  public getUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public async stop(): Promise<void> {
    if (this.server) {
      this.server.forceShutdown();
      this.server = null;
      this.isStarted = false;
      console.log('[AdapterProxy] Stopped local gRPC adapter proxy.');
    }
  }
}

export const protocolAdapterProxy = new ProtocolAdapterProxy();
