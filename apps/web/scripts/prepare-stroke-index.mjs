// Write src/lib/writing/strokeIndex.json: the code points that have stroke
// data in hanzi-writer-data, as sorted [start, end] ranges. It is committed
// so the level planner can ask "does this glyph have stroke data?"
// synchronously (strokeIndex.ts); a test fails when it drifts from the
// package. Regenerate with `node scripts/prepare-stroke-index.mjs` after
// bumping hanzi-writer-data.
import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'node_modules', 'hanzi-writer-data');
const points = [];
for (const name of await readdir(source)) {
	if (!name.endsWith('.json') || name === 'package.json') continue;
	const cp = [...name.slice(0, -'.json'.length)][0]?.codePointAt(0);
	if (cp !== undefined) points.push(cp);
}
points.sort((a, b) => a - b);
const ranges = [];
for (const cp of points) {
	const last = ranges[ranges.length - 1];
	if (last && cp === last[1] + 1) last[1] = cp;
	else ranges.push([cp, cp]);
}
await writeFile(
	join(here, '..', 'src', 'lib', 'writing', 'strokeIndex.json'),
	JSON.stringify({ count: points.length, ranges }) + '\n'
);
console.log(`stroke index: ${points.length} code points in ${ranges.length} ranges`);
