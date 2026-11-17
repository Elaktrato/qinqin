// The component gallery (#98): every base component renders, with a name
// for everything interactive. With QINQIN_UI_GALLERY=<dir> the rendered
// gallery is written to <dir>/gallery.html — self-contained (app.css, the
// components' CSS, the interface font inlined, three themes' tokens) — for
// the Playwright screenshots of the plan's Task A14. Nothing here ships.
import { render, within, type ByRoleMatcher } from '@testing-library/svelte';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssVariables, derive } from '$lib/theme/derive';
import type { Theme } from '$lib/theme/types';
import Gallery from './testing/Gallery.svelte';

const web = join(__dirname, '..', '..', '..');
const repo = join(web, '..', '..');

function exportedComponents(): string[] {
	const index = readFileSync(join(__dirname, 'index.ts'), 'utf8');
	return [...index.matchAll(/export \{ default as (\w+) \}/g)].map((m) => m[1]);
}

function builtinTheme(pack: string, id: string): Theme {
	const themes = JSON.parse(readFileSync(join(repo, 'server', 'internal', 'themes', 'builtin', pack, 'themes.json'), 'utf8'));
	return themes.find((th: Theme) => th.id === id);
}

const THEMES: [string, string][] = [
	['catppuccin', 'catppuccin-latte'],
	['catppuccin', 'catppuccin-mocha'],
	['gruvbox', 'gruvbox']
];

describe('component gallery', () => {
	it('shows every exported component', () => {
		const { container } = render(Gallery);
		const shown = new Set(
			[...container.querySelectorAll('[data-gallery]')].flatMap((el) => el.getAttribute('data-gallery')!.split(' '))
		);
		// Tooltip and MenuItem are shown inside IconButton and Menu.
		for (const name of exportedComponents().filter((n) => n !== 'Tooltip' && n !== 'MenuItem')) {
			expect(shown.has(name), name).toBe(true);
		}
		expect(container.querySelector('[role="tooltip"][data-open="true"]')).not.toBeNull();
		expect(container.querySelector('[role="menu"] [role="menuitemradio"]')).not.toBeNull();
	});

	it('gives every interactive element an accessible name', () => {
		const { container } = render(Gallery);
		const view = within(container);
		const roles: ByRoleMatcher[] = ['button', 'link', 'textbox', 'searchbox', 'tab', 'tablist', 'tabpanel', 'menu', 'menuitem', 'menuitemradio', 'dialog'];
		let total = 0;
		for (const role of roles) {
			const all = view.queryAllByRole(role);
			const named = view.queryAllByRole(role, { name: /\S/ });
			expect(named.length, `${role}: ${all.length - named.length} without a name`).toBe(all.length);
			total += all.length;
		}
		expect(total).toBeGreaterThan(30);
	});

	it.runIf(!!process.env.QINQIN_UI_GALLERY)('writes gallery.html for the screenshots', () => {
		render(Gallery);
		const out = process.env.QINQIN_UI_GALLERY!;
		const font = readFileSync(join(web, 'src', 'lib', 'assets', 'fonts', 'Figtree-Variable.woff2')).toString('base64');
		const appCss = readFileSync(join(web, 'src', 'app.css'), 'utf8').replace(
			/url\('\.\/lib\/assets\/fonts\/Figtree-Variable\.woff2'\)/,
			`url(data:font/woff2;base64,${font})`
		);
		const componentCss = [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n');
		expect(componentCss).toMatch(/\.icon-button/);
		const themeCss = THEMES.map(([pack, id]) => {
			const theme = builtinTheme(pack, id);
			const vars = Object.entries(cssVariables(theme, derive(theme, null)))
				.map(([k, v]) => `${k}: ${v};`)
				.join(' ');
			return `:root[data-gallery-theme='${id}'] { ${vars} color-scheme: ${theme.scheme}; }`;
		}).join('\n');
		const html = `<!doctype html><html lang="en" data-gallery-theme="${THEMES[0][1]}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>qinqin base components</title>
<style>${appCss}</style><style>${themeCss}</style><style>${componentCss}</style></head>
<body>${document.body.innerHTML}</body></html>`;
		mkdirSync(out, { recursive: true });
		writeFileSync(join(out, 'gallery.html'), html);
	});
});
