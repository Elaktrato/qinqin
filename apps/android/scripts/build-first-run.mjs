// Builds the first-run screen into www/ (Capacitor's webDir): the bundle of src/firstrun/main.ts, the page and
// its stylesheet. Nothing else goes into the APK's web assets; the web app comes from the server.
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}www`;
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
	entryPoints: [`${root}src/firstrun/main.ts`],
	outfile: `${out}/main.js`,
	bundle: true,
	format: 'esm',
	target: 'es2020',
	minify: true,
	legalComments: 'none'
});
await copyFile(`${root}src/firstrun/index.html`, `${out}/index.html`);
await copyFile(`${root}src/firstrun/style.css`, `${out}/style.css`);
