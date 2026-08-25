import fs from 'node:fs/promises';
import { validatePilotReport } from '../src/pilot-report.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: npm run verify:pilot -- <report.json>');
validatePilotReport(JSON.parse(await fs.readFile(file, 'utf8')));
console.log('Pilot report contract: PASS');
