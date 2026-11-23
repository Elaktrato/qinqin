// Runs once per `playwright test`: the binary (built, or QINQIN_E2E_BINARY)
// and the template data directory. Workers read both from the environment.

import { rmSync } from 'node:fs';
import { buildBinary, makeTemplate, scratchDir } from './build';

export default async function globalSetup(): Promise<() => void> {
	const work = scratchDir('qinqin-e2e-');
	const bin = process.env.QINQIN_E2E_BINARY || buildBinary(work);
	process.env.QINQIN_E2E_BIN = bin;
	process.env.QINQIN_E2E_TEMPLATE = makeTemplate(bin, work);
	process.env.QINQIN_E2E_WORK = work;
	return () => rmSync(work, { recursive: true, force: true });
}
