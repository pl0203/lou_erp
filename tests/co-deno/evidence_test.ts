import { registerEvidenceRuntimeTests } from './evidence-cases.ts';

// No network, environment, filesystem, subprocess or FFI permissions are granted.
// This exercises real Deno Web APIs and shared production guards, not a backend.
registerEvidenceRuntimeTests((name, run) => Deno.test(name, run));
