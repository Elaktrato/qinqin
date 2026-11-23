<script lang="ts">
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { getSchemes } from '$lib/api/schemes';
	import { languageLabel } from '$lib/languages';
	import { workspaces } from '$lib/workspaces';
	import { listGrammar } from './api';
	import { browseSections } from './browse';
	import { loadProgress } from './progress';
	import { grammarHref } from './route';
	import type { PackInfo, Progress } from './types';
	import type { Scheme } from '$lib/api/types';
	import { Chip, Section } from '$lib/ui';

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

	const sections = $derived(packs === null ? [] : browseSections(packs, schemes, progress));
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
			<Section title={section.packName}>
				{#each section.levels as level (level.id)}
					<h3 class="level">
						{level.name}
						{#each level.badges as badge (badge)}<Chip>{badge}</Chip>{/each}
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
			</Section>
		{/each}
	{/if}
</div>

<style>
		/* No second page container: .page-body owns the column (#106). */
	.lang {
		font-weight: var(--weight-regular);
		color: var(--readable-muted);
	}

	.level {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-block: var(--space-4) var(--space-1);
		font-size: var(--font-size-l);
	}

	/* Points are hairline rows, not cards (#106). */
	.lessons {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.lessons li + li {
		border-top: 1px solid var(--hair);
	}

	.lesson {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--hit);
		padding-block: var(--space-2);
		color: inherit;
		text-decoration: none;
	}

	.lesson:hover .title {
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.lesson:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.done {
		width: 1.25rem;
		color: var(--good);
		font-weight: var(--weight-strong);
		text-align: center;
	}

	.text {
		display: grid;
		flex: 1;
		min-width: 0;
	}

	.title {
		font-weight: var(--weight-medium);
	}

	.summary {
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.score {
		font-variant-numeric: tabular-nums;
		font-weight: var(--weight-medium);
	}

	.credits {
		margin-block: var(--space-4) 0;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
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
