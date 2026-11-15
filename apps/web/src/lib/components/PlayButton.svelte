<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { AudioClip } from '$lib/api/audio';
	import { activate, buttonState } from '$lib/audio/button';
	import { getPlayer } from '$lib/audio/shared';
	import { deviceVoiceFor } from '$lib/audio/player';

	let {
		clips,
		speakText,
		lang,
		deviceVoice
	}: { clips: AudioClip[]; speakText?: string; lang: string; deviceVoice: boolean } = $props();

	// Voices load asynchronously and only exist in the browser, so the
	// device-voice button appears once one is known.
	let voiceAvailable = $state(false);
	let playing = $state(false);
	let mine = false;

	const view = $derived(buttonState({ clips, speakText, deviceVoice, voiceAvailable }));

	onMount(() => {
		if (typeof speechSynthesis === 'undefined') return;
		const refresh = () => (voiceAvailable = deviceVoiceFor(lang, speechSynthesis.getVoices()) !== null);
		refresh();
		speechSynthesis.addEventListener?.('voiceschanged', refresh);
		return () => speechSynthesis.removeEventListener?.('voiceschanged', refresh);
	});

	// Leaving the page must not leave sound behind.
	onDestroy(() => {
		if (mine) getPlayer().stop();
	});

	async function toggle() {
		const player = getPlayer();
		if (playing) {
			player.stop();
			playing = false;
			return;
		}
		mine = true;
		playing = true;
		try {
			await activate(player, { clips, speakText, deviceVoice }, lang);
		} finally {
			playing = false;
		}
	}
</script>

{#if view.visible}
	<button
		type="button"
		class="play"
		aria-label="Play pronunciation"
		aria-pressed={playing}
		title={view.title}
		onclick={toggle}
	>
		<span aria-hidden="true">{playing ? '■' : '▶'}</span>
	</button>
{/if}

<style>
	.play {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		padding: 0;
		border-radius: 50%;
		border: 1px solid currentColor;
		background: transparent;
		color: inherit;
		font-size: 0.8rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0.85;
	}

	.play:hover,
	.play:focus-visible,
	.play[aria-pressed='true'] {
		opacity: 1;
	}
</style>
