import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AudioSettings from './AudioSettings.svelte';

const text = (html: string) => html.replace(/<!--[^>]*-->/g, '');

describe('AudioSettings', () => {
	it('shows the two options with the defaults: autoplay off, device voice on', () => {
		const { body } = render(AudioSettings, { props: { settings: {}, onChange: async () => {} } });
		const out = text(body);
		expect(out).toContain('Play audio on reveal');
		expect(out).toContain('Use device voice when no recording exists');
		const boxes = [...out.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
		expect(boxes).toHaveLength(2);
		expect(boxes[0]).not.toContain('checked');
		expect(boxes[1]).toContain('checked');
	});
	it('reflects the stored workspace settings', () => {
		const { body } = render(AudioSettings, { props: { settings: { audioAutoplay: true, audioDeviceVoice: false }, onChange: async () => {} } });
		const boxes = [...text(body).matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
		expect(boxes[0]).toContain('checked');
		expect(boxes[1]).not.toContain('checked');
	});
});
