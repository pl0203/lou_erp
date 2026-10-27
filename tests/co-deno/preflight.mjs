// Fixed metadata-only diagnostic. Never prints paths, package contents or environment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
export function inspectDenoDependencies(read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'))) {
  const config = read('deno.co-runtime.json');
  const manifest = read('package.json');
  const lock = read('package-lock.json');
  assert.equal(config.nodeModulesDir, 'manual');
  assert.equal(config.compilerOptions.strict, true);
  assert.deepEqual(config.compilerOptions.types, ['npm:@types/node@25.5.2']);
  const result = {};
  for (const [label, name, version, section] of [
    ['typesNode', '@types/node', '25.5.2', 'devDependencies'],
    ['saxes', 'saxes', '6.0.0', 'dependencies'],
  ]) {
    const installed = read(`node_modules/${name}/package.json`);
    assert.equal(installed.name, name, 'Installed package identity mismatch');
    assert.equal(installed.version, version, 'Installed package version mismatch');
    assert.equal(manifest[section][name], version, 'Manifest version mismatch');
    assert.equal(lock.packages[''][section][name], version, 'Root lock version mismatch');
    assert.equal(lock.packages[`node_modules/${name}`].version, version, 'Installed lock version mismatch');
    result[label] = { installed: true, version };
  }
  return { configurationRoot: 'repository', ...result };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log('CO_DENO_DEPENDENCY_PREFLIGHT ' + JSON.stringify(inspectDenoDependencies())); }
  catch { console.error('CO_DENO_DEPENDENCY_PREFLIGHT_FAILED'); process.exitCode = 1; }
}
