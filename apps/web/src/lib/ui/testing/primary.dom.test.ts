import { describe, expect, it } from 'vitest';
import { primaryActions } from './primary';

function root(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	document.body.append(div);
	return div;
}

describe('primaryActions (#106)', () => {
	it('finds primary and filled buttons and ignores the rest', () => {
		const el = root('<button class="button primary">A</button><button class="button filled">B</button><button class="button secondary">C</button>');
		expect(primaryActions(el).map((b) => b.textContent)).toEqual(['A', 'B']);
	});
	it('ignores hidden buttons', () => {
		const el = root('<button class="button primary" hidden>A</button><button class="button primary" style="display:none">B</button><button class="button primary">C</button>');
		expect(primaryActions(el).map((b) => b.textContent)).toEqual(['C']);
	});
});
