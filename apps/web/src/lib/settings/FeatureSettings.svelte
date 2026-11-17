<script lang="ts">
	// Settings -> Features: switch Decks or the Reader off for yourself.
	import { pluginStates } from '$lib/plugins/states';
	import { t } from '$lib/i18n';
	import { featureSwitches, saveFeatureSwitch } from './featureSwitches';

	const switches = $derived(featureSwitches($pluginStates.list));
	let saving = $state<string | null>(null);
	let saved = $state<string | null>(null);
	let error = $state('');

	async function toggle(id: string, event: Event): Promise<void> {
		const box = event.currentTarget as HTMLInputElement;
		const enabled = box.checked;
		saving = id;
		saved = null;
		error = '';
		try {
			await saveFeatureSwitch(id, enabled);
			saved = id;
		} catch (err) {
			box.checked = !enabled;
			error = err instanceof Error && err.message ? err.message : t('settings.features.saveFailed');
		} finally {
			saving = null;
		}
	}
</script>

<h2>{t('settings.features.title')}</h2>
<p class="hint">{t('settings.features.hint')}</p>

{#if $pluginStates.status === 'loading' || $pluginStates.status === 'idle'}
	<p>{t('common.loading')}</p>
{:else if $pluginStates.status === 'error'}
	<p class="error" role="alert">{t('settings.features.loadFailed')}</p>
{:else}
	<ul class="features">
		{#each switches as feature (feature.id)}
			<li>
				<label class="inline">
					<input
						type="checkbox"
						checked={feature.enabled}
						disabled={saving === feature.id}
						onchange={(event) => toggle(feature.id, event)}
					/>
					{feature.title}
				</label>
				{#if saved === feature.id}<span class="saved">{t('settings.features.saved')}</span>{/if}
			</li>
		{/each}
	</ul>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
{/if}

<style>
	.features {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.saved {
		margin-left: 0.5rem;
	}
</style>
