<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { loadWorkspaceEvents } from '$lib/events';
	import { deleteVacation, saveVacation, saveWorkspaceLimits } from '$lib/study/store';
	import GoalSettings from './GoalSettings.svelte';
	import LimitField from './LimitField.svelte';
	import NoteSettings from './NoteSettings.svelte';
	import { workspaceFieldFrom, workspaceRowFrom, type FieldState } from './limitsForm';
	import { getStudyData } from '$lib/study/studyData';
	import { newUlid } from '$lib/ulid';
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
	import { currentStudyDay } from '$lib/time/zone';
	import { workspaceDisplay } from '$lib/languages';
	import { workspaces } from '$lib/workspaces';
	import {
		describePeriod,
		errorText,
		periodStatus,
		reviewedTodayIn,
		startNowNote
	} from './vacationForm';

	// Vacation: freezes the schedule (nothing due, streak neutral). Periods are
	// user-global rows; the pure rules live in lib/study/vacation.ts.

	let day = $state.raw(currentStudyDay());
	// A new learner day (or a zone change) moves "today": min dates and plan rules follow.
	$effect(() => onContextStale(() => (day = currentStudyDay())));
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

	const list = $derived($workspaces.list);
	const workspaceId = $derived($workspaces.current?.id ?? null);
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

	async function load(force = false): Promise<void> {
		if (workspaceId === null) {
			periods = [];
			loaded = true;
			return;
		}
		try {
			const data = await getStudyData(workspaceId, { force });
			newState = workspaceFieldFrom(data.limits?.workspace ?? null, 'new');
			reviewsState = workspaceFieldFrom(data.limits?.workspace ?? null, 'reviews');
			periods = (data.vacations ?? [])
				.map((p) => parseVacation(`vacation:${p.id}`, p))
				.filter((p): p is VacationPeriod => p !== null);
		} catch {
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
			if ('put' in write) await saveVacation(write.put);
			else await deleteVacation(write.delete);
		}
		await load(true);
	}

	async function stamps(ids: number[]): Promise<Map<number, number[]>> {
		const out = new Map<number, number[]>();
		await Promise.all(
			ids.map(async (id) => {
				const events = await loadWorkspaceEvents(id);
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
		const plan = workspaceRowFrom(newState, reviewsState);
		if ('error' in plan) {
			limitsError = plan.error;
			return;
		}
		busy = true;
		try {
			await saveWorkspaceLimits(plan.row);
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

<section class="vacation">
	<h2>{t('settings.vacation.title')}</h2>
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
				<label>
					<span>{t('settings.vacation.startDate')}</span>
					<input type="date" min={today} bind:value={startDate} required />
				</label>
			{/if}
		</fieldset>

		<fieldset>
			<legend>{t('settings.vacation.end')}</legend>
			<label><input type="radio" name="vac-end" value="open" bind:group={endMode} /> {t('settings.vacation.untilEnd')}</label>
			<label><input type="radio" name="vac-end" value="date" bind:group={endMode} /> {t('settings.vacation.untilDate')}</label>
			{#if endMode === 'date'}
				<label>
					<span>{t('settings.vacation.endDate')}</span>
					<input type="date" min={startMode === 'date' && startDate !== '' ? startDate : today} bind:value={endDate} required />
				</label>
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

		<button type="submit" disabled={busy}>{startMode === 'now' ? t('settings.vacation.startSubmit') : t('settings.vacation.schedule')}</button>
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
						<button
							type="button"
							disabled={busy}
							aria-label={t('settings.vacation.endNowLabel', { period: describePeriod(period, today, named) })}
							onclick={() => void run(() => planEndEarly(period, today))}>{t('settings.vacation.endNow')}</button
						>
					{:else}
						<button
							type="button"
							disabled={busy}
							aria-label={t('settings.vacation.cancelLabel', { period: describePeriod(period, today, named) })}
							onclick={() => void run(() => planCancel(period, today))}>{t('common.action.cancel')}</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="limits">
	<h2>{t('settings.limits.title')}</h2>
	<p class="hint">{t('settings.limits.hint')}</p>
	<form novalidate onsubmit={saveLimits} aria-label={t('settings.limits.formLabel')}>
		<LimitField legend={t('settings.deckLimits.newPerDay')} name="ws-new" bind:state={newState} />
		<LimitField legend={t('settings.deckLimits.reviewsPerDay')} name="ws-reviews" bind:state={reviewsState} />
		<button type="submit" disabled={busy || workspaceId === null}>{t('settings.deckLimits.save')}</button>
		{#if limitsMessage}<span role="status">{limitsMessage}</span>{/if}
	</form>
	{#if limitsError}
		<p class="error" role="alert">{limitsError}</p>
	{/if}
</section>
<NoteSettings />

<style>
	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin-block: 0.75rem;
		border: 1px solid var(--border, currentColor);
		border-radius: 0.5rem;
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
		gap: 0.5rem;
		align-items: center;
		margin-block: 0.4rem;
	}
	.error,
	.note {
		margin-block: 0.5rem;
	}
</style>
