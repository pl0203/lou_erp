// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
test('manual native Deno has an explicit exact already-locked Node type dependency', () => {
  const manifest = json('package.json'), lock = json('package-lock.json');
  const deno = json('tests/co-deno/deno.json');
  const version = lock.packages['node_modules/@types/node'].version;
  expect(version).toBe('25.5.2');
  expect(manifest.devDependencies['@types/node']).toBe(version);
  expect(lock.packages[''].devDependencies['@types/node']).toBe(version);
  expect(deno.compilerOptions.types).toEqual([`npm:@types/node@${version}`]);
  expect(deno.nodeModulesDir).toBe('manual');
  expect(deno.compilerOptions.strict).toBe(true);
});
