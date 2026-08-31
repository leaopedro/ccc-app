import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

// Every screen a primary tab lands on. A reviewer taps each of these; landing
// on "em breve" is a 2.1 finding on its own.
// Paths confirmed on 2026-08-29 with `ls apps/mobile/app/\(app\)/`. Note that
// inicio is a FILE, not a directory with an index.
const TAB_LANDINGS = [
  'app/(app)/inicio.tsx',
  'app/(app)/events/index.tsx',
  'app/(app)/store/index.tsx',
  'app/(app)/cart/index.tsx',
  'app/(app)/profile/index.tsx',
];

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

describe('primary tab landings', () => {
  it('renders no "em breve" placeholder inline', () => {
    for (const rel of TAB_LANDINGS) {
      expect(read(rel).toLowerCase(), rel).not.toContain('em breve');
    }
  });
});
