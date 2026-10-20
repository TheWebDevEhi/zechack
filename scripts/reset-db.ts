import fs from 'fs';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'data', 'zecshield.db');

console.log('=== ZecShield Database Reset ===\n');

if (fs.existsSync(dbPath)) {
  try {
    fs.unlinkSync(dbPath);
    console.log(`Successfully deleted ${dbPath}`);
    console.log('The database has been completely reset. A fresh clean database will be created on the next startup.');
  } catch (err: any) {
    console.error(`Failed to delete database: ${err.message}`);
    console.log('If the server is currently running, please stop it first, or use the "Reset Data" button on the dashboard.');
    process.exit(1);
  }
} else {
  console.log('No database file found. It is already clean!');
}
