<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { AUDIO_AUTOPLAY_KEY, AUDIO_DEVICE_VOICE_KEY, readAudioSettings } from '$lib/audio/settings';
	import Section from '$lib/ui/Section.svelte';

	let {
		settings,
		onChange
	}: {
		settings: Record<string, unknown>;
		/** Saves a settings patch of the workspace. */
		onChange: (patch: Record<string, boolean>) => Promise<void>;
	} = $props();

	const current = $derived(readAudioSettings(settings));
	let error = $state('');
	let saving = $state(false);
	// The value shown while a save is in flight; dropped on failure, so the box
	// goes back to the stored setting instead of showing a change that never saved.
	let pending = $state<Record<string, boolean>>({});

	async function change(key: string, value: boolean) {
		error = '';
		saving = true;
		pending = { ...pending, [key]: value };
		try {
			await onChange({ [key]: value });
		} catch (err) {
			error = errorText(err, t('settings.saveFailed'));
		} finally {
			const { [key]: _done, ...rest } = pending;
			pending = rest;
			saving = false;
		}
	}
</script>

<Section title={t('settings.audio.title')} level={4}>
	<div class="audio" aria-busy={saving}>
	<label>
		<input
			type="checkbox"
			checked={pending[AUDIO_AUTOPLAY_KEY] ?? current.autoplay}
			onchange={(event) => change(AUDIO_AUTOPLAY_KEY, event.currentTarget.checked)}
		/>
		{t('settings.audio.autoplay')}
	</label>
	<label>
		<input
			type="checkbox"
			checked={pending[AUDIO_DEVICE_VOICE_KEY] ?? current.deviceVoice}
			onchange={(event) => change(AUDIO_DEVICE_VOICE_KEY, event.currentTarget.checked)}
		/>
		{t('settings.audio.deviceVoice')}
	</label>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	</div>
</Section>

<style>
	.audio {
		display: grid;
		gap: var(--space-2);
	}

	label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
