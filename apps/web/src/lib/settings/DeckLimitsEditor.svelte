<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { DEFAULT_LIMITS, type LimitPair } from '$lib/study/limits';
	import { saveDeckLimits } from '$lib/study/store';
	import { getStudyData } from '$lib/study/studyData';
	import { workspaces } from '$lib/workspaces';
	import LimitField from './LimitField.svelte';
	import {
		deckFieldFrom,
		deckRowFrom,
		workspaceChoiceLabel,
		type FieldState
	} from './limitsForm';

	// The per-deck daily limit control (deck settings page, General included):
	// each field follows the workspace, has its own number, or is unlimited.
	let { deckId, deckName }: { deckId: string; deckName: string } = $props();

	let newState = $state<FieldState>({ mode: 'workspace', value: '' });
	let reviewsState = $state<FieldState>({ mode: 'workspace', value: '' });
	let workspaceRow = $state.raw<Partial<LimitPair> | null>(null);
	let loaded = $state(false);
	let busy = $state(false);
	let message = $state('');
	let error = $state('');

	const workspaceId = $derived($workspaces.current?.id ?? null);
	const newWorkspace = $derived(workspaceRow?.new === undefined ? DEFAULT_LIMITS.new : workspaceRow.new);
	const reviewsWorkspace = $derived(
		workspaceRow?.reviews === undefined ? DEFAULT_LIMITS.reviews : workspaceRow.reviews
	);

	async function load(force = false): Promise<void> {
		if (workspaceId === null) return;
		try {
			const data = await getStudyData(workspaceId, { force });
			workspaceRow = data.limits?.workspace ?? null;
			const row = data.limits?.decks[deckId] ?? null;
			newState = deckFieldFrom(row, 'new');
			reviewsState = deckFieldFrom(row, 'reviews');
			loaded = true;
		} catch {
			error = t('settings.deckLimits.loadFailed');
		}
	}
	onMount(() => void load());

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		message = '';
		error = '';
		const plan = deckRowFrom(newState, reviewsState);
		if ('error' in plan) {
			error = plan.error;
			return;
		}
		busy = true;
		try {
			await saveDeckLimits(deckId, plan.row);
			message = t('common.state.saved');
			await load(true);
		} catch {
			error = t('settings.deckLimits.saveFailed');
		} finally {
			busy = false;
		}
	}
</script>

{#if loaded}
	<form novalidate onsubmit={save} aria-label={t('settings.deckLimits.label', { deck: deckName })}>
		<p class="hint">{t('settings.deckLimits.hint', { deck: deckName })}</p>
		<LimitField
			legend={t('settings.deckLimits.newPerDay')}
			name={`new-${deckId}`}
			bind:state={newState}
			workspaceLabel={workspaceChoiceLabel(newWorkspace)}
		/>
		<LimitField
			legend={t('settings.deckLimits.reviewsPerDay')}
			name={`reviews-${deckId}`}
			bind:state={reviewsState}
			workspaceLabel={workspaceChoiceLabel(reviewsWorkspace)}
		/>
		<button type="submit" disabled={busy}>{t('settings.deckLimits.save')}</button>
		{#if message}<span role="status">{message}</span>{/if}
	</form>
{/if}
{#if error}
	<p class="error" role="alert">{error}</p>
{/if}
