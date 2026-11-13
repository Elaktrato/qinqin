<script lang="ts">
	import { parseReview } from '$lib/study/reviewParse';
	import { ApiError, api } from '$lib/api/client';
	import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
	import type { EntryBase, Level, Scheme } from '$lib/api/types';
	import type { StudyEvent } from '$lib/events';
	import { fillMissingWrittenProgressively } from '$lib/study/entriesCache';
	import {
		masteryForChars,
		summarizeMastery,
		type CharMastery,
		type MasteryStage,
		type MasterySummary
	} from '$lib/study/mastery';
	import { loadStudyData } from '$lib/study/store';
	import type { ReviewEvent, ReviewGrade, StudyCard } from '$lib/study/types';
	import { usesHan } from '$lib/languages';
	import { workspaces } from '$lib/workspaces';

	// The `learned` band: a character at or above this score counts as
	// mastered in the level progress lines.
	const MASTERY_THRESHOLD = 80;
	// The empty string is the "All levels" filter value, never a level name.
	const ALL_LEVELS = '';

	const STAGES: { stage: MasteryStage; label: string }[] = [
		{ stage: 'unknown', label: 'Not studied' },
		{ stage: 'fresh', label: 'Fresh' },
		{ stage: 'learning', label: 'Learning' },
		{ stage: 'mature', label: 'Mature' },
		{ stage: 'learned', label: 'Learned' }
	];

	let workspaceId = $state<number | null>(null);
	let language = $state<string | null>(null);
	let loading = $state(true);
	let noWorkspace = $state(false);
	let loadError = $state('');

	let schemes = $state<Scheme[]>([]);
	let schemesLoaded = $state(false);
	let schemesError = $state('');
	let schemeId = $state<number | null>(null);
	let level = $state(ALL_LEVELS);

	let cards = $state<StudyCard[]>([]);
	let reviews = $state<ReviewEvent[]>([]);

	let entries = $state<EntryBase[]>([]);
	let entriesLoading = $state(false);
	let entriesError = $state('');
	// Cards whose legacy written snapshot could not be resolved on this
	// visit. Reported so a partial map never silently under-reports.
	let unresolvedCards = $state(0);

	// Per-level character lists keyed `schemeId:levelName`. Kept outside
	// the reactive summary so a level is fetched once per page visit and
	// toggling the filter does not refetch the whole ladder.
	let levelChars = $state<Record<string, string[]>>({});
	let summaryLoading = $state(false);
	let summaryError = $state('');

	let requestSeq = 0;
	let entriesSeq = 0;
	let summarySeq = 0;

	const levelEntriesCache = new Map<string, EntryBase[]>();

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	/** characterForms keeps the unique written forms of character entries. */
	function characterForms(list: readonly EntryBase[]): string[] {
		const seen = new Set<string>();
		const result: string[] = [];
		for (const entry of list) {
			if (entry.kind !== 'character') continue;
			const written = entry.written;
			if (written === '' || seen.has(written)) continue;
			seen.add(written);
			result.push(written);
		}
		return result;
	}

	function levelKey(scheme: number, name: string): string {
		return `${scheme}:${name}`;
	}

	async function loadSchemes(seq: number): Promise<void> {
		try {
			const list = await getSchemes();
			if (seq !== requestSeq) return;
			schemes = list;
		} catch (err) {
			if (seq !== requestSeq) return;
			schemes = [];
			schemesError = message(err, 'Could not load level schemes.');
		} finally {
			if (seq === requestSeq) schemesLoaded = true;
		}
	}

	/**
	 * backfillWritten keeps the first paint fast: cards that already carry
	 * a snapshot are scored immediately, and legacy ones are folded in as
	 * each entry resolves. Failures stay uncached, so the next load tries
	 * again; whatever remains is reported instead of silently omitted.
	 */
	async function backfillWritten(initial: readonly StudyCard[], seq: number): Promise<void> {
		const result = await fillMissingWrittenProgressively(initial, (nextCards) => {
			if (seq !== requestSeq) return;
			cards = nextCards;
		});
		if (seq !== requestSeq) return;
		unresolvedCards = result.unresolvedCards;
	}

	async function load(id: number | null, lang: string | null): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		loadError = '';
		noWorkspace = false;

		// Everything below belongs to the previous workspace or
		// selection; its in-flight requests must not land here.
		entriesSeq += 1;
		summarySeq += 1;
		schemes = [];
		schemesLoaded = false;
		schemesError = '';
		schemeId = null;
		level = ALL_LEVELS;
		cards = [];
		reviews = [];
		entries = [];
		entriesLoading = false;
		entriesError = '';
		unresolvedCards = 0;
		levelChars = {};
		summaryLoading = false;
		summaryError = '';
		workspaceId = id;
		language = lang;

		if (id === null) {
			noWorkspace = true;
			loading = false;
			return;
		}

		// The ladder and the study data load independently: a slow scheme
		// list must not hide the grid, and vice versa.
		void loadSchemes(seq);

		try {
			const [data, events] = await Promise.all([
				loadStudyData(),
				api<StudyEvent[]>(`/api/events?since=1970-01-01T00:00:00Z&workspace=${id}`)
			]);
			if (seq !== requestSeq) return;

			// Paint with the cards that already know their written form;
			// legacy snapshots resolve in the background and update the
			// grid as they arrive.
			cards = data.cards;
			reviews = events
				.map((event) => (event.workspaceId === id ? parseReview(event) : null))
				.filter((event): event is ReviewEvent => event !== null);
			void backfillWritten(data.cards, seq);
		} catch (err) {
			if (seq !== requestSeq) return;
			cards = [];
			reviews = [];
			unresolvedCards = 0;
			loadError = message(err, 'Could not load your review history.');
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	// The map is built from Han characters; other languages get a note
	// instead (the nav hides the link, but the URL can still be visited).
	const notHan = $derived(
		$workspaces.current !== null && !usesHan($workspaces.current.language)
	);

	$effect(() => {
		const workspace = $workspaces.current;
		if (workspace && !usesHan(workspace.language)) {
			// Drop any in-flight load for a previous workspace.
			requestSeq++;
			loading = false;
			return;
		}
		void load(workspace?.id ?? null, workspace?.language ?? null);
	});

	const schemesForLanguage = $derived(
		schemes.filter((scheme) => scheme.language === language)
	);

	const selectedScheme = $derived(
		schemesForLanguage.find((scheme) => scheme.id === schemeId) ?? null
	);

	const schemeLevels = $derived.by((): Level[] => {
		const scheme = selectedScheme;
		if (scheme === null) return [];
		return [...scheme.levels].sort((a, b) => a.ord - b.ord);
	});

	// Keep the selection valid: the first scheme of the workspace
	// language is the default, and a level that does not exist in the
	// current scheme falls back to "All levels".
	$effect(() => {
		if (!schemesLoaded) return;
		if (schemesForLanguage.length === 0) {
			if (schemeId !== null) schemeId = null;
			if (level !== ALL_LEVELS) level = ALL_LEVELS;
			return;
		}
		if (selectedScheme === null) {
			schemeId = schemesForLanguage[0].id;
			level = ALL_LEVELS;
			return;
		}
		if (level !== ALL_LEVELS && !schemeLevels.some((item) => item.name === level)) {
			level = ALL_LEVELS;
		}
	});

	// The selection the grid can actually fetch: it must resolve against
	// the loaded schemes of the current workspace language, not just the
	// values in the selects.
	const selection = $derived.by((): { schemeId: number; level: string } | null => {
		if (!schemesLoaded) return null;
		const scheme = selectedScheme;
		if (scheme === null) return null;
		if (level !== ALL_LEVELS && !schemeLevels.some((item) => item.name === level)) {
			return null;
		}
		return { schemeId: scheme.id, level };
	});

	async function loadEntries(id: number, wantedLevel: string): Promise<void> {
		const seq = ++entriesSeq;
		entriesLoading = true;
		entriesError = '';
		entries = [];
		try {
			const list = await getSchemeEntries(
				id,
				wantedLevel === ALL_LEVELS ? undefined : wantedLevel
			);
			if (seq !== entriesSeq) return;
			entries = list;
		} catch (err) {
			if (seq !== entriesSeq) return;
			entries = [];
			entriesError = message(err, 'Could not load the characters of this selection.');
		} finally {
			if (seq === entriesSeq) entriesLoading = false;
		}
	}

	// Depending on the resolved selection and the workspace id refetches
	// after a workspace switch even when the saved scheme/level stay valid.
	$effect(() => {
		const current = selection;
		if (workspaceId === null || current === null) {
			entriesSeq += 1;
			entries = [];
			entriesLoading = false;
			entriesError = '';
			return;
		}
		void loadEntries(current.schemeId, current.level);
	});

	/**
	 * loadLevelSummaries walks the scheme's levels one at a time, caching
	 * each level's entries. Fetching strictly sequentially keeps an
	 * eight-level ladder from opening eight requests at once; cached
	 * levels advance the progress list immediately.
	 */
	async function loadLevelSummaries(scheme: Scheme): Promise<void> {
		const seq = ++summarySeq;
		summaryLoading = true;
		summaryError = '';
		levelChars = {};

		const levels = [...scheme.levels].sort((a, b) => a.ord - b.ord);
		try {
			for (const item of levels) {
				const key = levelKey(scheme.id, item.name);
				let list = levelEntriesCache.get(key);
				if (list === undefined) {
					list = await getSchemeEntries(scheme.id, item.name);
					levelEntriesCache.set(key, list);
				}
				if (seq !== summarySeq) return;
				levelChars = { ...levelChars, [key]: characterForms(list) };
			}
		} catch (err) {
			if (seq !== summarySeq) return;
			summaryError = message(err, 'Could not load the level progress.');
		} finally {
			if (seq === summarySeq) summaryLoading = false;
		}
	}

	// The ladder is independent of the grid's level filter: the progress
	// list needs every level's characters, not just the selected one.
	$effect(() => {
		const scheme = selectedScheme;
		if (scheme === null) {
			summarySeq += 1;
			levelChars = {};
			summaryLoading = false;
			summaryError = '';
			return;
		}
		void loadLevelSummaries(scheme);
	});

	const chars = $derived(characterForms(entries));

	// One per-page mastery index: the union of every level's characters
	// (plus the current selection, which may paint first) is scored in a
	// single masteryForChars pass. The grid, the selection count, and all
	// level progress lines read that same map, so a level is never scored
	// by replaying the whole review history again.
	const masteryChars = $derived.by((): string[] => {
		const union = new Set<string>();
		for (const forms of Object.values(levelChars)) {
			for (const char of forms) union.add(char);
		}
		for (const char of chars) union.add(char);
		return [...union];
	});

	const mastery = $derived(masteryForChars(masteryChars, cards, reviews, new Date()));

	const selectionSummary = $derived(
		summarizeMastery(chars, mastery, MASTERY_THRESHOLD)
	);

	const levelSummaries = $derived.by((): { level: Level; summary: MasterySummary | null }[] => {
		const scheme = selectedScheme;
		if (scheme === null) return [];
		return schemeLevels.map((item) => {
			const forms = levelChars[levelKey(scheme.id, item.name)];
			if (forms === undefined) return { level: item, summary: null };
			return {
				level: item,
				summary: summarizeMastery(forms, mastery, MASTERY_THRESHOLD)
			};
		});
	});

	const levelHeading = $derived(
		level === ALL_LEVELS ? 'All levels' : level
	);

	function masteryOf(char: string): CharMastery {
		return mastery.get(char) ?? { score: 0, stage: 'unknown', reviewedCards: 0 };
	}

	function describe(char: string, value: CharMastery): string {
		const unit = value.reviewedCards === 1 ? 'card' : 'cards';
		return `${char} — ${value.score}/100 · ${value.stage} · ${value.reviewedCards} ${unit}`;
	}
</script>

<main class="map">
	<header class="head">
		<div>
			<h1>Mastery map</h1>
			<p class="hint">
				Every character of a level, coloured by how firmly its cards have settled into memory.
				Mastery is derived from review history, so it updates as you study.
			</p>
		</div>
		<a class="back" href="/study">Study</a>
	</header>

	{#if notHan}
		<p class="hint" role="status">
			The character map is for Chinese and Japanese workspaces. <a href="/study">Back to Study</a>
		</p>
	{:else if noWorkspace}
		<p class="hint" role="status">Choose a workspace in the header to see its mastery map.</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
	{:else if loading}
		<p class="hint" role="status">Loading your review history…</p>
	{:else}
		<section class="filters" aria-label="Map filters">
			{#if schemesError}
				<p class="error" role="alert">{schemesError}</p>
			{:else if !schemesLoaded}
				<p class="hint" role="status">Loading level schemes…</p>
			{:else if schemesForLanguage.length === 0}
				<p class="hint">No level schemes are installed for this workspace language.</p>
			{:else}
				<label>
					Scheme
					<select bind:value={schemeId}>
						{#each schemesForLanguage as scheme (scheme.id)}
							<option value={scheme.id}>{scheme.name}</option>
						{/each}
					</select>
				</label>
				<label>
					Level
					<select bind:value={level}>
						<option value={ALL_LEVELS}>All levels</option>
						{#each schemeLevels as item (item.id)}
							<option value={item.name}>{item.name}</option>
						{/each}
					</select>
				</label>
			{/if}
		</section>

		{#if selectedScheme}
			<section class="progress" aria-labelledby="progress-heading">
				<h2 id="progress-heading">Level progress</h2>
				<p class="hint">
					Characters at {MASTERY_THRESHOLD}/100 or above count as mastered.
				</p>

				{#if summaryError}
					<p class="error" role="alert">{summaryError}</p>
				{/if}

				<ul class="levels">
					{#each levelSummaries as row (row.level.id)}
						<li>
							<span class="level-name">{row.level.name}</span>
							{#if row.summary}
								<span>
									— <strong>{row.summary.mastered}</strong>/{row.summary.total} mastered
								</span>
							{:else}
								<span class="hint">— …</span>
							{/if}
						</li>
					{/each}
				</ul>

				{#if summaryLoading}
					<p class="hint" role="status">Loading level progress…</p>
				{/if}
			</section>

			<section class="panel" aria-labelledby="grid-heading">
				<h2 id="grid-heading">
					{selectedScheme.name} · {levelHeading}
					<span class="count">
						<strong>{selectionSummary.mastered}</strong>/{selectionSummary.total} mastered
					</span>
				</h2>

				<ul class="legend" aria-label="Mastery legend">
					{#each STAGES as item (item.stage)}
						<li>
							<span class="swatch stage-{item.stage}" aria-hidden="true"></span>
							{item.label}
						</li>
					{/each}
				</ul>

				{#if unresolvedCards > 0}
					<p class="hint note" role="status">
						{unresolvedCards}
						{unresolvedCards === 1 ? 'card' : 'cards'} could not be resolved, so this map may
						under-report mastery.
					</p>
				{/if}

				{#if entriesError}
					<p class="error" role="alert">{entriesError}</p>
				{:else if entriesLoading}
					<p class="hint" role="status">Loading the characters of this selection…</p>
				{:else if chars.length === 0}
					<p class="hint">This selection has no characters yet.</p>
				{:else}
					<ul class="grid" aria-label="Character mastery">
						{#each chars as char (char)}
							{@const value = masteryOf(char)}
							<li
								class="cell stage-{value.stage}"
								title={describe(char, value)}
								aria-label={describe(char, value)}
							>
								<span>{char}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	.map {
		max-width: 64rem;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
	}

	.head h1 {
		margin-bottom: 0.4rem;
	}

	.back {
		font-weight: 600;
		white-space: nowrap;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.filters label {
		display: grid;
		gap: 0.35rem;
		font-weight: 600;
	}

	.filters select {
		font: inherit;
		padding: 0.4rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.progress,
	.panel {
		margin-top: 2rem;
	}

	.progress h2,
	.panel h2 {
		margin-bottom: 0.5rem;
	}

	.levels {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}

	.levels li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
		padding-bottom: 0.3rem;
	}

	.level-name {
		font-weight: 600;
	}

	.count {
		margin-left: 0.75rem;
		font-size: 0.9rem;
		font-weight: 400;
		opacity: 0.8;
	}

	.legend {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		font-size: 0.85rem;
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.swatch {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 0.2rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(2.6rem, 1fr));
		gap: 0.25rem;
	}

	.cell {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border-radius: 0.3rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		font-size: 1.15rem;
		line-height: 1;
	}

	/* The five bands: grey for untouched, amber → green as mastery grows. */
	.stage-unknown {
		background: color-mix(in srgb, currentColor 8%, transparent);
		color: color-mix(in srgb, currentColor 55%, transparent);
	}

	.stage-fresh {
		background: #fdecea;
		color: #8c1d18;
	}

	.stage-learning {
		background: #fff1d6;
		color: #7a4a00;
	}

	.stage-mature {
		background: #dceeff;
		color: #0b4f8a;
	}

	.stage-learned {
		background: #dff3e4;
		color: #145c2e;
	}

	.hint {
		opacity: 0.75;
	}

	.error {
		margin: 0.5rem 0 0;
		color: #c62828;
		font-weight: 600;
	}
</style>
