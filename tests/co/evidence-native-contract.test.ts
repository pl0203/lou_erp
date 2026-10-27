// @vitest-environment node
import { test } from 'vitest';
import { registerEvidenceRuntimeTests } from '../co-deno/evidence-cases';

// Portable assertion/fixture sanity only. Passing here is NOT a native Deno result.
registerEvidenceRuntimeTests((name, run) => test(name, run));
