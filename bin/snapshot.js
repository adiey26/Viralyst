// Records today's follower count for every tracked account. Run it daily: npm run snapshot
import path from 'node:path';
import { fetchSnapshot } from '../src/apify.js';
import { config } from '../src/config.js';
import { SnapshotStore } from '../src/tracker.js';

const store = new SnapshotStore(path.join(config.dataDir, 'tracking.sqlite'));
const handles = store.handles();
if (!handles.length) console.log('No accounts tracked yet. Run an audit on a real account first.');

let failed = false;
for (const handle of handles) {
  try {
    const profile = await fetchSnapshot(handle);
    store.record(profile);
    console.log(`@${handle}: ${profile.followers} followers`);
  } catch (error) {
    failed = true;
    console.error(`@${handle}: ${error.message}`);
  }
}
store.close();
if (failed) process.exitCode = 1;
