// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
test('manual native Deno has an explicit exact already-locked Node type dependency', () => {
  const manifest = json('package.json'), lock = json('package-lock.json');
  const deno = json('deno.co-runtime.json');
  const version = lock.packages['node_modules/@types/node'].version;
  expect(version).toBe('25.5.2');
  expect(manifest.devDependencies['@types/node']).toBe(version);
  expect(lock.packages[''].devDependencies['@types/node']).toBe(version);
  expect(deno.compilerOptions.types).toEqual([`npm:@types/node@${version}`]);
  expect(deno.nodeModulesDir).toBe('manual');
  expect(deno.compilerOptions.strict).toBe(true);
});

test('native preflight reports only fixed package existence/version metadata', async () => {
  const { inspectDenoDependencies } = await import('../co-deno/preflight.mjs');
  expect(inspectDenoDependencies()).toEqual({ configurationRoot: 'repository',
    typesNode: { installed: true, version: '25.5.2' }, saxes: { installed: true, version: '6.0.0' } });
});

test('native preflight refuses absent or mismatched installed types rather than auto-installing', async () => {
  const { inspectDenoDependencies } = await import('../co-deno/preflight.mjs');
  for (const mismatch of ['missing', 'version', 'identity']) {
    expect(() => inspectDenoDependencies((path: string) => {
      const value = json(path);
      if (path === 'node_modules/@types/node/package.json') {
        if (mismatch === 'missing') throw new Error('synthetic missing package');
        if (mismatch === 'version') value.version = '0.0.0';
        if (mismatch === 'identity') value.name = 'foreign';
      }
      return value;
    })).toThrow();
  }
});
