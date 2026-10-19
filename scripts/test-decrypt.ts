import { decrypt_tx } from '@ledgerhq/zcash-decrypt';

// Sample raw transaction hex from previous test
const sampleTxHex = '0600008098b684d85b16a5370000000089c235000000000002f1a004b545dfac';

// Dummy viewing key to test function execution
const dummyKey = 'uview1dummykeyforverificationonly';

try {
  console.log('Testing decrypt_tx function execution...');
  const result = decrypt_tx(sampleTxHex, dummyKey);
  console.log('decrypt_tx result:', result);
} catch (err: any) {
  console.log('Expected failure with non-hex or dummy key:', err.message || err);
}
