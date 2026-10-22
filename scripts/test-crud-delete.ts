import { dbService } from '../src/db/database';

async function main() {
  await dbService.init();

  // Test inserting viewing key
  const key = dbService.addViewingKey('test-key-string-12345', 'UFVK', 'Test Key 1', 4500000);
  console.log('Inserted key with ID:', key.id);
  if (key.id !== 1) {
    throw new Error(`Expected key ID 1, got ${key.id}`);
  }

  // Test inserting webhook
  const wh = dbService.addWebhook('https://example.com/webhook', 'secret123', 'Test WH');
  console.log('Inserted webhook with ID:', wh.id);
  if (wh.id !== 1) {
    throw new Error(`Expected webhook ID 1, got ${wh.id}`);
  }

  // Test individual delete key
  const keyDeleted = dbService.deleteViewingKey(key.id);
  console.log('Delete key result:', keyDeleted);
  if (!keyDeleted) throw new Error('Failed to delete key');

  // Test individual delete webhook
  const whDeleted = dbService.deleteWebhook(wh.id);
  console.log('Delete webhook result:', whDeleted);
  if (!whDeleted) throw new Error('Failed to delete webhook');

  // Clean reset
  dbService.resetDatabase({ keepKeys: false });
  console.log('Database verified and reset cleanly!');
}

main().catch(console.error);
