import { dbService } from '../src/db/database';

async function main() {
  await dbService.init();

  // Test inserting viewing key
  const key = await dbService.addViewingKey('test-key-string-12345', 'UFVK', 'Test Key 1', 4500000);
  console.log('Inserted key with ID:', key.id);
  if (!key.id || key.id <= 0) {
    throw new Error(`Expected valid positive key ID, got ${key.id}`);
  }

  // Test inserting webhook
  const wh = await dbService.addWebhook('https://example.com/webhook', 'secret123', 'Test WH');
  console.log('Inserted webhook with ID:', wh.id);
  if (!wh.id || wh.id <= 0) {
    throw new Error(`Expected valid positive webhook ID, got ${wh.id}`);
  }

  // Test individual delete key
  const keyDeleted = await dbService.deleteViewingKey(key.id);
  console.log('Delete key result:', keyDeleted);
  if (!keyDeleted) throw new Error('Failed to delete key');

  // Test individual delete webhook
  const whDeleted = await dbService.deleteWebhook(wh.id);
  console.log('Delete webhook result:', whDeleted);
  if (!whDeleted) throw new Error('Failed to delete webhook');

  // Clean reset
  await dbService.resetDatabase({ keepKeys: false });
  console.log('Database verified and reset cleanly!');
}

main().catch(console.error);
