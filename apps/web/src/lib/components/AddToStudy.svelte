<script lang="ts">
	import { ApiError } from '$lib/api/client';
	import type { Entry } from '$lib/api/types';
	import { addCard, loadStudyData } from '$lib/study/store';
	import { workspaces } from '$lib/workspaces';

	let { entry }: { entry: Entry } = $props();

	// Whether this entry already has a card in the current workspace.
	// `null` means "not known yet": the check is still running, so the
	// button stays disabled. Only a failed check frees it, because the
	// click then has to surface the real error.
	let inDeck = $state<boolean | null>(null);
	let saving = $state(false);
	let error = $state('');

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	// A failed load must not hide the button: an unavailable workspace or
	// a flaky pull is reported when the user actually tries to add. Until
	// the check answers, though, the button is disabled: it must never
	// offer to add an entry that is already in the deck.
	$effect(() => {
		const entryId = entry.id;
		const workspaceId = $workspaces.current?.id ?? null;
		let stale = false;
		inDeck = null;
		error = '';
		void (async () => {
			if (workspaceId === null) {
				// loadStudyData would throw; keep the button enabled so a
				// click can explain why nothing can be added yet.
				inDeck = false;
				return;
			}
			try {
				const data = await loadStudyData();
				if (stale) return;
				inDeck = data.cards.some((card) => card.entryId === entryId);
			} catch {
				if (stale) return;
				inDeck = false;
			}
		})();
		return () => {
			stale = true;
		};
	});

	async function add(): Promise<void> {
		// Unresolved or already-added means "no new card"; addCard itself
		// is idempotent, so a race across tabs cannot duplicate either.
		if (saving || inDeck !== false) return;
		saving = true;
		error = '';
		try {
			// The first example sentence travels with the card so the
			// review front can show the word in context.
			await addCard(entry.id, entry.sentences?.[0]?.id);
			inDeck = true;
		} catch (err) {
			error = message(err, 'Could not add this entry to your study deck.');
		} finally {
			saving = false;
		}
	}
</script>

<div class="add-to-study">
	<button
		type="button"
		class="action"
		class:added={inDeck === true}
		disabled={saving || inDeck !== false}
		aria-busy={saving || inDeck === null}
		onclick={() => void add()}
	>
		{saving
			? 'Adding…'
			: inDeck === null
				? 'Checking…'
				: inDeck
					? 'In study deck'
					: 'Add to study'}
	</button>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.add-to-study {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.action {
		font: inherit;
		font-size: 0.9rem;
		padding: 0.4rem 0.9rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.action:hover,
	.action:focus-visible {
		border-color: #0b6bcb;
		color: #0b6bcb;
	}

	.action.added {
		border-color: color-mix(in srgb, currentColor 35%, transparent);
		color: inherit;
		cursor: default;
	}

	.error {
		margin: 0;
		font-size: 0.85rem;
		color: #c62828;
		font-weight: 600;
	}
</style>
