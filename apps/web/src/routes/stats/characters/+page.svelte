<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { ApiError } from '$lib/api/client';
	import { fetchCharacters, type CharacterList } from '$lib/api/characters';
	import { fetchSchemeCharacters, getSchemes } from '$lib/api/schemes';
	import { levelAttributionLine } from '$lib/study/levelAttribution';
	import type { Scheme } from '$lib/api/types';
	import { usesHan } from '$lib/languages';
	import CellTip from '$lib/components/map/CellTip.svelte';
	import CharGrid from '$lib/components/map/CharGrid.svelte';
	import StageBar from '$lib/components/map/StageBar.svelte';
	import {
		cellStates,
		filterCells,
		groupOptions,
		masteryGlyphs,
		sectionStats,
		variantFormCount,
		type CellState,
		type GroupKey,
		type SchemeLevelMembers,
		type Stage,
		type StageFilter
	} from '$lib/study/charGroups';
	import { fillMissingWrittenProgressively } from '$lib/study/entriesCache';
	import {
		STAGE_INFO,
		defaultOpenSections,
		filterAnnouncement,
		formatCount,
		jumpGlyph,
		learnedSummary,
		locateGlyph,
		readGroupBy,
		sectionsFor,
		writeGroupBy,
		type TipRequest
	} from '$lib/study/mapGrid';
