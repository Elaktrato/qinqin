<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { cleanCardTypes, type DeckSettings } from '$lib/studycore/deckSettings';
	import { saveDeckCardTypes } from '../commands/decks';
	import type { OptInKind } from '$lib/studycore/types';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	interface Props {
		/** The workspace the deck belongs to (the shown data's): the write goes there (#174). */
		workspaceId: number | null;
		deckId: string;
		deckName: string;
		/** The deck's stored switches (`deckcfg:` row); none when absent. */
		cardTypes: readonly OptInKind[];
		onSaved?: (settings: DeckSettings) => void;
	}

	let { workspaceId, deckId, deckName, cardTypes, onSaved }: Props = $props();

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
		const ws = workspaceId;
		if (saving || ws === null) return;
		const next = shown.includes(kind) ? shown.filter((k) => k !== kind) : [...shown, kind];
		saving = true;
		error = '';
		pending = cleanCardTypes(next);
		try {
			const saved = await saveDeckCardTypes(session.study, ws, deckId, next);
			onSaved?.(saved);
		} catch (err) {
			error = errorText(err, t('study.deckTypes.saveFailed'));
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
		margin: 0;
		padding: 0;
		display: grid;
		font-size: var(--font-size-s);
	}

	.switch {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		min-height: var(--hit);
		padding-block: var(--space-1);
	}

	.switch + .switch {
		border-top: 1px solid var(--hair);
	}

	.info {
		color: var(--readable-muted);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
