import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../../', import.meta.url);
const report = { date: new Date().toISOString(), node: process.version, commands: [] };
const digest = () => createHash('sha256').update(readFileSync(new URL('dist/imd-deployment.json', root))).digest('hex');
const before = digest();
const steps = [
  ['ci', '--offline', '--cache', process.argv[2] || '/tmp/volume-npm-cache', '--no-audit', '--no-fund'],
  ['run', 'build'], ['run', 'test'], ['run', 'check:export'],
];
try {
  for (const args of steps) {
    const started = Date.now();
    const output = execFileSync('npm', args, { cwd: new URL('web/', root), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    report.commands.push({ command: ['npm', ...args].join(' '), exitCode: 0, durationMs: Date.now() - started, output });
    console.log('PASS npm ' + args.join(' '));
  }
  report.manifestSha256 = digest();
  report.rebuildMatchesTestedExport = before === report.manifestSha256;
  if (!report.rebuildMatchesTestedExport) throw new Error('Offline rebuild changed the tested export');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.failure = { message: error.message, stdout: error.stdout?.toString(), stderr: error.stderr?.toString(), exitCode: error.status };
  process.exitCode = 1;
} finally {
  writeFileSync(new URL('docs/frontend/build-results.json', root), JSON.stringify(report, null, 2) + '\n');
}
