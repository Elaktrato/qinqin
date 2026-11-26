<script lang="ts">
	// Settings → Study → "Level check" (#82, experimental): pick a target
	// level, answer a short self-assessed sample of the words you may not know
	// yet, and see how much of that level's vocabulary you cover, what that
	// suggests, and what to study next. It estimates vocabulary and character
	// knowledge only and writes nothing. The maths is pure (./levelCheck.ts,
	// docs/superpowers/specs/2026-11-26-level-check-design.md).
	import { goto } from '$app/navigation';
	import { getSchemes } from '$lib/api/schemes';
	import type { Scheme } from '$lib/api/types';
	import { useSession } from '$lib/context/context';
	import { levelSessionConfig, loadedSetup } from '$lib/features/flashcards/decks/studyStart';
	import { t } from '$lib/i18n';
	import { formatPercent } from '$lib/i18n/format';
	import { here } from '$lib/routing/here';
	import { saveConfig } from '$lib/study/session';
	import { Button, Chip, Section, Select } from '$lib/ui';
	import { nonEmptyLevels } from './declare';
	import { loadKnownIndex } from './knownIndexLoad';
	import { SAMPLE_SIZE, checkEstimate, planCheck, type CheckPlan, type Readiness } from './levelCheck';
	import { declarableSchemes, loadSchemeLevels, type SchemeLevels } from './levels';
	import SelfAssessQuestion from './SelfAssessQuestion.svelte';

	const session = useSession();

	let schemes = $state.raw<Scheme[] | null>(null);
	let loadFailed = $state(false);
	let schemeId = $state('');
	let loaded = $state.raw<{ scheme: Scheme; data: SchemeLevels } | null>(null);
	let levelsFailed = $state(false);
	let target = $state('');
	let mode = $state<'idle' | 'loading' | 'ask' | 'result'>('idle');
	let plan = $state.raw<CheckPlan | null>(null);
	let answers = $state.raw<boolean[]>([]);
	let attempt = $state(0);
	let error = $state('');
	let seq = 0;

	const workspace = $derived(session.workspaces.current);
	const workspaceId = $derived(workspace?.id ?? null);
	const language = $derived(workspace?.language ?? '');
	const scheme = $derived(schemes?.find((s) => String(s.id) === schemeId) ?? null);
	const levels = $derived(loaded === null ? [] : nonEmptyLevels(loaded.data.levels));
	const unit = $derived<'word' | 'character'>(loaded?.scheme.unit === 'character' ? 'character' : 'word');
	const schemeOptions = $derived.by(() => {
		const list = schemes ?? [];
		const names = new Map<string, number>();
		for (const s of list) names.set(s.name, (names.get(s.name) ?? 0) + 1);
		return list.map((s) => ({
			value: String(s.id),
			label: (names.get(s.name) ?? 0) > 1 && s.packId ? `${s.name} · ${s.packId}` : s.name
		}));
	});
	const levelOptions = $derived(levels.map((level, i) => ({ value: String(i + 1), label: level.name })));
	const targetName = $derived(levels[Number(target) - 1]?.name ?? '');
	const estimate = $derived(plan === null ? null : checkEstimate(plan, answers));
	const entry = $derived(
		mode === 'ask' && plan !== null && loaded !== null ? loaded.data.entries.get(plan.sample[answers.length]) : undefined
	);

	$effect(() => {
		const lang = language;
		schemes = null;
		loadFailed = false;
		getSchemes().then(
			(all) => {
				if (lang !== language) return;
				schemes = declarableSchemes(lang, all);
				schemeId = schemes[0] === undefined ? '' : String(schemes[0].id);
			},
			() => {
				if (lang === language) loadFailed = true;
			}
		);
	});

	$effect(() => {
		const chosen = scheme;
		const mine = ++seq;
		loaded = null;
		levelsFailed = false;
		target = '';
		mode = 'idle';
		if (chosen === null) return;
		loadSchemeLevels(session.caches.levelItems, chosen).then(
			(data) => {
				if (mine !== seq) return;
				loaded = { scheme: chosen, data };
				const first = nonEmptyLevels(data.levels);
				target = first.length > 0 ? '1' : '';
			},
			() => {
				if (mine === seq) levelsFailed = true;
			}
		);
	});

	$effect(() => {
		void workspaceId;
		mode = 'idle';
		error = '';
	});

	async function start(): Promise<void> {
		const ws = workspaceId;
		if (ws === null || loaded === null || target === '') return;
		mode = 'loading';
		error = '';
		try {
			const index = await loadKnownIndex(session, ws);
			if (ws !== workspaceId) return;
			attempt += 1;
			plan = planCheck({
				levels,
				target: Number(target),
				index,
				seed: Math.floor(Math.random() * 2 ** 32) + attempt
			});
			answers = [];
			mode = plan.sample.length === 0 ? 'result' : 'ask';
		} catch {
			error = t('settings.levelCheck.failed');
			mode = 'idle';
		}
	}

	function reply(known: boolean): void {
		answers = [...answers, known];
		if (plan !== null && answers.length >= plan.sample.length) mode = 'result';
	}

	async function studyNext(position: number): Promise<void> {
		const ws = workspaceId;
		const chosen = levels[position - 1];
		if (ws === null || loaded === null || chosen === undefined) return;
		const setup = await loadedSetup(session.setups, ws);
		saveConfig(levelSessionConfig(setup, loaded.scheme.id, chosen.name, here()));
		void goto('/study/session');
	}

	function bandText(band: Readiness): string {
		switch (band) {
			case 'ready':
				return t('settings.levelCheck.band.ready');
			case 'close':
				return t('settings.levelCheck.band.close');
			case 'partway':
				return t('settings.levelCheck.band.partway');
			default:
				return t('settings.levelCheck.band.early');
		}
	}

	const pct = (fraction: number): string => formatPercent(fraction, { maximumFractionDigits: 0 });
