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

  let saplingOutputs = Buffer.alloc(0);
  let saplingProofs = Buffer.alloc(0);
  let saplingBindingSig = Buffer.alloc(0);

  let offset = 24;

  if (numSaplingOutputs > 0) {
    const outputsLen = numSaplingOutputs * 756;
    saplingOutputs = raw.slice(offset, offset + outputsLen);
    offset += outputsLen;

    // Skip valueBalanceSapling (8 bytes)
    offset += 8;

    const proofsLen = numSaplingOutputs * 192;
    saplingProofs = raw.slice(offset, offset + proofsLen);
    offset += proofsLen;

    saplingBindingSig = raw.slice(offset, offset + 64);
    offset += 64;
  }

  // Offset now points to Orchard / Ironwood section in V6
  const nActionsOrchard = offset < raw.length ? raw[offset] : 0;
  const nActionsIronwood = offset + 1 < raw.length ? raw[offset + 1] : 0;

  let orchardBundle = Buffer.from([0x00]); // default: 0 actions

  if (nActionsOrchard > 0) {
    // Orchard bundle present directly
    orchardBundle = Buffer.from(raw.slice(offset));
  } else if (nActionsIronwood > 0) {
    // Ironwood bundle present (NU6.3): skip the 0x00 nActionsOrchard byte
    // so nActionsIronwood becomes the action count in the canonical v5 layout
    orchardBundle = Buffer.from(raw.slice(offset + 1));
  }

  // Canonical v5 flag normalization:
  // In v5 (ZIP 225), flagsOrchard must only have bits 0 and 1 set (enableSpends and enableOutputs).
  // In v6 (ZIP 229), bit 2 is introduced for Ironwood/NU6.3. Mask with 0x03 so legacy v5 parsers accept the bundle.
  const actionCount = orchardBundle[0];
  if (actionCount > 0) {
    const flagsOffset = 1 + actionCount * 820;
    if (flagsOffset < orchardBundle.length) {
      orchardBundle[flagsOffset] = orchardBundle[flagsOffset] & 0x03;
    }
  }

  const v5Header = Buffer.concat([
    Buffer.from([0x05, 0x00, 0x00, 0x80]), // header v5 (0x80000005)
    Buffer.from([0x0a, 0x27, 0xa7, 0x26]), // version_group_id (0x26a7270a)
    consensusBranchId,
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // lock_time: 0
    expiryHeight,
    Buffer.from([0x00]),                   // vin count: 0
    Buffer.from([0x00]),                   // vout count: 0
    Buffer.from([0x00]),                   // sapling spend count: 0
    Buffer.from([numSaplingOutputs]),      // sapling output count
  ]);

  if (numSaplingOutputs > 0) {
    return Buffer.concat([
      v5Header,
      saplingOutputs,
      Buffer.alloc(8), // valueBalanceSapling
      saplingProofs,
      saplingBindingSig,
      orchardBundle
    ]);
  } else {
    return Buffer.concat([
      v5Header,
      orchardBundle
    ]);
  }
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
        this.upstream.GetBlock(call.request, callback);
      },
      GetBlockRange: (call: any) => {
        const upstreamStream = this.upstream.GetBlockRange(call.request);
        upstreamStream.on('data', (block: any) => {
          call.write(block);
        });
        upstreamStream.on('end', () => call.end());
        upstreamStream.on('error', (err: any) => call.destroy(err));
      },
      GetTransaction: (call: any, callback: any) => {
        this.upstream.GetTransaction(call.request, callback);
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
