// @vitest-environment node
import ts from 'typescript';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('shared workbook guard satisfies strict control-flow typing without suppressions', () => {
  const source = resolve('supabase/functions/_shared/workbook-guard.ts');
  const program = ts.createProgram([source], {
    strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(diagnostics.map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') }))).toEqual([]);
}, 15000);
