/* tslint:disable */
/* eslint-disable */

export interface DecryptedOutput {
    amount: number;
    memo: string;
    transfer_type: string;
}

export class DecryptedTransaction {
    orchard_outputs: DecryptedOutput[];
    sapling_outputs: DecryptedOutput[];
}

export function decrypt_tx(tx_hex: string, viewing_key: string): DecryptedTransaction;
