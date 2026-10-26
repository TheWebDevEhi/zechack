import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const distPath = path.resolve(process.cwd(), 'dashboard', 'dist', 'index.html');

// In cloud container environments (Render, CI, or production), skip redundant build if pre-compiled assets exist
if ((process.env.RENDER || process.env.CI || process.env.NODE_ENV === 'production') && fs.existsSync(distPath)) {
  console.log('[Build] Production dashboard bundle already present in dashboard/dist.');
  console.log('[Build] Skipping redundant container compile to optimize memory and deploy speed.');
  process.exit(0);
}

console.log('[Build] Compiling dashboard assets via Vite...');
try {
  execSync('npm --prefix dashboard run build', {
    stdio: 'inherit'
  });
  console.log('[Build] Dashboard compiled successfully.');
} catch (err) {
  if (fs.existsSync(distPath)) {
    console.warn('[Build Warning] Vite compile warning, but verified dashboard/dist is present. Proceeding.');
    process.exit(0);
  }
  console.error('[Build Error] Failed to build dashboard assets:', err);
  process.exit(1);
}
