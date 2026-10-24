import { dbService } from '../src/db/database';

async function main() {
  await dbService.init();
  console.log('Pre-purge stats:', await dbService.getStats());
  console.log('Pre-purge keys:', (await dbService.getViewingKeys(false)).length);
  console.log('Pre-purge webhooks:', (await dbService.getActiveWebhooks()).length);

  await dbService.resetDatabase({ keepKeys: false });

  console.log('Post-purge stats:', await dbService.getStats());
  console.log('Post-purge keys:', (await dbService.getViewingKeys(false)).length);
  console.log('Post-purge webhooks:', (await dbService.getActiveWebhooks()).length);
  console.log('Database purged and sqlite_sequence reset to initial state!');
}

main().catch(console.error);