import { contextForData, currentContext } from '$lib/study/currentContext';
import type { StudyContext } from '$lib/study/studyContext';
	import { MASTERY_THRESHOLD, masteryForChars } from '$lib/study/mastery';
	import { DEFAULT_W } from '$lib/study/fsrs/params';
	import { activeWeights, loadStudyData } from '$lib/study/store';
	import type { ReviewEvent, StudyCard } from '$lib/study/types';
	import { workspaces } from '$lib/workspaces';

	const TIP_ID = 'map-cell-tip';
	const SEARCH_DELAY_MS = 200;

	const FILTERS: { value: StageFilter; label: string; stages: Stage[] }[] = [
		{ value: 'all', label: 'All', stages: [] },
		{ value: 'not-started', label: 'Not studied', stages: ['unknown'] },
		{ value: 'learning', label: 'In progress', stages: ['fresh', 'learning', 'mature'] },
		{ value: 'learned', label: 'Learned', stages: ['learned'] }
	];

	let workspaceId = $state<number | null>(null);
	let language = $state('');
	let loading = $state(true);
	let noWorkspace = $state(false);
	let loadError = $state('');

	let universe = $state.raw<CharacterList | null>(null);
	let schemes = $state.raw<Scheme[]>([]);
	let schemesError = $state('');
	let cards = $state.raw<StudyCard[]>([]);
	let reviews = $state.raw<ReviewEvent[]>([]);
	let weights = $state.raw<readonly number[]>(DEFAULT_W);
	let ctx = $state.raw<StudyContext>(currentContext());
	// Cards whose legacy written snapshot could not be resolved on this
	// visit. Reported so the map never silently under-reports.
	let unresolvedCards = $state(0);

	let groupKey = $state<GroupKey | null>(null);
	let stageFilter = $state<StageFilter>('all');
	let queryInput = $state('');
	let query = $state('');
	let jumpInput = $state('');

	// The remembered open sections of the grouping, and a separate set for
	// the filtered view: a search or stage filter opens every section with
	// a match, and clearing it returns to the remembered state.
	let openIds = $state.raw<Set<string>>(new Set());
	let active = $state<Record<string, number>>({});
	let tip = $state.raw<TipRequest | null>(null);
	let announcement = $state('');

	// Level characters of installed schemes, loaded only when such a
	// grouping is chosen (fetchSchemeCharacters keeps them for the session).
	let members = $state.raw<{ schemeId: number; levels: SchemeLevelMembers[] } | null>(null);
	let membersLoading = $state(false);
	let membersError = $state('');

	// The open sections' grids, for jump-to-character.
	const grids: Record<string, { reveal: (index: number) => Promise<HTMLElement | null> }> = {};
	let searchBox = $state<HTMLInputElement | null>(null);

	let requestSeq = 0;
	let membersSeq = 0;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let announceTimer: ReturnType<typeof setTimeout> | undefined;

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	function storage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	/**
	 * backfillWritten keeps the first paint fast: cards that already carry
	 * a snapshot are scored immediately, and legacy ones are folded in as
	 * each entry resolves. Whatever remains unresolved is reported.
	 */
	async function backfillWritten(initial: readonly StudyCard[], seq: number): Promise<void> {
		const result = await fillMissingWrittenProgressively(initial, (nextCards) => {
			if (seq !== requestSeq) return;
			cards = nextCards;
		});
		if (seq !== requestSeq) return;
		unresolvedCards = result.unresolvedCards;
	}

	async function loadSchemeList(): Promise<Scheme[]> {
		try {
			return await getSchemes();
		} catch (err) {
			// The built-in groupings work without the scheme list.
			schemesError = message(err, 'Could not load the installed level schemes.');
			return [];
		}
	}

	async function load(id: number | null, lang: string): Promise<void> {
		const seq = ++requestSeq;
		membersSeq += 1;
		loading = true;
		loadError = '';
		noWorkspace = false;
		universe = null;
		schemes = [];
		schemesError = '';
		cards = [];
		reviews = [];
		unresolvedCards = 0;
		groupKey = null;
		members = null;
		membersLoading = false;
		membersError = '';
		active = {};
		tip = null;
		workspaceId = id;
		language = lang;

		if (id === null) {
			noWorkspace = true;
			loading = false;
			return;
		}

		try {
			// Duplicate cards arrive merged, their reviews re-pointed.
			const [list, schemeList, data] = await Promise.all([
				fetchCharacters(lang),
				loadSchemeList(),
				loadStudyData(id)
			]);
			if (seq !== requestSeq) return;
			universe = list;
			schemes = schemeList;
			cards = data.cards;
			reviews = data.reviews;
			weights = activeWeights(data);
			ctx = contextForData(data, id);
			groupKey = readGroupBy(storage(), lang, groupOptions(lang, schemeList));
			void backfillWritten(data.cards, seq);
		} catch (err) {
			if (seq !== requestSeq) return;
			loadError = message(err, 'Could not load the character map.');
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	function retry() {
		void load(workspaceId, language);
	}

	// The map is built from Han characters; other languages get a note
	// instead (Stats hides the tab, but the URL can still be visited).
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
		void untrack(() => load(workspace?.id ?? null, workspace?.language ?? ''));
	});

	const options = $derived(groupOptions(language, schemes));
	const chars = $derived(universe?.chars ?? []);

	// One mastery pass over every glyph and variant; a cell takes the best
	// of its forms (a card written 愛 lights 爱).
	const cellByRow = $derived.by(() => {
		const mastery = masteryForChars(masteryGlyphs(chars), cards, reviews, new Date(), weights, ctx.clock);
		const map = new Map<(typeof chars)[number], CellState>();
		for (const cell of cellStates(chars, mastery)) map.set(cell.char, cell);
		return map;
	});

	const totals = $derived(sectionStats([...cellByRow.values()]));

	const schemeId = $derived(
		groupKey !== null && groupKey.startsWith('scheme:') ? Number(groupKey.slice(7)) : null
	);

	// The credit line of the level scheme grouping the map, if any.
	const attributionLine = $derived(
		levelAttributionLine(schemeId === null ? null : schemes.find((s) => s.id === schemeId))
	);

	async function loadMembers(id: number): Promise<void> {
		const seq = ++membersSeq;
		membersLoading = true;
		membersError = '';
		try {
			// One request for every level: the server sends each level's
			// characters as one string, lowest level first.
			const levels = await fetchSchemeCharacters(id);
			if (seq !== membersSeq) return;
			members = { schemeId: id, levels };
		} catch (err) {
			if (seq !== membersSeq) return;
			membersError = message(err, 'Could not load the levels of this scheme.');
		} finally {
			if (seq === membersSeq) membersLoading = false;
		}
	}

	$effect(() => {
		const id = schemeId;
		if (id === null) return;
		untrack(() => {
			if (members?.schemeId === id) return;
			void loadMembers(id);
		});
	});

	// Null while a scheme grouping's levels are still loading.
	const grouping = $derived.by(() => {
		if (groupKey === null) return null;
		if (schemeId !== null) {
			if (members?.schemeId !== schemeId) return null;
			return sectionsFor(chars, groupKey, members.levels);
		}
		return sectionsFor(chars, groupKey);
	});

	const filtering = $derived(stageFilter !== 'all' || query.trim() !== '');

	const views = $derived.by(() => {
		if (grouping === null) return [];
		return grouping.sections.map((section) => {
			const cells = section.chars.map((row) => cellByRow.get(row)!);
			const shown = filtering ? filterCells(cells, stageFilter, query) : cells;
			const level = members?.levels.find((l) => `level-${l.levelId}` === section.id);
			const variants = schemeId === null ? 0 : variantFormCount(section.chars, level?.chars);
			return { id: section.id, label: section.label, cells, shown, stats: sectionStats(cells), variants };
		});
	});

	const shownTotal = $derived(views.reduce((sum, view) => sum + view.shown.length, 0));
	const visibleViews = $derived(views.filter((view) => !filtering || view.shown.length > 0));
	// Recomputed (and the learner's toggles in the filtered view dropped)
	// whenever the filter, search or grouping changes; not on mastery updates.
	let filterOpenIds = $derived.by(() => {
		void grouping;
		void stageFilter;
		void query;
		return untrack(
			() => new Set(views.filter((view) => view.shown.length > 0).map((view) => view.id))
		);
	});

	const openSet = $derived(filtering ? filterOpenIds : openIds);
	const allOpen = $derived(visibleViews.every((view) => openSet.has(view.id)));

	const filterCounts = $derived<Record<StageFilter, number>>({
		all: totals.total,
		'not-started': totals.byStage.unknown,
		learning: totals.byStage.fresh + totals.byStage.learning + totals.byStage.mature,
		learned: totals.byStage.learned
	});

	const levelHint = $derived(universe?.stale === true || grouping?.gap === true);

	// A new grouping starts with every section open. Sections the learner
	// collapses stay collapsed while filtering; only a new grouping resets.
	$effect(() => {
		void grouping;
		untrack(() => {
			openIds = defaultOpenSections(views.map((view) => ({ id: view.id, size: view.cells.length })));
			active = {};
			tip = null;
		});
	});


	function setOpen(next: Set<string>) {
		if (filtering) filterOpenIds = next;
		else openIds = next;
	}

	// A filter can remove the focused cell (or its whole section); focus
	// then falls to <body>. Put it back on that section's tab stop, else on
	// the search box.
	let focusSection: string | null = null;

	function trackFocus(event: FocusEvent) {
		const target = event.target instanceof Element ? event.target : null;
		focusSection = target?.closest<HTMLElement>('[data-section]')?.dataset.section ?? null;
	}

	$effect(() => {
		void visibleViews;
		const section = focusSection;
		if (section === null) return;
		void tick().then(() => {
			if (document.activeElement !== document.body && document.activeElement !== null) return;
			const stop = document.querySelector<HTMLElement>(
				`[data-section="${CSS.escape(section)}"] [tabindex="0"]`
			);
			(stop ?? searchBox)?.focus({ preventScroll: stop === null });
		});
	});

	// Announce what a filter left, once typing settles.
	$effect(() => {
		void stageFilter;
		void query;
		clearTimeout(announceTimer);
		const text = untrack(() => filterAnnouncement(shownTotal, totals.total, filtering));
		// Nothing to say on the first paint, before any filter was used.
		if (untrack(() => universe === null || (!filtering && announcement === ''))) return;
		announceTimer = setTimeout(() => (announcement = text), 400);
		return () => clearTimeout(announceTimer);
	});

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => (query = queryInput), SEARCH_DELAY_MS);
	}

	function clearSearch() {
		clearTimeout(searchTimer);
		queryInput = '';
		query = '';
	}

	function chooseGroup(key: GroupKey) {
		groupKey = key;
		writeGroupBy(storage(), language, key);
		// A failed scheme load belongs to that scheme only; a late answer
		// for it must not land on the new grouping either.
		membersSeq += 1;
		membersError = '';
		membersLoading = false;
	}

	// A collapsed section forgets its active cell: re-expanding starts at
	// the top and with the first batch, not at a deep jump target.
	function forgetActive(ids: Iterable<string>) {
		const next = { ...active };
		for (const id of ids) delete next[id];
		active = next;
	}

	function toggle(id: string) {
		const next = new Set(openSet);
		if (next.has(id)) {
			next.delete(id);
			forgetActive([id]);
		} else {
			next.add(id);
		}
		setOpen(next);
		tip = null;
	}

	function toggleAll() {
		if (allOpen) forgetActive(openSet);
		setOpen(allOpen ? new Set() : new Set(visibleViews.map((view) => view.id)));
		tip = null;
	}

	function showTip(request: TipRequest) {
		tip = request;
	}

	function hideTip(force: boolean) {
		if (tip === null) return;
		// A popover shown for keyboard focus stays while the cell keeps it.
		if (!force && tip.via !== 'hover' && document.activeElement === tip.el) return;
		tip = null;
	}

	async function jump(event: SubmitEvent) {
		event.preventDefault();
		const glyph = jumpGlyph(jumpInput);
		if (glyph === null) return;
		let found = locateGlyph(
			visibleViews.map((view) => ({ id: view.id, cells: view.shown })),
			glyph
		);
		if (found === null && filtering) {
			// Hidden by the filter: clear it, then look again.
			const everywhere = locateGlyph(
				views.map((view) => ({ id: view.id, cells: view.cells })),
				glyph
			);
			if (everywhere !== null) {
				stageFilter = 'all';
				clearSearch();
				await tick();
				// The jump's own announcement follows; drop the "Showing all".
				clearTimeout(announceTimer);
				found = everywhere;
			}
		}
		if (found === null) {
			announcement = `${glyph} is not in this map.`;
			return;
		}
		const target = found;
		if (!openSet.has(target.sectionId)) setOpen(new Set([...openSet, target.sectionId]));
		await tick();
		// The section keeps rendering in batches (this one first); the cell
		// is focused as soon as it exists.
		const el = (await grids[target.sectionId]?.reveal(target.index)) ?? null;
		clearTimeout(announceTimer);
		if (el === null) return;
		el.scrollIntoView({ block: 'center' });
		el.focus({ preventScroll: true });
		el.classList.remove('flash');
		void el.offsetWidth;
		el.classList.add('flash');
		const label = views.find((view) => view.id === target.sectionId)?.label ?? '';
		announcement = `${el.textContent ?? glyph} is in ${label}.`;
	}

	/** headerName is a section button's name: "Grade 2, 0 of 160 learned". */
	function headerName(
		view: { label: string; stats: { learned: number; total: number }; shown: unknown[]; variants: number },
		filtered: boolean
	): string {
		const extra = view.variants > 0 ? `, including ${formatCount(view.variants)} variant forms` : '';
		const base = `${view.label}, ${formatCount(view.stats.learned)} of ${formatCount(view.stats.total)} learned${extra}`;
		return filtered ? `${base}, ${formatCount(view.shown.length)} shown` : base;
	}

	const langTag = $derived(language.toLowerCase().startsWith('ja') ? 'ja' : 'zh-Hans');
