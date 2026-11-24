<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { AudioClip } from '$lib/api/audio';
	import { activate, buttonState, playLabel } from '$lib/audio/button';
	import { clipObjectUrl } from '$lib/audio/source';
	import { deviceVoiceFor } from '$lib/audio/player';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	let {
		clips,
		speakText,
		lang,
		deviceVoice,
		label
	}: {
		clips: AudioClip[];
		speakText?: string;
		lang: string;
		deviceVoice: boolean;
		/** What this button pronounces, for its accessible name ("行 (xíng)"). */
		label?: string;
	} = $props();

	// Voices load asynchronously and only exist in the browser, so the
	// device-voice button appears once one is known.
	let voiceAvailable = $state(false);
	let playing = $state(false);
	let mine = false;

	const view = $derived(buttonState({ clips, speakText, deviceVoice, voiceAvailable }));

	// Fetch the clip as soon as the button exists, so a tap can start the audio in
	// the same tick (iOS Safari only plays inside the user's tap); until it has
	// arrived the tap takes the slower path and plays when the clip is ready.
	$effect(() => {
		for (const clip of clips) void clipObjectUrl(session.caches.clips, clip.url).catch(() => {});
	});

	onMount(() => {
		if (typeof speechSynthesis === 'undefined') return;
		const refresh = () => (voiceAvailable = deviceVoiceFor(lang, speechSynthesis.getVoices()) !== null);
		refresh();
		speechSynthesis.addEventListener?.('voiceschanged', refresh);
		return () => speechSynthesis.removeEventListener?.('voiceschanged', refresh);
	});

	// Leaving the page must not leave sound behind.
	onDestroy(() => {
		if (mine) session.player.stop();
	});

	async function toggle() {
		const player = session.player;
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
		aria-label={playLabel(label)}
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
		color: var(--readable-muted);
	}

	.play:hover,
	.play:focus-visible,
	.play[aria-pressed='true'] {
		color: var(--text);
	}
</style>
