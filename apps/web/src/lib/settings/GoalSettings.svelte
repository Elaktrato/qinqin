<script lang="ts">
	// Settings → Study: the workspace's daily goal. The rules live in
	// lib/goals (row, texts) and ./goalForm.ts (form view model).
	import { fetchActivity, type ActivitySource } from '$lib/api/stats';
	import { t } from '$lib/i18n';
	import { BUILTIN_SOURCES } from '$lib/goals/builtinSources';
	import { activityType, type GoalsRow } from '$lib/goals/goals';
	import { metricOptions, type MetricOption } from '$lib/goals/goalText';
	import { onContextStale } from '$lib/study/currentContext';
	import { effectiveLimits } from '$lib/study/limits';
	import { saveGoals } from '$lib/study/commands/keyed';
	import { getStudyData } from '$lib/study/data';
	import { currentStudyDay } from '$lib/time/zone';
	import { workspaces } from '$lib/workspaces';
	import { formFrom, limitHint, planForm, type GoalFormState } from './goalForm';
	import { Button, Field, Section, Select } from '$lib/ui';

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
			error = t('settings.goal.loadFailed');
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
			message = t('settings.goal.noChanges');
			return;
		}
		const target = loadedFor;
		if (target === null || target !== workspaceId) {
			error = t('settings.goal.workspaceChanged');
			return;
		}
		busy = true;
		try {
			await saveGoals(target, next);
			await load(target, true);
			message = t('common.state.saved');
		} catch {
			error = t('settings.goal.saveFailed');
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

<Section title={t('settings.goal.title')}>
	<p class="hint">{t('settings.goal.hint')}</p>
	{#if sourcesFailed}
		<p class="note" role="status">
			{t('settings.goal.sourcesFailed')}
			<Button onclick={() => workspaceId !== null && void loadSources(workspaceId)}
				>{t('common.action.retry')}</Button
			>
		</p>
	{/if}
	{#if newer}
		<p class="note" role="status">
			{t('settings.goal.newer')}
		</p>
	{/if}
	<form novalidate onsubmit={save} aria-label={t('settings.goal.formLabel')}>
		<div class="field">
			<Select
				label={t('settings.goal.count')}
				id="goal-metric"
				bind:value={form.metric}
				{disabled}
				options={[
					{ value: '', label: t('settings.goal.none') },
					...options.map((option) => ({ value: option.metric, label: option.label }))
				]}
			/>
		</div>
		{#if form.metric !== ''}
			<div class="field target">
				<Field
					label={t('settings.goal.target')}
					id="goal-target"
					type="number"
					value={form.target}
					oninput={(event) => (form.target = event.currentTarget.value)}
					{disabled}
				/>
				<span class="unit">{unit === 'minutes' ? t('settings.goal.unitMinutes') : t('settings.goal.unitPerDay')}</span>
			</div>
		{/if}
		<label class="check">
			<input type="checkbox" bind:checked={form.showStreak} {disabled} />
			{t('settings.goal.showStreak')}
		</label>
		<div class="actions">
			<Button type="submit" variant="primary" {disabled}>{t('settings.goal.save')}</Button>
			{#if hasGoal}
				<Button tone="danger" {disabled} onclick={() => void remove()}>{t('settings.goal.remove')}</Button>
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
				<Button onclick={() => void load(workspaceId, true)}>{t('common.action.retry')}</Button>
			{/if}
		</p>
	{/if}
</Section>

<style>
	form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-4);
		align-items: end;
		margin-block: var(--space-3);
	}

	.field {
		flex: 1 1 12rem;
	}

	.target {
		display: flex;
		align-items: end;
		gap: var(--space-2);
	}

	.target :global(.field) {
		flex: 1 1 6rem;
	}

	.check {
		display: inline-flex;
		gap: var(--space-1);
		align-items: center;
		min-height: var(--hit);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		width: 100%;
	}

	.unit {
		color: var(--readable-muted);
		padding-block: var(--space-2);
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
