<script lang="ts">
	import { t } from '$lib/i18n';
	import { AUDIO_AUTOPLAY_KEY, AUDIO_DEVICE_VOICE_KEY, readAudioSettings } from '$lib/audio/settings';

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
			error = err instanceof Error && err.message ? err.message : t('settings.saveFailed');
		} finally {
			const { [key]: _done, ...rest } = pending;
			pending = rest;
			saving = false;
		}
	}
</script>

<fieldset class="audio" aria-busy={saving}>
	<legend>{t('settings.audio.title')}</legend>
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
</fieldset>

<style>
	.audio {
		margin: 1rem 0 0;
		padding: 0;
		border: 0;
		display: grid;
		gap: 0.4rem;
	}

	legend {
		padding: 0;
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--readable-muted);
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
