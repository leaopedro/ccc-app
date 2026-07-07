// Boot wrapper — runs BEFORE ESM static imports so we can capture module
// resolution errors that would otherwise be lost to non-blocking stderr.
//
// ESM hoists `import` statements above all top-level code, so the original
// server.ts could never set blocking I/O or write boot messages before its
// imports resolved.  This file uses only dynamic import() to keep control.

const stdoutHandle = (process.stdout as { _handle?: { setBlocking?: (b: boolean) => void } })
  ._handle;
const stderrHandle = (process.stderr as { _handle?: { setBlocking?: (b: boolean) => void } })
  ._handle;
stdoutHandle?.setBlocking?.(true);
stderrHandle?.setBlocking?.(true);

process.stdout.write(`[boot] pid=${process.pid} node=${process.version} cwd=${process.cwd()}\n`);

import('./server.js').catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[boot] FATAL module resolution failed:\n${msg}\n`);
  process.exit(1);
});
