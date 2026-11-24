<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { deleteVacation, saveVacation } from '$lib/study/commands/keyed';
	import { saveWorkspaceLimits } from '$lib/study/commands/settings';
	import GoalSettings from './GoalSettings.svelte';
	import LimitField from './LimitField.svelte';
	import NoteSettings from './NoteSettings.svelte';
	import { workspaceFieldFrom, workspaceRowFrom, type FieldState } from './limitsForm';
	import { getStudyData } from '$lib/study/data';
	import { newUlid } from '$lib/events/ulid';
	import {
		parseVacation,
		planCancel,
		planCreate,
		planEndEarly,
		type Draft,
		type VacationPeriod,
		type VacationWrite
	} from '$lib/study/vacation';
	import { onContextStale } from '$lib/study/currentContext';
	import { workspaceDisplay } from '$lib/languages';
	import {
		describePeriod,
		errorText,
		periodStatus,
		reviewedTodayIn,
		startNowNote
	} from './vacationForm';
	import { Button, Field, Section } from '$lib/ui';
	import { useSession } from '$lib/context/context';


	const session = useSession();

	// Vacation: freezes the schedule (nothing due, streak neutral). Periods are
	// user-global rows; the pure rules live in lib/study/vacation.ts.

	let day = $state.raw(session.zone.day());
	// A new learner day (or a zone change) moves "today": min dates and plan rules follow.
	$effect(() => onContextStale(session.zone, () => (day = session.zone.day())));
	const today = $derived(day.today());

	let periods = $state.raw<VacationPeriod[]>([]);
	let newState = $state<FieldState>(workspaceFieldFrom(null, 'new'));
	let reviewsState = $state<FieldState>(workspaceFieldFrom(null, 'reviews'));
	let limitsMessage = $state('');
	let limitsError = $state('');
	let loaded = $state(false);
	let busy = $state(false);
	let error = $state('');
	let note = $state('');

	let startMode = $state<'now' | 'date'>('now');
	let startDate = $state('');
	let endMode = $state<'open' | 'date'>('open');
	let endDate = $state('');
	let scopeMode = $state<'all' | 'chosen'>('all');
	let chosen = $state<number[]>([]);

	const list = $derived(session.workspaces.list);
	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	const named = $derived(
		list.map((w) => {
			const display = workspaceDisplay(list, w);
			return { id: w.id, name: display.showName ? display.name : display.label };
		})
	);
	const visible = $derived(
		periods
			.filter((p) => periodStatus(p, today) !== 'past')
			.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
	);

	/** The workspace whose limits the form holds: set together with them, and the one Save writes (#174). */
	let loadedWorkspace = $state<number | null>(null);

	async function load(force = false): Promise<void> {
		const ws = workspaceId;
		if (ws === null) {
			periods = [];
			loadedWorkspace = null;
			loaded = true;
			return;
		}
		try {
			const data = await getStudyData(session.study, ws, { force });
			// A late answer for a workspace no longer selected is dropped.
			if (ws !== workspaceId) return;
			loadedWorkspace = ws;
			newState = workspaceFieldFrom(data.limits?.workspace ?? null, 'new');
			reviewsState = workspaceFieldFrom(data.limits?.workspace ?? null, 'reviews');
			periods = (data.vacations ?? [])
				.map((p) => parseVacation(`vacation:${p.id}`, p))
				.filter((p): p is VacationPeriod => p !== null);
		} catch {
			if (ws !== workspaceId) return;
			error = t('settings.vacation.loadFailed');
		}
		loaded = true;
	}

	onMount(() => void load());
	$effect(() => {
		void workspaceId;
		void load();
	});

	async function apply(writes: VacationWrite[]): Promise<void> {
		for (const write of writes) {
			if ('put' in write) await saveVacation(session.study, write.put);
			else await deleteVacation(session.study, write.delete);
		}
		await load(true);
	}

	async function stamps(ids: number[]): Promise<Map<number, number[]>> {
		const out = new Map<number, number[]>();
		await Promise.all(
			ids.map(async (id) => {
				const events = await session.events.load(id);
				out.set(
					id,
					events.filter((e) => e.type === 'review').map((e) => Date.parse(e.ts))
				);
			})
		);
		return out;
	}

	async function create(): Promise<void> {
		error = '';
		note = '';
		busy = true;
		try {
			const draft: Draft = {
				start: startMode === 'now' ? 'now' : startDate,
				end: endMode === 'open' ? null : endDate,
				scope: scopeMode === 'all' ? 'all' : { workspaces: [...chosen].sort((a, b) => a - b) }
			};
			const covered = scopeMode === 'all' ? list.map((w) => w.id) : chosen;
			const reviewed = reviewedTodayIn(await stamps(covered), day, Date.now());
			const plan = planCreate(periods, draft, {
				today,
				now: new Date(),
				reviewedToday: reviewed,
				newId: () => newUlid()
			});
			if ('error' in plan) {
				error = errorText(plan.error);
				return;
			}
			await apply(plan.writes);
			note = startNowNote(plan.startsTomorrow);
		} catch {
			error = errorText('');
		} finally {
			busy = false;
		}
	}

	async function run(action: () => VacationWrite | { error: string }): Promise<void> {
		error = '';
		note = '';
		busy = true;
		try {
			const result = action();
			if ('error' in result) {
				error = errorText(result.error);
				return;
			}
			await apply([result]);
		} catch {
			error = errorText('');
		} finally {
			busy = false;
		}
	}

	async function saveLimits(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		limitsMessage = '';
		limitsError = '';
		// The workspace whose limits the form shows, captured now (#174).
		const ws = loadedWorkspace;
		if (ws === null) return;
		const plan = workspaceRowFrom(newState, reviewsState);
		if ('error' in plan) {
			limitsError = plan.error;
			return;
		}
		busy = true;
		try {
			await saveWorkspaceLimits(session.study, ws, plan.row);
			limitsMessage = t('common.state.saved');
			await load(true);
		} catch {
			limitsError = t('settings.deckLimits.saveFailed');
		} finally {
			busy = false;
		}
	}

	function toggle(id: number): void {
		chosen = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
	}