</script>

<!-- The Characters view of Stats: the Stats layout gives the page
     heading and the tablist, so this view's headings start at h2. -->
<div class="map" onfocusin={trackFocus}>
	<header class="head">
		<h2>Mastery map</h2>
		{#if !notHan}
			<p class="hint">
				Every character of the dictionary, grouped by level and coloured by how firmly its cards
				have settled into memory. Mastery is derived from review history, so it updates as you
				study.
			</p>
		{/if}
	</header>

	{#if notHan}
		<p class="hint" role="status">
			The character map is for Chinese and Japanese workspaces.
			<a href="/stats">See the Overview</a>
		</p>
	{:else if noWorkspace}
		<p class="hint" role="status">Choose a workspace in the header to see its mastery map.</p>
	{:else if loadError}
		<div class="error-box" role="alert">
			<p class="error">{loadError}</p>
			<button type="button" class="btn" onclick={retry}>Retry</button>
		</div>
	{:else if loading || universe === null}
		<div class="skeleton" role="status" aria-label="Loading the character map">
			<span class="sk-line wide"></span>
			<span class="sk-line"></span>
			{#each [0, 1, 2] as n (n)}
				<span class="sk-block"></span>
			{/each}
		</div>
	{:else if universe.count === 0}
		<p class="banner" role="status">
			No characters are installed for this language. Level data missing — run <code>qinqin seed</code>
			to refresh.
		</p>
	{:else}
		<section class="summary" aria-label="Summary">
			<p class="total">
				<strong>{learnedSummary(totals.learned, totals.total)}</strong>
				<span class="hint small">Learned = {MASTERY_THRESHOLD}/100 or more.</span>
			</p>
			<StageBar byStage={totals.byStage} size="large" />
			<div class="legend" role="group" aria-label="Show stage">
				{#each FILTERS as item (item.value)}
					<button
						type="button"
						class="chip"
						aria-pressed={stageFilter === item.value}
						onclick={() => (stageFilter = item.value)}
					>
						{#if item.stages.length === 0}
							<span>All</span>
							<span class="num">{formatCount(filterCounts.all)}</span>
						{:else if item.stages.length === 1}
							<span class="swatch st-{item.stages[0]}" aria-hidden="true"></span>
							<span>{item.label}</span>
							<span class="num">{formatCount(totals.byStage[item.stages[0]])}</span>
						{:else}
							<span class="sr">{item.label}: {formatCount(filterCounts.learning)},</span>
							{#each item.stages as stage, n (stage)}
								{#if n > 0}<span class="dot" aria-hidden="true">·</span>{/if}
								<span class="swatch st-{stage}" aria-hidden="true"></span>
								<span>{STAGE_INFO.find((s) => s.stage === stage)?.label}</span>
								<span class="num">{formatCount(totals.byStage[stage])}</span>
							{/each}
						{/if}
					</button>
				{/each}
			</div>
		</section>

		{#if levelHint}
			<p class="banner" role="status">
				Level data missing — run <code>qinqin seed</code> to refresh.
			</p>
		{/if}

		{#if unresolvedCards > 0}
			<p class="hint note" role="status">
				{unresolvedCards}
				{unresolvedCards === 1 ? 'card' : 'cards'} could not be resolved, so this map may under-report
				mastery.
			</p>
		{/if}

		<section class="controls" aria-label="Map controls">
			<label class="field">
				<span>Group by</span>
				<select
					value={groupKey}
					onchange={(event) => chooseGroup(event.currentTarget.value as GroupKey)}
				>
					{#each options as option (option.key)}
						<option value={option.key}>{option.label}</option>
					{/each}
				</select>
			</label>
			<label class="field grow">
				<span>Search</span>
				<input
					type="search"
					placeholder="Character, reading or meaning"
					bind:this={searchBox}
					bind:value={queryInput}
					oninput={onSearchInput}
					onkeydown={(event) => event.key === 'Escape' && clearSearch()}
				/>
			</label>
			<form class="field jump" onsubmit={jump}>
				<label for="map-jump">Jump to character</label>
				<span class="row">
					<input id="map-jump" type="text" maxlength="8" autocomplete="off" bind:value={jumpInput} />
					<button type="submit" class="btn">Go</button>
				</span>
			</form>
		</section>
		{#if attributionLine}
			<p class="hint small attribution">
				{attributionLine} · <a href="/sources">Sources</a>
			</p>
		{/if}
		{#if schemesError}
			<p class="hint small">{schemesError}</p>
		{/if}

		<p class="sr" role="status" aria-live="polite">{announcement}</p>

		{#if membersError && schemeId !== null}
			<div class="error-box" role="alert">
				<p class="error">{membersError}</p>
				<button type="button" class="btn" onclick={() => schemeId !== null && loadMembers(schemeId)}
					>Retry</button
				>
			</div>
		{:else if grouping === null}
			<p class="hint" role="status">{membersLoading ? 'Loading the levels of this scheme…' : ''}</p>
		{:else}
			<div class="bar-row">
				<p class="hint small">
					{#if filtering}
						{formatCount(shownTotal)} of {formatCount(totals.total)} shown
					{:else}
						{visibleViews.length}
						{visibleViews.length === 1 ? 'section' : 'sections'}
					{/if}
				</p>
				{#if visibleViews.length > 1}
					<button type="button" class="btn quiet" onclick={toggleAll}>
						{allOpen ? 'Collapse all' : 'Expand all'}
					</button>
				{/if}
			</div>

			{#if filtering && shownTotal === 0}
				<p class="hint">No characters match.</p>
			{/if}

			{#each visibleViews as view, index (view.id)}
				{@const open = openSet.has(view.id)}
				<section class="block" class:open aria-labelledby="head-{view.id}">
					<h3 class="block-head">
						<button
							type="button"
							id="head-{view.id}"
							aria-expanded={open}
							aria-controls="cells-{view.id}"
							aria-label={headerName(view, filtering)}
							onclick={() => toggle(view.id)}
						>
							<span class="chev" aria-hidden="true"></span>
							<span class="label">{view.label}</span>
							<span
								class="count"
								aria-hidden="true"
								title={view.variants > 0
									? `${formatCount(view.stats.total)} includes ${formatCount(view.variants)} variant forms of listed characters`
									: undefined}
							>
								<strong>{formatCount(view.stats.learned)}</strong>/{formatCount(view.stats.total)}{#if view.variants > 0}
									<small>(incl. {formatCount(view.variants)} variant forms)</small>{/if}
							</span>
							{#if filtering}
								<span class="shown" aria-hidden="true">{formatCount(view.shown.length)} shown</span>
							{/if}
							<StageBar byStage={view.stats.byStage} decorative />
						</button>
					</h3>
					<div id="cells-{view.id}">
						{#if open}
							<CharGrid
								bind:this={grids[view.id]}
								sectionId={view.id}
								label={view.label}
								order={index}
								cells={view.shown}
								bind:active={() => active[view.id] ?? 0, (value) => (active[view.id] = value)}
								tipId={tip?.cell.char.i ?? null}
								tipElementId={TIP_ID}
								ontip={showTip}
								onhide={hideTip}
							/>
						{/if}
					</div>
				</section>
			{/each}

			{#if language.toLowerCase().startsWith('zh')}
				<p class="hint small foot">
					Lists the standard characters (通用规范汉字表) and every character with a CC-CEDICT
					reading. Rarer Unihan characters are not listed. A traditional form shares the cell of its
					simplified form.
				</p>
			{/if}
		{/if}
	{/if}

	<CellTip {tip} id={TIP_ID} lang={langTag} />
</div>

<style>
	.map {
		--st-edge: color-mix(in srgb, currentColor 18%, transparent);
		--st-focus: #0b6bcb;
		--st-tip-bg: #fff;
		--st-tip-fg: #1b1b1b;
		--st-unknown-bg: color-mix(in srgb, currentColor 4%, transparent);
		--st-unknown-fg: color-mix(in srgb, currentColor 62%, transparent);
		/* ≥ 3:1 against the page and the cell (computed: 3.7 on white). */
		--st-unknown-edge: #858585;
		--st-unknown-bar: color-mix(in srgb, currentColor 14%, transparent);
		--st-fresh-bg: #fdecea;
		--st-fresh-fg: #8c1d18;
		--st-fresh-bar: #e57373;
		--st-learning-bg: #fff1d6;
		--st-learning-fg: #7a4a00;
		--st-learning-bar: #f0a72c;
		--st-mature-bg: #dceeff;
		--st-mature-fg: #0b4f8a;
		--st-mature-bar: #4a90d9;
		--st-learned-bg: #dff3e4;
		--st-learned-fg: #145c2e;
		--st-learned-bar: #2e9a55;
	}

	@media (prefers-color-scheme: dark) {
		.map {
			--st-focus: #6cb4ff;
			/* ≥ 3:1 against the dark page and the cell (computed: 3.6 on #121212). */
			--st-unknown-edge: #6e6e6e;
			--st-tip-bg: #1f2328;
			--st-tip-fg: #eef0f2;
			--st-fresh-bg: #4a1f1c;
			--st-fresh-fg: #ffb4ab;
			--st-fresh-bar: #e57373;
			--st-learning-bg: #45320c;
			--st-learning-fg: #ffd88a;
			--st-learning-bar: #e0a03a;
			--st-mature-bg: #12324f;
			--st-mature-fg: #a8d2ff;
			--st-mature-bar: #5aa0e6;
			--st-learned-bg: #143f27;
			--st-learned-fg: #9fe3b5;
			--st-learned-bar: #43b56c;
		}
	}

	.head h2 {
		margin: 0 0 0.4rem;
		font-size: 1.25rem;
	}

	.head .hint {
		margin: 0;
	}

	.summary {
		display: grid;
		gap: 0.6rem;
		margin-top: 1.25rem;
	}

	.total {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
		font-size: 1.1rem;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		min-height: 2.4rem;
		padding: 0.3rem 0.65rem;
		border: 1px solid var(--st-edge);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}

	.chip[aria-pressed='true'] {
		border-color: var(--st-focus);
		box-shadow: inset 0 0 0 1px var(--st-focus);
		background: color-mix(in srgb, var(--st-focus) 10%, transparent);
		font-weight: 600;
	}

	.num {
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}

	.dot {
		opacity: 0.5;
		margin-inline: 0.15rem;
	}

	.swatch {
		display: inline-block;
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 0.2rem;
		border: 1px solid var(--st-edge);
	}

	.swatch.st-unknown {
		background: var(--st-unknown-bg);
		border-style: dashed;
		border-color: var(--st-unknown-edge);
	}

	.swatch.st-fresh {
		background: var(--st-fresh-bar);
	}

	.swatch.st-learning {
		background: var(--st-learning-bar);
	}

	.swatch.st-mature {
		background: var(--st-mature-bar);
	}

	.swatch.st-learned {
		background: var(--st-learned-bar);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.75rem 1rem;
		margin-top: 1.25rem;
	}

	.field {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
		min-width: 0;
	}

	.field.grow {
		flex: 1 1 14rem;
	}

	.jump .row {
		display: flex;
		gap: 0.35rem;
	}

	.jump input {
		width: 4.5rem;
	}

	.field select,
	.field input {
		font: inherit;
		font-weight: 400;
		min-height: 2.4rem;
		box-sizing: border-box;
		padding: 0.35rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		max-width: 100%;
	}

	.btn {
		font: inherit;
		font-weight: 600;
		min-height: 2.4rem;
		padding: 0.35rem 0.9rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.btn.quiet {
		font-weight: 500;
	}

	.bar-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}

	.bar-row p {
		margin: 0;
	}

	.block {
		border-top: 1px solid var(--st-edge);
		/* No content-visibility here: with every section open it lays the
		   whole 10k-cell block out in one frame the first time it scrolls
		   into view (a 1 s freeze); plain layout costs a little more up
		   front but scrolls smoothly. Measured in the Task 4 fix round. */
	}

	.block-head {
		margin: 0;
		font-size: 1rem;
	}

	.block-head button {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.75rem;
		width: 100%;
		min-height: 2.8rem;
		padding: 0.45rem 0.2rem;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.block-head button:hover .label {
		text-decoration: underline;
	}

	.block-head button:focus-visible {
		outline: 3px solid var(--st-focus);
		outline-offset: -3px;
	}

	.chev {
		width: 0.5rem;
		height: 0.5rem;
		border: solid currentColor;
		border-width: 0 2px 2px 0;
		transform: rotate(-45deg);
		margin-right: 0.15rem;
		transition: transform 0.12s;
	}

	@media (prefers-reduced-motion: reduce) {
		.chev {
			transition: none;
		}
	}

	.open .chev {
		transform: rotate(45deg);
	}

	.label {
		font-weight: 650;
		flex: 1 1 auto;
	}

	.count {
		font-variant-numeric: tabular-nums;
		font-weight: 400;
	}

	.count small {
		font-size: 0.8rem;
		opacity: 0.75;
	}

	.shown {
		font-weight: 400;
		font-size: 0.85rem;
		opacity: 0.75;
	}

	.banner {
		margin: 1rem 0 0;
		padding: 0.6rem 0.8rem;
		border: 1px solid #e2c36b;
		border-radius: 0.4rem;
		background: #fff6d8;
	}

	.hint {
		opacity: 0.75;
	}

	.small {
		font-size: 0.85rem;
	}

	.attribution {
		margin: 0.4rem 0 0;
		max-width: 100%;
		overflow-wrap: anywhere;
		line-height: 1.4;
	}

	.attribution a {
		color: inherit;
		text-decoration: underline;
	}

	.foot {
		margin-top: 1.5rem;
	}

	.error-box {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.error {
		margin: 0;
		color: #c62828;
		font-weight: 600;
	}

	/* After the base rules of .banner and .error: same specificity, so the
	   later rule wins. */
	@media (prefers-color-scheme: dark) {
		.error {
			color: #ff8a80;
		}

		.banner {
			background: #3d3212;
			border-color: #8a6d1e;
		}
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.skeleton {
		display: grid;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.sk-line,
	.sk-block {
		display: block;
		border-radius: 0.4rem;
		background: color-mix(in srgb, currentColor 8%, transparent);
		animation: pulse 1.2s ease-in-out infinite alternate;
	}

	.sk-line {
		height: 1rem;
		width: 40%;
	}

	.sk-line.wide {
		width: 70%;
	}

	.sk-block {
		height: 3rem;
	}

	@keyframes pulse {
		from {
			opacity: 0.5;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sk-line,
		.sk-block {
			animation: none;
		}
	}
</style>