</script>

<Section title={t('settings.levelCheck.title')} headingId="level-check" focusable>
	<p class="badge"><Chip tone="accent">{t('settings.levelCheck.experimental')}</Chip></p>
	<p class="warn" data-testid="level-check-limits">{t('settings.levelCheck.limits')}</p>

	{#if loadFailed}
		<p class="error" role="alert">{t('settings.known.loadFailed')}</p>
	{:else if schemes === null}
		<p class="hint">{t('settings.known.loadingLevels')}</p>
	{:else if schemes.length === 0}
		<p class="hint">{t('settings.known.noSchemes')}</p>
	{:else}
		<div class="form">
			{#if mode === 'idle' || mode === 'loading'}
				<Select label={t('settings.known.scheme')} bind:value={schemeId} options={schemeOptions} disabled={mode === 'loading'} />
				{#if levelsFailed}
					<p class="error" role="alert">{t('settings.known.loadFailed')}</p>
				{:else if loaded === null}
					<p class="hint">{t('settings.known.loadingLevels')}</p>
				{:else}
					<Select label={t('settings.levelCheck.target')} bind:value={target} options={levelOptions} disabled={mode === 'loading'} />
					<p class="hint">{t('settings.levelCheck.how', { count: SAMPLE_SIZE })}</p>
					<div class="row">
						<Button variant="primary" busy={mode === 'loading'} disabled={target === ''} onclick={start} data-testid="level-check-start">
							{t('settings.levelCheck.start')}
						</Button>
					</div>
				{/if}
			{:else if mode === 'ask' && plan !== null && entry}
				<SelfAssessQuestion
					written={entry.written}
					{language}
					{unit}
					progress={t('settings.levelCheck.progress', { n: answers.length + 1, total: plan.sample.length })}
					cancelLabel={t('settings.levelCheck.stop')}
					testid="level-check-question"
					onreply={reply}
					oncancel={() => (mode = 'idle')}
				/>
			{:else if mode === 'result' && plan !== null && estimate !== null}
				<div class="result" data-testid="level-check-result">
					<h4 class="result-title">{t('settings.levelCheck.resultTitle', { level: targetName })}</h4>
					<p class="headline" data-testid="level-check-estimate">
						{t('settings.levelCheck.estimate', { share: pct(estimate.share), level: targetName })}
					</p>
					{#if estimate.exact}
						<p class="hint" data-testid="level-check-exact">{t('settings.levelCheck.exact', { count: estimate.asked })}</p>
					{:else if estimate.asked > 0}
						<p class="hint">{t('settings.levelCheck.range', { low: pct(estimate.low), high: pct(estimate.high), count: estimate.asked })}</p>
					{/if}
					<p>{bandText(estimate.band)}</p>

					<h5 class="list-title">{t('settings.levelCheck.coverageTitle')}</h5>
					<ul class="coverage" data-testid="level-check-coverage">
						<li>{t('settings.levelCheck.known', { count: plan.total.known })}</li>
						<li>{t('settings.levelCheck.learning', { count: plan.total.learning })}</li>
						<li>{t('settings.levelCheck.unseen', { count: plan.total.unseen })}</li>
					</ul>
					<p class="hint">{t('settings.levelCheck.coverageNote', { total: plan.total.total })}</p>

					<h5 class="list-title">{t('settings.levelCheck.perLevel')}</h5>
					<ul class="levels">
						{#each estimate.perLevel as row (row.name)}
							<li>
								<span>{row.name}</span>
								<span>
									{pct(row.share)}
									{#if row.pooled}
										<small>{t('settings.levelCheck.levelPooled')}</small>
									{:else if !row.exact}
										<small>{t('settings.levelCheck.levelRange', { low: pct(row.low), high: pct(row.high), count: row.asked })}</small>
									{/if}
								</span>
							</li>
						{/each}
					</ul>

					<h5 class="list-title">{t('settings.levelCheck.nextTitle')}</h5>
					{#if estimate.next !== null}
						{@const next = estimate.next}
						<p>{t('settings.levelCheck.nextText', { level: next.name })}</p>
						<div class="row">
							<Button variant="primary" onclick={() => studyNext(next.position)} data-testid="level-check-study">
								{t('settings.levelCheck.study', { level: next.name })}
							</Button>
						</div>
					{:else}
						<p>{t('settings.levelCheck.nextNone')}</p>
					{/if}

					<p class="warn">{t('settings.levelCheck.limits')}</p>
					<div class="row">
						<Button onclick={start}>{t('settings.levelCheck.again')}</Button>
						<Button variant="plain" onclick={() => (mode = 'idle')}>{t('settings.levelCheck.close')}</Button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</Section>

<style>
	.badge {
		margin: 0 0 var(--space-2);
	}
	.hint {
		margin: 0;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
	.warn {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-s);
	}
	.form,
	.result {
		display: grid;
		gap: var(--space-2);
		max-width: 28rem;
		margin-top: var(--space-2);
	}
	.result p {
		margin: 0;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.error {
		margin: var(--space-2) 0 0;
		color: var(--readable-bad);
	}
	.result-title,
	.list-title {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
	}
	.headline {
		font-size: var(--font-size-l, 1.25rem);
	}
	.coverage,
	.levels {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.levels li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}
</style>
