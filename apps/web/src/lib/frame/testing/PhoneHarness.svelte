<script lang="ts">
	// Test harness: the phone bar beside a page that may publish a title and
	// actions; `page` toggles the page (navigation away).
	import PhoneBar from '../PhoneBar.svelte';
	import type { PhoneMode } from '../navLayout';
	import type { FrameSection } from '../sections';
	import FramePageHarness from './FramePageHarness.svelte';

	let {
		sections,
		current,
		page = $bindable(false),
		title = false,
		word = $bindable('学习'),
		mode = 'drawer'
	}: {
		sections: FrameSection[];
		current: string | null;
		page?: boolean;
		title?: boolean;
		word?: string;
		mode?: PhoneMode;
	} = $props();
</script>

<PhoneBar {sections} {current} {mode} />
{#if page}<FramePageHarness {title} bind:word />{/if}
