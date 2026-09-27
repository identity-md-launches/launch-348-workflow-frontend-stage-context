import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../../', import.meta.url);
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const reportPath = 'docs/frontend/delivery-audit.json';
mkdirSync(new URL('test/scratch/', root), { recursive: true });
git(['bundle', 'create', 'test/scratch/baseline.bundle', '--all']);
const changed = [...new Set([
  ...git(['diff', '--name-only', 'HEAD']).trim().split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).trim().split('\n'),
])].filter(Boolean);
for (const path of changed) {
  assert(/^(web|dist|docs)\//.test(path), `Out-of-scope path: ${path}`);
  assert(!path.split('/').some(part => ['node_modules', '.cache', '.npm', '.pnpm-store', '.vite'].includes(part)), path);
  assert(!path.endsWith('.tgz'), path);
  assert(!path.split('/').some(part => part.startsWith('.')) || path === 'web/.gitignore', path);
  assert(!lstatSync(new URL(path, root)).isSymbolicLink(), path);
}
assert(!git(['ls-files', '-s']).split('\n').some(line => line.startsWith('160000')));
const manifest = JSON.parse(readFileSync(new URL('dist/imd-deployment.json', root)));
const handoff = JSON.parse(readFileSync(new URL('web/config/deployment.json', root)));
const network = JSON.parse(readFileSync(new URL('web/config/network.json', root)));
for (const key of ['launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert.equal(manifest[key], handoff[key]);
assert.deepEqual(manifest.network, network.network);
assert.deepEqual(manifest.walletAddChain, network.walletAddChain);
const rawBytes = changed.filter(path => path !== reportPath).reduce((sum, path) => sum + lstatSync(new URL(path, root)).size, 0);
const baselineBundleBytes = lstatSync(new URL('test/scratch/baseline.bundle', root)).size;
const estimate = rawBytes + baselineBundleBytes + 1024 * 1024;
assert(estimate < 8388608);
const report = {
  result: 'PASS', scope: 'web/**, dist/**, docs/**; web/.gitignore explicitly allowed',
  sourceCommit: handoff.sourceCommit,
  deliveredFilesIncludingThisReport: changed.includes(reportPath) ? changed.length : changed.length + 1,
  rawDeliveryBytesExcludingThisReport: rawBytes, baselineBundleBytes,
  conservativeCombinedBytesWith1MiBMetadataReserve: estimate, bundleBudgetBytes: 8388608,
  budgetMethod: 'Complete existing-history Git bundle + uncompressed delivery files + 1 MiB reserve for this report, new Git metadata and packing overhead. No exact new-commit bundle was made because the checkout Git directory is read-only.',
  submodules: 0, includedDependencyCaches: 0, forbiddenChangedPaths: [],
  gitCommit: 'Unavailable: git add failed because .git/index.lock cannot be created on the read-only filesystem. Delivered files remain in the working tree for the network collector.',
};
writeFileSync(new URL(reportPath, root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
