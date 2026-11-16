<script lang="ts">
	// Settings → Study: the workspace's daily goal. The rules live in
	// lib/goals (row, texts) and ./goalForm.ts (form view model).
	import { fetchActivity, type ActivitySource } from '$lib/api/stats';
	import { BUILTIN_SOURCES } from '$lib/goals/builtinSources';
	import { activityType, type GoalsRow } from '$lib/goals/goals';
	import { metricOptions, type MetricOption } from '$lib/goals/goalText';
	import { onContextStale } from '$lib/study/currentContext';
	import { effectiveLimits } from '$lib/study/limits';
	import { saveGoals } from '$lib/study/store';
	import { getStudyData } from '$lib/study/studyData';
	import { currentStudyDay } from '$lib/time/zone';
	import { workspaces } from '$lib/workspaces';
	import { formFrom, limitHint, planForm, type GoalFormState } from './goalForm';

	let day = $state.raw(currentStudyDay());
	$effect(() => onContextStale(() => (day = currentStudyDay())));
	const today = $derived(day.today());

	let row = $state.raw<GoalsRow | null>(null);
	let newer = $state(false);
	let sources = $state.raw<readonly ActivitySource[]>(BUILTIN_SOURCES);
	// The activity list failed (offline): the built-in choices are shown.
	let sourcesFailed = $state(false);
	// The workspace the shown row was read from; a save writes only there.
	let loadedFor = $state<number | null>(null);
	let loadFailed = $state(false);
	let newLimit = $state<number | null>(null);
	let form = $state<GoalFormState>({ metric: '', target: '', showStreak: true });
	let loaded = $state(false);
	let busy = $state(false);
	let message = $state('');
	let error = $state('');
	let seq = 0;
	let sourcesSeq = 0;

	const workspaceId = $derived($workspaces.current?.id ?? null);
	// A goal whose activity is no longer a source stays selectable, so the
	// form can still save the streak switch or remove it.
	const options = $derived.by<MetricOption[]>(() => {
		const list = metricOptions(sources);
		if (form.metric !== '' && !list.some((o) => o.metric === form.metric)) {
			const type = activityType(form.metric) ?? form.metric;
			list.push({ metric: form.metric, label: `${type} (no longer counted)`, unit: 'count' });
		}
		return list;
	});
	const unit = $derived(options.find((o) => o.metric === form.metric)?.unit ?? 'count');
	const hint = $derived(limitHint(form, newLimit));
	const hasGoal = $derived(formFrom(row, today).metric !== '');
	const disabled = $derived(!loaded || busy || newer || workspaceId === null);

	async function load(workspace: number | null, force = false): Promise<void> {
		const mine = ++seq;
		loaded = false;
		loadFailed = false;
		loadedFor = null;
		message = '';
		error = '';
		if (workspace === null) {
			row = null;
			newer = false;
			form = formFrom(null, today);
			return;
		}
		// The row and the activity list load independently: the row is all a
		// flashcards goal needs, so the form also works offline.
		void loadSources(workspace);
		try {
			const data = await getStudyData(workspace, { force });
			if (mine !== seq) return;
			const goals = data.goals ?? null;
			newer = goals === 'newer';
			row = goals === 'newer' ? null : goals;
			newLimit = effectiveLimits(data.limits?.workspace ?? null, null).new;
			form = formFrom(row, today);
			loadedFor = workspace;
			loaded = true;
		} catch {
			if (mine !== seq) return;
			loadFailed = true;
			error = 'Could not load your daily goal.';
		}
	}

	async function loadSources(workspace: number): Promise<void> {
		const mine = ++sourcesSeq;
		try {
			const activity = await fetchActivity(today, today, workspace);
			if (mine !== sourcesSeq) return;
			sources = activity.sources ?? [];
			sourcesFailed = false;
		} catch {
			if (mine !== sourcesSeq) return;
			sources = BUILTIN_SOURCES;
			sourcesFailed = true;
		}
	}

	$effect(() => {
		void load(workspaceId);
	});

	async function write(next: GoalsRow | null): Promise<void> {
		if (next === null) {
			message = 'No changes';
			return;
		}
		const target = loadedFor;
		if (target === null || target !== workspaceId) {
			error = 'The workspace changed; check the goal again.';
			return;
		}
		busy = true;
		try {
			await saveGoals(target, next);
			await load(target, true);
			message = 'Saved.';
		} catch {
			error = 'Could not save the daily goal.';
		} finally {
			busy = false;
		}
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		message = '';
		error = '';
		const plan = planForm(row, form, options, today);
		if ('error' in plan) {
			error = plan.error;
			return;
		}
		await write(plan.row);
	}

	async function remove(): Promise<void> {
		message = '';
		error = '';
		const plan = planForm(row, { ...form, metric: '', target: '' }, options, today);
		if ('error' in plan) {
			error = plan.error;
			return;
		}
		await write(plan.row);
	}
</script>

<section class="goal">
	<h2>Daily goal</h2>
	<p class="hint">
		One target per study day in this workspace: flashcard reviews, new cards, minutes of flashcard
		study, or any other activity the statistics count. A change applies from today; earlier days keep
		the goal they had. Vacation days pause the goal and its streak.
	</p>
	{#if sourcesFailed}
		<p class="note" role="status">
			Could not load the activity list; showing the built-in choices.
			<button type="button" onclick={() => workspaceId !== null && void loadSources(workspaceId)}>Try again</button>
		</p>
	{/if}
	{#if newer}
		<p class="note" role="status">
			This goal was set by a newer version of qinqin and cannot be changed here.
		</p>
	{/if}
	<form novalidate onsubmit={save} aria-label="Daily goal of this workspace">
		<span class="field">
			<label for="goal-metric">Count</label>
			<select id="goal-metric" bind:value={form.metric} {disabled}>
				<option value="">No daily goal</option>
				{#each options as option (option.metric)}
					<option value={option.metric}>{option.label}</option>
				{/each}
			</select>
		</span>
		{#if form.metric !== ''}
			<span class="field">
				<label for="goal-target">Target</label>
				<input id="goal-target" type="text" inputmode="numeric" bind:value={form.target} {disabled} size="6" />
				<span class="unit">{unit === 'minutes' ? 'minutes' : 'per day'}</span>
			</span>
		{/if}
		<label class="check">
			<input type="checkbox" bind:checked={form.showStreak} {disabled} />
			Show goal streak
		</label>
		<div class="actions">
			<button type="submit" {disabled}>Save goal</button>
			{#if hasGoal}
				<button type="button" {disabled} onclick={() => void remove()}>Remove goal</button>
			{/if}
			{#if message}<span role="status">{message}</span>{/if}
		</div>
	</form>
	{#if hint}
		<p class="hint">{hint}</p>
	{/if}
	{#if error}
		<p class="error" role="alert">
			{error}
			{#if loadFailed}
				<button type="button" onclick={() => void load(workspaceId, true)}>Try again</button>
			{/if}
		</p>
	{/if}
</section>

<style>
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.25rem;
		align-items: center;
		margin-block: 0.75rem;
	}
	.field,
	.check {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		width: 100%;
	}
	.unit {
		opacity: 0.8;
	}
	.error,
	.note {
		margin-block: 0.5rem;
	}
</style>
