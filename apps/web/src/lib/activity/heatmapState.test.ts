import { describe, expect, it } from 'vitest';
import {
	activityViewFor,
	chipLabel,
	createSaveQueue,
	createSequencer,
	effectiveScope,
	heatmapStatus,
	initialPrefs,
	prefsChanged,
	prefsLoaded,
	toggleHidden
} from './heatmapState';

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

describe('view prefs state', () => {
	it('starts on the default, not loaded, not dirty', () => {
		expect(initialPrefs()).toEqual({
			stored: { scope: 'workspace', hidden: [] },
			loaded: false,
			dirty: false
		});
	});

	it('takes the loaded value when nothing changed meanwhile', () => {
		expect(prefsLoaded(initialPrefs(), { scope: 'all', hidden: ['read'] })).toEqual({
			stored: { scope: 'all', hidden: ['read'] },
			loaded: true,
			dirty: false
		});
	});

	it('never lets a late load overwrite a local change', () => {
		const changed = prefsChanged(initialPrefs(), { scope: 'workspace', hidden: ['journal'] });
		expect(changed.dirty).toBe(true);
		expect(prefsLoaded(changed, { scope: 'all', hidden: [] })).toEqual({
			stored: { scope: 'workspace', hidden: ['journal'] },
			loaded: true,
			dirty: true
		});
	});
});

describe('heatmapStatus', () => {
	it('loads until both the data and the prefs are in', () => {
		expect(heatmapStatus({ hasData: false, loading: true, prefsLoaded: false })).toBe('loading');
		expect(heatmapStatus({ hasData: true, loading: false, prefsLoaded: false })).toBe('loading');
		expect(heatmapStatus({ hasData: false, loading: true, prefsLoaded: true })).toBe('loading');
		expect(heatmapStatus({ hasData: true, loading: false, prefsLoaded: true })).toBe('ready');
	});

	it('reports an error only without data', () => {
		expect(heatmapStatus({ hasData: false, loading: false, prefsLoaded: true })).toBe('error');
		expect(heatmapStatus({ hasData: false, loading: false, prefsLoaded: false })).toBe('error');
		expect(heatmapStatus({ hasData: true, loading: true, prefsLoaded: true })).toBe('ready');
	});
});

describe('createSequencer', () => {
	it('only the latest request is current', () => {
		const seq = createSequencer();
		const a = seq.next();
		expect(seq.isCurrent(a)).toBe(true);
		const b = seq.next();
		expect(seq.isCurrent(a)).toBe(false);
		expect(seq.isCurrent(b)).toBe(true);
	});
});

describe('createSaveQueue', () => {
	function deferred() {
		let resolve!: () => void;
		let reject!: (e: unknown) => void;
		const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
		return { promise, resolve, reject };
	}

	it('saves in order and ends with the last value, coalescing the ones in between', async () => {
		const gates = [deferred(), deferred()];
		const saved: string[] = [];
		let call = 0;
		const queue = createSaveQueue<string>(
			async (v) => {
				saved.push(v);
				await gates[call++]?.promise;
			},
			() => {}
		);
		queue.push('a');
		queue.push('b');
		const done = queue.push('c');
		expect(saved).toEqual(['a']);
		gates[0].resolve();
		await Promise.resolve();
		await Promise.resolve();
		gates[1].resolve();
		await done;
		expect(saved).toEqual(['a', 'c']);
	});

	it('never runs two saves at once', async () => {
		let active = 0;
		let max = 0;
		const queue = createSaveQueue<number>(
			async () => {
				active++;
				max = Math.max(max, active);
				await new Promise((r) => setTimeout(r, 1));
				active--;
			},
			() => {}
		);
		for (let i = 0; i < 6; i++) void queue.push(i);
		await queue.push(6);
		expect(max).toBe(1);
	});

	it('reports a failed save and still saves the next value', async () => {
		const errors: unknown[] = [];
		const saved: string[] = [];
		const queue = createSaveQueue<string>(
			async (v) => {
				saved.push(v);
				if (v === 'a') throw new Error('offline');
			},
			(e) => errors.push(e)
		);
		await queue.push('a');
		await queue.push('b');
		expect(saved).toEqual(['a', 'b']);
		expect(errors).toHaveLength(1);
	});
});

describe('chipLabel', () => {
	it('names the type and its points with the unit', () => {
		expect(chipLabel('Flashcard reviews', 412)).toBe('Flashcard reviews, 412 points');
		expect(chipLabel('Journal entries', 1)).toBe('Journal entries, 1 point');
		expect(chipLabel('Reading', 0)).toBe('Reading, 0 points');
	});
});
