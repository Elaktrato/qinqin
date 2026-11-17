<script lang="ts">
	// Settings -> Features: switch Decks or the Reader off for yourself.
	import { pluginStates } from '$lib/plugins/states';
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
			error = err instanceof Error && err.message ? err.message : 'Could not save the switch.';
		} finally {
			saving = null;
		}
	}
</script>

<h2>Features</h2>
<p class="hint">
	Decks and the Reader are part of the app. Switching one off hides its page, its navigation link
	and its widgets for you; nothing is deleted, and reviews and reading from your other devices still
	count in your stats and goals.
</p>

{#if $pluginStates.status === 'loading' || $pluginStates.status === 'idle'}
	<p>Loading…</p>
{:else if $pluginStates.status === 'error'}
	<p class="error" role="alert">Could not load your settings.</p>
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
				{#if saved === feature.id}<span class="saved">Saved</span>{/if}
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
