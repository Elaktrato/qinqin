// Copy the stroke-order data (hanzi-writer-data, Arphic-licensed JSON) into
// the app's static directory under ASCII-only, codepoint-based names.
//
// The package names its files after the character itself (好.json, ⺀.json…).
// Those names flow into the Vite build as asset names, and go:embed rejects
// some of them ("invalid name ⺀.json"), so the Go binary could not embed the
// SPA. Copying to U597D.json / U2E80.json keeps every name ASCII; the stroke
// player builds the same URL at runtime from the character's codepoint.
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'node_modules', 'hanzi-writer-data');
const dest = join(here, '..', 'static', 'hanzi');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

let copied = 0;
for (const name of await readdir(source)) {
	if (!name.endsWith('.json')) continue;
	const char = [...name.slice(0, -'.json'.length)][0];
	const codepoint = char?.codePointAt(0);
	if (codepoint === undefined) continue;
	const target = `U${codepoint.toString(16).toUpperCase()}.json`;
	await copyFile(join(source, name), join(dest, target));
	copied++;
}
if (copied === 0) {
	throw new Error(`no hanzi-writer-data JSON found in ${source}`);
}
console.log(`hanzi data: ${copied} files copied to static/hanzi`);