</script>

<GoalSettings />

<Section title={t('settings.vacation.title')}>
	<p class="hint">{t('settings.vacation.hint')}</p>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			void create();
		}}
	>
		<fieldset>
			<legend>{t('settings.vacation.start')}</legend>
			<label><input type="radio" name="vac-start" value="now" bind:group={startMode} /> {t('settings.vacation.startNow')}</label>
			<label><input type="radio" name="vac-start" value="date" bind:group={startMode} /> {t('settings.vacation.onDate')}</label>
			{#if startMode === 'date'}
				<Field label={t('settings.vacation.startDate')} type="date" min={today} bind:value={startDate} required />
			{/if}
		</fieldset>

		<fieldset>
			<legend>{t('settings.vacation.end')}</legend>
			<label><input type="radio" name="vac-end" value="open" bind:group={endMode} /> {t('settings.vacation.untilEnd')}</label>
			<label><input type="radio" name="vac-end" value="date" bind:group={endMode} /> {t('settings.vacation.untilDate')}</label>
			{#if endMode === 'date'}
				<Field
					label={t('settings.vacation.endDate')}
					type="date"
					min={startMode === 'date' && startDate !== '' ? startDate : today}
					bind:value={endDate}
					required
				/>
			{/if}
		</fieldset>

		<fieldset>
			<legend>{t('settings.vacation.appliesTo')}</legend>
			<label><input type="radio" name="vac-scope" value="all" bind:group={scopeMode} /> {t('settings.vacation.scopeAll')}</label>
			<label><input type="radio" name="vac-scope" value="chosen" bind:group={scopeMode} /> {t('settings.vacation.scopeChosen')}</label>
			{#if scopeMode === 'chosen'}
				<ul class="spaces">
					{#each named as space (space.id)}
						<li>
							<label>
								<input type="checkbox" checked={chosen.includes(space.id)} onchange={() => toggle(space.id)} />
								{space.name}
							</label>
						</li>
					{/each}
				</ul>
			{/if}
		</fieldset>

		<Button type="submit" variant="primary" disabled={busy}
			>{startMode === 'now' ? t('settings.vacation.startSubmit') : t('settings.vacation.schedule')}</Button
		>
	</form>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	{#if note}
		<p class="note" role="status">{note}</p>
	{/if}

	{#if loaded && visible.length > 0}
		<h3>{t('settings.vacation.yours')}</h3>
		<ul class="periods">
			{#each visible as period (period.id)}
				{@const status = periodStatus(period, today)}
				<li>
					<span>
						{describePeriod(period, today, named)}
						<em>({status === 'active' ? t('settings.vacation.active') : t('settings.vacation.scheduled')})</em>
					</span>
					{#if status === 'active'}
						<Button
							disabled={busy}
							aria-label={t('settings.vacation.endNowLabel', { period: describePeriod(period, today, named) })}
							onclick={() => void run(() => planEndEarly(period, today))}>{t('settings.vacation.endNow')}</Button
						>
					{:else}
						<Button
							disabled={busy}
							aria-label={t('settings.vacation.cancelLabel', { period: describePeriod(period, today, named) })}
							onclick={() => void run(() => planCancel(period, today))}>{t('common.action.cancel')}</Button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Section>

<Section title={t('settings.limits.title')}>
	<p class="hint">{t('settings.limits.hint')}</p>
	<form novalidate onsubmit={saveLimits} aria-label={t('settings.limits.formLabel')}>
		<LimitField legend={t('settings.deckLimits.newPerDay')} name="ws-new" bind:state={newState} />
		<LimitField legend={t('settings.deckLimits.reviewsPerDay')} name="ws-reviews" bind:state={reviewsState} />
		<Button type="submit" variant="primary" disabled={busy || workspaceId === null}>{t('settings.deckLimits.save')}</Button>
		{#if limitsMessage}<span role="status">{limitsMessage}</span>{/if}
	</form>
	{#if limitsError}
		<p class="error" role="alert">{limitsError}</p>
	{/if}
</Section>
<NoteSettings />

<style>
	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		align-items: center;
		margin-block: var(--space-3);
	}

	fieldset :global(.field) {
		flex: 1 1 12rem;
	}

	.spaces {
		list-style: none;
		margin: 0;
		padding: 0;
		width: 100%;
	}

	.periods {
		list-style: none;
		padding: 0;
	}

	.periods li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		padding-block: var(--space-2);
	}

	.periods li + li {
		border-top: 1px solid var(--hair);
	}

	.error,
	.note {
		margin-block: var(--space-2);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
