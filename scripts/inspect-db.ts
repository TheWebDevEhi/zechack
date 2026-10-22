import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

async function inspectDb() {
  const SQL = await initSqlJs();
  const dbPath = path.resolve(process.cwd(), 'data', 'zecshield.db');
  if (!fs.existsSync(dbPath)) {
    console.log('No database file found at', dbPath);
    return;
  }
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);

  console.log('--- Viewing Keys in DB ---');
  const keys = db.exec('SELECT * FROM viewing_keys');
  if (keys.length > 0) {
    console.log(JSON.stringify(keys[0], null, 2));
  } else {
    console.log('No viewing keys in DB');
  }

  console.log('\n--- Shielded Notes in DB ---');
  const notes = db.exec('SELECT * FROM shielded_notes');
  if (notes.length > 0) {
    console.log(JSON.stringify(notes[0], null, 2));
  } else {
    console.log('No shielded notes in DB');
  }

  console.log('\n--- Webhooks in DB ---');
  const webhooks = db.exec('SELECT * FROM webhooks');
  if (webhooks.length > 0) {
    console.log(JSON.stringify(webhooks[0], null, 2));
  } else {
    console.log('No webhooks in DB');
  }

  console.log('\n--- Webhook Deliveries in DB ---');
  const deliveries = db.exec('SELECT * FROM webhook_deliveries');
  if (deliveries.length > 0) {
    console.log(JSON.stringify(deliveries[0], null, 2));
  } else {
    console.log('No deliveries in DB');
  }
}

inspectDb().catch(console.error);
