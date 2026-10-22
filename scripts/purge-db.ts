import { dbService } from '../src/db/database';

async function main() {
  await dbService.init();
  console.log('Pre-purge stats:', dbService.getStats());
  console.log('Pre-purge keys:', dbService.getViewingKeys(false).length);
  console.log('Pre-purge webhooks:', dbService.getActiveWebhooks().length);

  dbService.resetDatabase({ keepKeys: false });

  console.log('Post-purge stats:', dbService.getStats());
  console.log('Post-purge keys:', dbService.getViewingKeys(false).length);
  console.log('Post-purge webhooks:', dbService.getActiveWebhooks().length);
  console.log('Database purged and sqlite_sequence reset to initial state!');
}

main().catch(console.error);
