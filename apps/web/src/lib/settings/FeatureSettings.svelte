<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	// Settings -> Features: switch Decks or the Reader off for yourself.
	import { t } from '$lib/i18n';
	import { featureSwitches, saveFeatureSwitch } from './featureSwitches';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	const switches = $derived(featureSwitches(session.plugins.list));
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
			await saveFeatureSwitch(session.plugins, id, enabled);
			saved = id;
		} catch (err) {
			box.checked = !enabled;
			error = errorText(err, t('settings.features.saveFailed'));
		} finally {
			saving = null;
		}
	}
</script>

<h2>{t('settings.features.title')}</h2>
<p class="hint">{t('settings.features.hint')}</p>

{#if session.plugins.status === 'loading' || session.plugins.status === 'idle'}
	<p>{t('common.loading')}</p>
{:else if session.plugins.status === 'error'}
	<p class="error" role="alert">{t('settings.features.loadFailed')}</p>
{:else}
	<ul class="features">
		{#each switches as feature (feature.id)}
			<li class="feature">
				<label class="inline">
					<input
						type="checkbox"
						checked={feature.enabled}
						disabled={saving === feature.id}
						onchange={(event) => toggle(feature.id, event)}
					/>
					<span class="title">{feature.title}</span>
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
		margin: 0;
		padding: 0;
	}
	/* One switch per hairline row, not a box (#106). */
	.feature {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}
	.feature + .feature {
		border-top: 1px solid var(--hair);
	}
	.inline {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
	}
	.title {
		font-weight: var(--weight-medium);
	}
	/* The words say it; the --good dot repeats it as a shape (#106). */
	.saved {
		margin-inline-start: var(--space-1);
		color: var(--readable-muted);
		font-size: var(--font-size-label);
	}
	.saved::before {
		content: '';
		display: inline-block;
		width: 0.45em;
		height: 0.45em;
		margin-inline-end: 0.35em;
		border-radius: 50%;
		background: var(--good);
		vertical-align: 0.1em;
	}
	.error {
		margin: var(--space-2) 0 0;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
	}
	.hint {
		color: var(--readable-muted);
	}
</style>
