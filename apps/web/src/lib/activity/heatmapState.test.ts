import { describe, expect, it } from 'vitest';
import { activityViewFor, effectiveScope, toggleHidden } from './heatmapState';

describe('effectiveScope', () => {
	it('is the stored scope when a workspace is selected', () => {
		expect(effectiveScope('workspace', true)).toBe('workspace');
		expect(effectiveScope('all', true)).toBe('all');
	});

	it('is all workspaces without one', () => {
		expect(effectiveScope('workspace', false)).toBe('all');
		expect(effectiveScope('all', false)).toBe('all');
	});
});

describe('toggleHidden', () => {
	it('hides a visible type and shows a hidden one again', () => {
		expect(toggleHidden([], 'read')).toEqual(['read']);
		expect(toggleHidden(['read', 'journal'], 'read')).toEqual(['journal']);
	});

	it('does not mutate its input', () => {
		const hidden = ['read'];
		toggleHidden(hidden, 'review');
		expect(hidden).toEqual(['read']);
	});
});

describe('activityViewFor', () => {
	it('maps scope and workspace to the fold view', () => {
		expect(activityViewFor({ scope: 'workspace', hidden: ['read'] }, 3)).toEqual({
			workspace: 3,
			hidden: ['read']
		});
		expect(activityViewFor({ scope: 'all', hidden: [] }, 3)).toEqual({ workspace: null, hidden: [] });
		expect(activityViewFor({ scope: 'workspace', hidden: [] }, null)).toEqual({
			workspace: null,
			hidden: []
		});
	});
});
