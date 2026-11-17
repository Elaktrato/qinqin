<script lang="ts">
	import { t } from '$lib/i18n';
	import { cleanCardTypes, type DeckSettings } from './deckSettings';
	import { saveDeckCardTypes } from './store';
	import type { OptInKind } from './types';

	interface Props {
		deckId: string;
		deckName: string;
		/** The deck's stored switches (`deckcfg:` row); none when absent. */
		cardTypes: readonly OptInKind[];
		onSaved?: (settings: DeckSettings) => void;
	}

	let { deckId, deckName, cardTypes, onSaved }: Props = $props();

	const OPTIONS: { kind: OptInKind; label: string; info: string }[] = [
		{ kind: 'reverse', label: 'Reverse', info: 'meaning to word (words only)' },
		{ kind: 'cloze', label: 'Cloze', info: 'fill the gap in an example sentence' }
	];

	let saving = $state(false);
	let error = $state('');
	// The switches as the learner sees them while a write is in flight.
	let pending = $state<OptInKind[] | null>(null);
	const shown = $derived(pending ?? cleanCardTypes(cardTypes));

	async function toggle(kind: OptInKind): Promise<void> {
		if (saving) return;
		const next = shown.includes(kind) ? shown.filter((k) => k !== kind) : [...shown, kind];
		saving = true;
		error = '';
		pending = cleanCardTypes(next);
		try {
			const saved = await saveDeckCardTypes(deckId, next);
			onSaved?.(saved);
		} catch (err) {
			error = err instanceof Error && err.message ? err.message : t('study.deckTypes.saveFailed');
		} finally {
			pending = null;
			saving = false;
		}
	}
</script>

<fieldset class="switches" aria-label={t('study.deckTypes.label', { deck: deckName })}>
	{#each OPTIONS as option (option.kind)}
		<label class="switch">
			<input
				type="checkbox"
				checked={shown.includes(option.kind)}
				disabled={saving}
				onchange={() => void toggle(option.kind)}
			/>
			<span>{option.label}</span>
			<span class="info">{option.info}</span>
		</label>
	{/each}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</fieldset>

<style>
	.switches {
		margin: 0.4rem 0 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1.25rem;
		font-size: 0.9rem;
	}

	.switch {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
	}

	.info {
		opacity: 0.7;
	}

	.error {
		flex-basis: 100%;
		margin: 0;
		color: #c62828;
		font-weight: 600;
	}
</style>
