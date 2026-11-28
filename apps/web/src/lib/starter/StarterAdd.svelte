<script lang="ts">
	// "Add the Starter words" (#214): copies the Starter set of the workspace's language into the learner's own deck
	// and, when asked, switches Starter mode on. Used by Settings and by Home's offer, so both do the same thing.
	// Renders nothing when the server ships no set for the language.
	import { errorText } from '$lib/api/apiErrors';
	import { starterSets, type StarterSetInfo } from '$lib/api/starter';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import { addStarterSet, starterSetTarget } from '$lib/features/flashcards/decks/starterSet';
	import { flashcardsHref } from '$lib/features/flashcards/route';
	import { starterPatch } from './starter';
	import { Button } from '$lib/ui';

	let {
		language,
		workspaceId,
		label,
		enableMode = false,
		onadded
	}: {
		language: string;
		workspaceId: number;
		label?: string;
		/** Also turn Starter mode on for the workspace when the words are added. */
		enableMode?: boolean;
		onadded?: () => void;
	} = $props();

	const session = useSession();

	let set = $state.raw<StarterSetInfo | null | undefined>(undefined); // undefined: still loading
	let busy = $state(false);
	let progress = $state<{ done: number; total: number } | null>(null);
	let result = $state('');
	let error = $state('');
	let seq = 0;

	$effect(() => {
		const code = language.toLowerCase().split('-')[0];
		const mine = ++seq;
		set = undefined;
		starterSets().then(
			(sets) => {
				if (mine !== seq) return;
				set = (Array.isArray(sets) ? sets : []).find((s) => s.language === code) ?? null;
			},
			() => {
				if (mine === seq) set = null;
			}
		);
	});

	const deckHref = $derived(
		set ? flashcardsHref({ view: 'deck', deckId: starterSetTarget(set).id }) : '#'
	);

	async function add(): Promise<void> {
		if (!set || busy) return;
		busy = true;
		result = '';
		error = '';
		progress = null;
		try {
			const done = await addStarterSet(session, workspaceId, set.id, {
				onProgress: (n, total) => (progress = { done: n, total })
			});
			if (done.empty) {
				result = t('flashcards.starterSet.empty');
				return;
			}
			if (enableMode) await session.workspaces.setSettings(workspaceId, starterPatch({ enabled: true }));
			result = t('flashcards.starterSet.added', { count: done.added });
			onadded?.();
		} catch (err) {
			error = errorText(err, t('flashcards.system.addFailed'));
		} finally {
			busy = false;
			progress = null;
		}
	}
</script>

{#if set}
	<div class="starter-add" data-testid="starter-add">
		<p class="note" data-testid="starter-set-note">
			{t('flashcards.starterSet.size', { count: set.wordCount })}{#if !set.humanReviewed}
				{' '}{t('flashcards.starterSet.reviewedByAgents')}{/if}
		</p>
		<Button variant="primary" disabled={busy} onclick={add}>{label ?? t('flashcards.starterSet.add')}</Button>
		{#if result}
			<span role="status">{result}</span>
			<a href={deckHref}>{t('flashcards.starter.openCopy')}</a>
		{/if}
		{#if progress !== null}
			<span role="status" aria-label={t('flashcards.system.adding')}>
				{t('flashcards.system.addingProgress', { done: progress.done, total: progress.total })}
			</span>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>
{/if}

<style>
	.starter-add {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.note {
		flex-basis: 100%;
		margin: 0;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
	.error {
		flex-basis: 100%;
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
