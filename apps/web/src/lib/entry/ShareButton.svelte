<script lang="ts">
	import { onDestroy } from 'svelte';
	import { t } from '$lib/i18n';
	import { canShare, shareText } from '$lib/native/share';
	import Button from '$lib/ui/Button.svelte';

	// A Share action where it makes sense: nothing is drawn when the device can neither share nor copy.
	// In the Android app it opens the system share sheet; in a browser navigator.share or the clipboard.
	let { text, title, label }: { text: string; title?: string; /** The accessible name ("Share this sentence"). */ label: string } = $props();

	const available = canShare();
	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function share(): Promise<void> {
		const result = await shareText(text, title);
		if (result !== 'copied') return;
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 2000);
	}

	onDestroy(() => clearTimeout(timer));
</script>

{#if available}
	<Button variant="plain" aria-label={label} onclick={share}>{copied ? t('common.action.copied') : t('common.action.share')}</Button>
	<span class="visually-hidden" role="status">{copied ? t('common.action.copied') : ''}</span>
{/if}
