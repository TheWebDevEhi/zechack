import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { startSync, ShieldedTransaction } from '@ledgerhq/zcash-utils';

const PROTO_DIR = path.resolve(process.cwd(), 'proto');
const PROTO_PATH = path.join(PROTO_DIR, 'service.proto');

let cachedClient: any = null;
let cachedTargetUrl: string = '';

function getGrpcClient(targetUrl: string): any {
  if (cachedClient && cachedTargetUrl === targetUrl) {
    return cachedClient;
  }

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

  const cleanHost = targetUrl.replace(/^https?:\/\//, '');
  const isSecure = targetUrl.startsWith('https://') || targetUrl.includes(':443');
  const creds = isSecure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();

  cachedClient = new walletrpc.CompactTxStreamer(cleanHost, creds);
  cachedTargetUrl = targetUrl;
  return cachedClient;
}

export interface VerifyTxParams {
  txid: string;
  blockHeight: number;
  viewingKeyString: string;
  targetGrpcUrl: string;
  network: 'testnet' | 'mainnet';
}

export interface VerifiedTxResult {
  verified: boolean;
  error?: string;
  blockHash?: string;
  blockTime?: number;
  pool?: 'Orchard' | 'Sapling' | 'Ironwood';
  amountZat?: number;
  amountZec?: number;
  memoText?: string;
  outputIndex?: number;
  transferType?: string;
}

/**
 * Performs cryptographically grounded on-chain transaction verification:
 * 1. Queries trusted Zcash lightwalletd for the block header and inclusion at blockHeight.
 * 2. Confirms block hash and existence.
 * 3. Trial-decrypts the shielded transaction using the supplied viewing key via startSync.
 * 4. Derives the real note amount, pool, output index, and memo from verified chain data.
 * 5. Rejects any transaction that cannot be verified or does not belong to the viewing key.
 */
export async function verifyTransactionOnChain(params: VerifyTxParams): Promise<VerifiedTxResult> {
  const { txid, blockHeight, viewingKeyString, targetGrpcUrl, network } = params;
  const cleanTxid = txid.toLowerCase().trim();

  // 1. Fetch compact block from lightwalletd to verify block existence & inclusion
  let blockHash = '';
  let blockTime = Math.floor(Date.now() / 1000);

  try {
    const client = getGrpcClient(targetGrpcUrl);
    const block = await new Promise<any>((resolve, reject) => {
      client.GetBlock({ height: blockHeight }, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res);
      });
    });

    if (!block || !block.hash) {
      return {
        verified: false,
        error: `On-chain verification failed: Block #${blockHeight} not found on ${network}.`
      };
    }

    blockHash = Buffer.from(block.hash).toString('hex');
    if (block.time) {
      blockTime = Number(block.time);
    }
  } catch (err: any) {
    return {
      verified: false,
      error: `Lightwalletd block lookup failed for height #${blockHeight}: ${err.message}`
    };
  }

  // 2. Perform trial-decryption with viewing key on this specific block
  try {
    const stream = await startSync({
      grpcUrl: targetGrpcUrl,
      viewingKey: viewingKeyString,
      startHeight: blockHeight,
      endHeight: blockHeight,
      network,
      maxRetries: 2
    });

    let matchedTx: ShieldedTransaction | null = null;
    let currentTx: ShieldedTransaction | null;

    while ((currentTx = await stream.next()) !== null) {
      if (currentTx.txid.toLowerCase() === cleanTxid) {
        matchedTx = currentTx;
        break;
      }
    }

    if (!matchedTx) {
      return {
        verified: false,
        error: `On-chain verification failed: Transaction ${cleanTxid} in block #${blockHeight} does not contain any notes decryptable with the provided viewing key.`
      };
    }

    // 3. Derive verified metadata from the decrypted note
    const ironwoodNotes = (matchedTx as any).ironwoodNotes;
    if (ironwoodNotes && ironwoodNotes.length > 0) {
      const note = ironwoodNotes[0];
      const amountZat = Number(note.amount);
      return {
        verified: true,
        blockHash: (matchedTx as any).blockHash || blockHash,
        blockTime: matchedTx.blockTime || blockTime,
        pool: 'Ironwood',
        amountZat,
        amountZec: amountZat / 100_000_000,
        memoText: note.memo || '',
        outputIndex: (note as any).outputIndex ?? (note as any).actionIndex ?? 0,
        transferType: note.transferType || 'incoming'
      };
    }

    if (matchedTx.orchardNotes && matchedTx.orchardNotes.length > 0) {
      const note = matchedTx.orchardNotes[0];
      const amountZat = Number(note.amount);
      return {
        verified: true,
        blockHash: (matchedTx as any).blockHash || blockHash,
        blockTime: matchedTx.blockTime || blockTime,
        pool: 'Orchard',
        amountZat,
        amountZec: amountZat / 100_000_000,
        memoText: note.memo || '',
        outputIndex: (note as any).outputIndex ?? (note as any).actionIndex ?? 0,
        transferType: note.transferType || 'incoming'
      };
    }

    if (matchedTx.saplingNotes && matchedTx.saplingNotes.length > 0) {
      const note = matchedTx.saplingNotes[0];
      const amountZat = Number(note.amount);
      return {
        verified: true,
        blockHash: (matchedTx as any).blockHash || blockHash,
        blockTime: matchedTx.blockTime || blockTime,
        pool: 'Sapling',
        amountZat,
        amountZec: amountZat / 100_000_000,
        memoText: note.memo || '',
        outputIndex: (note as any).outputIndex ?? (note as any).actionIndex ?? 0,
        transferType: note.transferType || 'incoming'
      };
    }

    return {
      verified: false,
      error: `Transaction ${cleanTxid} was matched on-chain, but contained zero valid shielded output notes.`
    };
  } catch (err: any) {
    return {
      verified: false,
      error: `On-chain note trial-decryption failed: ${err.message}`
    };
  }
}
