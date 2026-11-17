// The fixed scale tokens (docs/contracts/themes/README.md, "Fixed scale
// tokens") and app.css agree, the motion tokens stop under reduced motion,
// and the base components (lib/ui) use tokens only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..', '..');
const css = readFileSync(join(web, 'src', 'app.css'), 'utf8');
const readme = readFileSync(join(web, '..', '..', 'docs', 'contracts', 'themes', 'README.md'), 'utf8');

/** The declarations of the first `:root { … }` block of app.css. */
function rootDeclarations(): Map<string, string> {
	const start = css.indexOf(':root {');
	const body = css.slice(start + 7, css.indexOf('\n}', start));
	const out = new Map<string, string>();
	const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
	for (const m of clean.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim().replace(/\s+/g, ' '));
	return out;
}

/** The rows of the README's "Fixed scale tokens" table: property → value (backticked first value). */
function readmeTable(): Map<string, string> {
	const section = readme.slice(readme.indexOf('## Fixed scale tokens'));
	const table = section.slice(0, section.indexOf('\n## ', 5));
	const out = new Map<string, string>();
	for (const line of table.split('\n')) {
		const m = /^\| (`--[^|]+) \| (.+) \|$/.exec(line);
		if (!m) continue;
		const names = [...m[1].matchAll(/`(--[a-z0-9-]+)`/g)].map((x) => x[1]);
		if (names.length !== 1) continue; // grouped rows (sizes, spacing) are checked below
		const value = /`([^`]+)`/.exec(m[2]);
		if (value) out.set(names[0], value[1]);
	}
	return out;
}

const NEW_TOKENS: Record<string, string> = {
	'--font-size-label': '0.78125rem',
	'--weight-regular': '400',
	'--weight-medium': '500',
	'--weight-strong': '600',
	'--line-tight': '1.15',
	'--line-body': '1.5',
	'--tracking-tight': '-0.01em',
	'--motion-fast': '120ms',
	'--motion-medium': '200ms',
	'--ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
	'--focus-ring': '2px solid var(--accent)',
	'--focus-ring-offset': '2px',
	'--hit': '2.75rem',
	'--layer-float': '50',
	'--layer-modal': '100'
};

describe('fixed scale tokens', () => {
	it('app.css defines the type, motion, focus and layer tokens', () => {
		const root = rootDeclarations();
		for (const [name, value] of Object.entries(NEW_TOKENS)) expect(root.get(name), name).toBe(value);
	});

	it('every single-token row of the README table matches app.css', () => {
		const root = rootDeclarations();
		const table = readmeTable();
		for (const name of Object.keys(NEW_TOKENS)) expect(table.has(name), `README row ${name}`).toBe(true);
		for (const [name, value] of table) expect(root.get(name), name).toBe(value);
	});

	it('the old --link variable is gone (B4: --reading-accent)', () => {
		expect(css).not.toMatch(/--link\b/);
	});

	it('the motion tokens are zero under prefers-reduced-motion', () => {
		const m = /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(css);
		expect(m).not.toBeNull();
		const motion = Object.keys(NEW_TOKENS).filter((n) => n.startsWith('--motion-'));
		for (const name of motion) expect(m![1]).toMatch(new RegExp(`${name}:\\s*0ms;`));
	});

	it('type tops out at 600 (no font-weight above 600 in lib/ui)', () => {
		for (const file of uiFiles()) {
			for (const m of readFileSync(file, 'utf8').matchAll(/font-weight:\s*(\d+)/g)) {
				expect(Number(m[1]), file).toBeLessThanOrEqual(600);
			}
		}
	});
});

function uiFiles(): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(svelte|css)$/.test(name)) out.push(p);
		}
	};
	walk(join(web, 'src', 'lib', 'ui'));
	return out;
}

describe('base components use tokens only', () => {
	it('no colour literal and no prefers-color-scheme in lib/ui styles', () => {
		for (const file of uiFiles()) {
			const src = readFileSync(file, 'utf8');
			const styles = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
			const attrs = [...src.matchAll(/style(?::[\w-]+)?=(?:"[^"]*"|\{[^}]*\})/g)].map((m) => m[0]).join('\n');
			const text = (styles + '\n' + attrs).replace(/\/\*[\s\S]*?\*\//g, '');
			expect(text, file).not.toMatch(/:\s*[^;{}]*#[0-9a-fA-F]{3,8}\b/);
			expect(text, file).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|hwb)\(/);
			expect(text, file).not.toMatch(/prefers-color-scheme/);
		}
	});
});
