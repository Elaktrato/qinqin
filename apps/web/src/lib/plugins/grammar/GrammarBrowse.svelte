<script lang="ts">
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { getSchemes } from '$lib/api/schemes';
	import { languageLabel } from '$lib/languages';
	import { workspaces } from '$lib/workspaces';
	import { pluginEnabled } from '../index';
	import { pluginStates } from '../states';
	import { listGrammar } from './api';
	import { browseSections } from './browse';
	import { loadProgress } from './progress';
	import { grammarHref } from './route';
	import type { PackInfo, Progress } from './types';
	import type { Scheme } from '$lib/api/types';

	const workspace = $derived($workspaces.current);

	let packs = $state<PackInfo[] | null>(null);
	let schemes = $state<Scheme[]>([]);
	let progress = $state(new Map<string, Progress>());
	let error = $state('');
	let seq = 0;

	$effect(() => {
		const ws = workspace;
		if (ws === null) return;
		const mine = ++seq;
		packs = null;
		error = '';
		void Promise.all([
			listGrammar(ws.language),
			getSchemes().catch(() => [] as Scheme[]),
			loadProgress(ws.id).catch(() => new Map<string, Progress>())
		]).then(
			([p, s, pr]) => {
				if (mine !== seq) return;
				packs = p;
				schemes = s;
				progress = pr;
			},
			() => {
				if (mine === seq) error = t('grammar.loadFailed');
			}
		);
	});

	const sections = $derived(
		packs === null
			? []
			: browseSections(
					packs,
					schemes,
					(id) => pluginEnabled(id, $pluginStates.list),
					progress
				)
	);
</script>

<div class="page-body grammar">
	<h1>
		{t('grammar.title')}{#if workspace}<span class="lang"> · {languageLabel(workspace.language)}</span>{/if}
	</h1>

	{#if workspace === null}
		<p>{t('grammar.chooseWorkspace')}</p>
	{:else if error}
		<p class="error" role="alert">{error}</p>
	{:else if packs === null}
		<p role="status">{t('common.loading')}</p>
	{:else if sections.length === 0}
		<p>
			<Msg key="grammar.none">{#snippet link(text: string)}<a href="/sources">{text}</a>{/snippet}</Msg>
		</p>
	{:else}
		{#each sections as section (section.packId)}
			<section aria-labelledby={`pack-${section.packId}`}>
				<h2 id={`pack-${section.packId}`} class="pack">{section.packName}</h2>
				{#each section.levels as level (level.id)}
					<h3 class="level">
						{level.name}
						{#each level.badges as badge (badge)}<span class="badge">{badge}</span>{/each}
					</h3>
					<ul class="lessons">
						{#each level.lessons as lesson (lesson.id)}
							<li>
								<a
									class="lesson"
									href={grammarHref({ view: 'lesson', pack: section.packId, lesson: lesson.id })}
								>
									<span class="done" aria-hidden="true">{lesson.progress ? '✓' : ''}</span>
									<span class="text">
										<span class="title">{lesson.title}</span>
										<span class="summary">{lesson.summary}</span>
									</span>
									{#if lesson.progress}
										<span class="score">
											<span class="visually-hidden">{`${t('grammar.bestScore')} `}</span>{lesson.progress.best}/{lesson.progress
												.total}
										</span>
									{/if}
								</a>
							</li>
						{/each}
					</ul>
				{/each}
				<p class="credits">
					{section.credits.license} · {section.credits.attribution}
				</p>
			</section>
		{/each}
	{/if}
</div>

<style>
	.grammar {
		max-width: 46rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.lang {
		font-weight: 400;
		color: var(--readable-muted);
	}

	.pack {
		margin: 1.5rem 0 0;
		font-size: 1rem;
		color: var(--readable-muted);
		font-weight: 600;
	}

	.level {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 1rem 0 0.4rem;
		font-size: 1.15rem;
	}

	.badge {
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		font-size: 0.8rem;
		font-weight: 600;
	}

	.lessons {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}

	.lesson {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 0.5rem;
		color: inherit;
		text-decoration: none;
	}

	.lesson:hover {
		border-color: var(--accent);
	}

	.lesson:focus-visible {
		outline: 2px solid var(--focus-colour);
		outline-offset: 2px;
	}

	.done {
		width: 1.25rem;
		color: var(--good);
		font-weight: 700;
		text-align: center;
	}

	.text {
		display: grid;
		flex: 1;
		min-width: 0;
	}

	.title {
		font-weight: 600;
	}

	.summary {
		font-size: 0.9rem;
		color: var(--readable-muted);
	}

	.score {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.credits {
		margin: 1rem 0 0;
		font-size: 0.85rem;
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
