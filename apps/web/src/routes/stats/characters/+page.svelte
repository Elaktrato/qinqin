<script lang="ts">
	import { isImeKey } from '$lib/ui/ime';
	import { profileOf } from '$lib/languages/profiles';
	import { hasCharacterMap } from '$lib/languages/profiles';
	import { errorText } from '$lib/api/apiErrors';
	import { studyLang } from '$lib/i18n/lang';
	import { tick, untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import Msg from '$lib/ui/Msg.svelte';
	import { fetchCharacters, type CharacterList } from '$lib/api/characters';
	import { fetchSchemeCharacters, getSchemes } from '$lib/api/schemes';
	import { levelAttributionLine } from '$lib/studycore/levelAttribution';
	import type { Scheme } from '$lib/api/types';
	import CellTip from '$lib/stats/map/CellTip.svelte';
	import CharGrid from '$lib/stats/map/CharGrid.svelte';
	import StageBar from '$lib/stats/map/StageBar.svelte';
	import {
		cellStates,
		filterCells,
		masteryGlyphs,
		sectionStats,
		variantFormCount,
		type CellState,
		type GroupKey,
		type SchemeLevelMembers,
		type Stage,
		type StageFilter
	} from '$lib/studycore/charGroups';
	import { LEVEL_ALL } from '$lib/studycore/charLevels';
	import {
		gradingOptions,
		gradingPatch,
		includeOutsidePatch,
		packOf,
		readMasteryMap,
		resolveGrading,
		studyLevelsPatch,
		type MasteryMapSettings
	} from '$lib/stats/mapGrading';
	import { focusOptions, mapChars, readFocus, studyLevels, withOutsideLabel, writeFocus } from '$lib/stats/mapView';
	import { fillMissingWrittenProgressively } from '$lib/studycore/entriesCache';
	import {
		STAGE_INFO,
		defaultOpenSections,
		filterAnnouncement,
		formatCount,
		jumpGlyph,
		learnedSummary,
		locateGlyph,
		sectionsFor,
		type TipRequest
	} from '$lib/studycore/mapGrid';
	import { contextForData, currentContext } from '$lib/studycore/currentContext';
	import type { StudyContext } from '$lib/studycore/studyContext';
	import { MASTERY_THRESHOLD, masteryForChars } from '$lib/studycore/mastery';
	import { DEFAULT_W } from '$lib/studycore/fsrsParams';
	import { loadStudyData } from '$lib/studycore/data';
	import { activeWeights } from '$lib/studycore/readModel';
	import type { ReviewEvent, StudyCard } from '$lib/studycore/types';
	import Button from '$lib/ui/Button.svelte';
	import Field from '$lib/ui/Field.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { useSession } from '$lib/context/context';
	const session = useSession();
	const TIP_ID = 'map-cell-tip';
	const SEARCH_DELAY_MS = 200;

	const FILTERS: { value: StageFilter; label: string; stages: Stage[] }[] = [
		{ value: 'all', label: t('stats.map.filter.all'), stages: [] },
		{ value: 'not-started', label: t('stats.map.filter.notStarted'), stages: ['unknown'] },
		{ value: 'learning', label: t('stats.map.filter.learning'), stages: ['fresh', 'learning', 'mature'] },
		{ value: 'learned', label: t('stats.map.filter.learned'), stages: ['learned'] }
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
	let ctx = $state.raw<StudyContext>(currentContext(session.zone));
	// Cards whose legacy written snapshot could not be resolved on this
	// visit. Reported so the map never silently under-reports.
	let unresolvedCards = $state(0);

	// The grading (#163): the workspace's `masteryMap` setting (synced), shown at once while a save is in flight
	// (`optimistic`); a failed save puts the stored one back and says so.
	let optimistic = $state.raw<MasteryMapSettings | null>(null);
	let mapError = $state('');
	let saveSeq = 0;
	// The Level focus within the study set (this device only), read once the set is known.
	let focusChoice = $state<string>(LEVEL_ALL);
	let focusRead = false;
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

	let requestSeq = 0;
	let membersSeq = 0;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let announceTimer: ReturnType<typeof setTimeout> | undefined;


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
		const result = await fillMissingWrittenProgressively(session.caches.written, initial, (nextCards) => {
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
			schemesError = errorText(err, t('stats.map.schemesFailed'));
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
		members = null;
		membersLoading = false;
		membersError = '';
		optimistic = null;
		mapError = '';
		saveSeq += 1;
		focusChoice = LEVEL_ALL;
		focusRead = false;
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
				fetchCharacters(session.caches.characters, lang),
				loadSchemeList(),
				loadStudyData(session.study, id)
			]);
			if (seq !== requestSeq) return;
			universe = list;
			schemes = schemeList;
			cards = data.cards;
			reviews = data.reviews;
			weights = activeWeights(data);
			ctx = contextForData(session.zone, data, id);
			void backfillWritten(data.cards, seq);
		} catch (err) {
			if (seq !== requestSeq) return;
			loadError = errorText(err, t('stats.map.loadFailed'));
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
		session.workspaces.current !== null && !hasCharacterMap(session.workspaces.current.language)
	);

	// A workspace or language change loads the map again; a settings write (a new grading) does not.
	const workspaceKey = $derived(session.workspaces.current?.id ?? null);
	const workspaceLanguage = $derived(session.workspaces.current?.language ?? '');
	$effect(() => {
		const id = workspaceKey;
		const lang = workspaceLanguage;
		if (id !== null && !hasCharacterMap(lang)) {
			// Drop any in-flight load for a previous workspace.
			requestSeq++;
			loading = false;
			return;
		}
		void untrack(() => load(id, lang));
	});

	const chars = $derived(universe?.chars ?? []);
	const mapSettings = $derived(optimistic ?? readMasteryMap(session.workspaces.current?.settings));
	const gradings = $derived(gradingOptions(language, schemes));
	// The grading the map goes by: the stored one, else HSK / JLPT, else today's grouping (mapGrading.ts).
	const grading = $derived(universe === null ? null : resolveGrading(language, schemes, mapSettings));
	const gradingOption = $derived(gradings.find((option) => option.value === grading) ?? null);
	const groupKey = $derived<GroupKey | null>(gradingOption?.groupKey ?? null);
	const scheme = $derived(gradingOption?.scheme ?? null);
	const schemeId = $derived(scheme?.id ?? null);
	const schemeMembers = $derived(schemeId !== null && members?.schemeId === schemeId ? members.levels : null);
	// The pack's levels and its study set, once its characters are loaded.
	const levels = $derived(scheme !== null && schemeMembers !== null ? studyLevels(scheme, schemeMembers, mapSettings) : null);
	const setLevelIds = $derived(new Set(levels?.set.map((level) => level.levelId) ?? []));
	const focusItems = $derived(
		scheme !== null && levels !== null ? focusOptions(scheme.id, levels.set, mapSettings.includeOutside, gradingOption?.label ?? '') : []
	);
	// A focus that left the study set (or the Outside group) is "all study levels"; the choice itself stays.
	const focus = $derived(focusItems.some((item) => item.value === focusChoice) ? focusChoice : LEVEL_ALL);

	$effect(() => {
		const items = focusItems;
		if (focusRead || items.length === 0 || workspaceId === null) return;
		focusRead = true;
		focusChoice = untrack(() => readFocus(storage(), workspaceId!, items));
	});

	// The study set first, then the focus; a built-in grouping shows every character. While the pack's characters
	// load, the map is empty rather than every character.
	const filteredChars = $derived.by(() => {
		if (groupKey === null) return [];
		if (scheme === null) return chars;
		if (schemeMembers === null) return [];
		return mapChars(chars, schemeMembers, setLevelIds, mapSettings.includeOutside, focus);
	});

	// One mastery pass over every glyph and variant; a cell takes the best
	// of its forms (a card written 愛 lights 爱).
	const cellByRow = $derived.by(() => {
		const mastery = masteryForChars(masteryGlyphs(filteredChars), cards, reviews, new Date(), weights, ctx.clock);
		const map = new Map<(typeof filteredChars)[number], CellState>();
		for (const cell of cellStates(filteredChars, mastery)) map.set(cell.char, cell);
		return map;
	});

	const totals = $derived(sectionStats([...cellByRow.values()]));

	// The credit line of the level scheme the map shows, if any.
	const attributionLine = $derived(levelAttributionLine(scheme));

	async function loadMembers(id: number): Promise<void> {
		const seq = ++membersSeq;
		membersLoading = true;
		membersError = '';
		try {
			// One request for every level: the server sends each level's
			// characters as one string, lowest level first.
			const levels = await fetchSchemeCharacters(session.caches.schemes, id);
			if (seq !== membersSeq) return;
			members = { schemeId: id, levels };
		} catch (err) {
			if (seq !== membersSeq) return;
			membersError = errorText(err, t('stats.map.membersFailed'));
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

	// Null while a pack grading's levels are loading.
	const grouping = $derived.by(() => {
		if (groupKey === null) return null;
		if (schemeMembers !== null) {
			const built = sectionsFor(filteredChars, groupKey, schemeMembers);
			return { ...built, sections: withOutsideLabel(built.sections, gradingOption?.label ?? '') };
		}
		if (schemeId !== null) return null;
		return sectionsFor(filteredChars, groupKey);
	});

	const filtering = $derived(stageFilter !== 'all' || query.trim() !== '' || focus !== LEVEL_ALL);

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
			(stop ?? document.getElementById('map-search'))?.focus({ preventScroll: stop === null });
		});
	});

	// Announce what a filter left, once typing settles.
	$effect(() => {
		void stageFilter;
		void query;
		void focus;
		void grouping;
		clearTimeout(announceTimer);
		// Do not announce "No characters match." while the levels are still
		// loading; the effect runs again when they arrive.
		if (untrack(() => grouping === null)) return;
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

	/** saveMap shows a change at once and saves it as one merge patch; a failed save puts the stored map back. */
	async function saveMap(next: MasteryMapSettings, patch: Record<string, unknown>): Promise<void> {
		if (workspaceId === null) return;
		const seq = ++saveSeq;
		optimistic = next;
		mapError = '';
		try {
			await session.workspaces.setSettings(workspaceId, patch);
		} catch (err) {
			if (seq === saveSeq) mapError = errorText(err, t('stats.map.saveFailed'));
		} finally {
			if (seq === saveSeq) optimistic = null;
		}
	}

	function chooseGrading(value: string): void {
		// A failed scheme load belongs to that scheme only; a late answer
		// for it must not land on the new grading either.
		membersSeq += 1;
		membersError = '';
		membersLoading = false;
		void saveMap({ ...mapSettings, grading: value }, gradingPatch(value));
	}

	function chooseOutside(on: boolean): void {
		void saveMap({ ...mapSettings, includeOutside: on }, includeOutsidePatch(on));
	}

	/** toggleLevel switches one level of the study set; the last one stays (its box is disabled). */
	function toggleLevel(ord: number, on: boolean): void {
		const pack = packOf(grading);
		if (pack === null || levels === null) return;
		const all = levels.all.map((level) => level.ord);
		const kept = levels.set.map((level) => level.ord).filter((other) => other !== ord);
		const next = on ? [...kept, ord] : kept;
		if (next.length === 0) return;
		const nextLevels = { ...mapSettings.levels };
		if (all.every((other) => next.includes(other))) delete nextLevels[pack];
		else nextLevels[pack] = all.filter((other) => next.includes(other));
		void saveMap({ ...mapSettings, levels: nextLevels }, studyLevelsPatch(pack, next, all));
	}

	function chooseFocus(value: string): void {
		focusChoice = value;
		if (workspaceId !== null) writeFocus(storage(), workspaceId, value);
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
			announcement = t('stats.map.jumpMissing', { glyph });
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
		announcement = t('stats.map.jumpFound', { glyph: el.textContent ?? glyph, section: label });
	}

	/** headerName is a section button's name: "Grade 2, 0 of 160 learned". */
	function headerName(
		view: { label: string; stats: { learned: number; total: number }; shown: unknown[]; variants: number },
		filtered: boolean
	): string {
		const args = { section: view.label, learned: formatCount(view.stats.learned), total: formatCount(view.stats.total) };
		const base =
			view.variants > 0
				? t('stats.map.headerVariants', { ...args, variants: formatCount(view.variants) })
				: t('stats.map.header', args);
		return filtered ? t('stats.map.headerShown', { name: base, shown: formatCount(view.shown.length) }) : base;
	}

	const langTag = $derived(studyLang(language) ?? '');
</script>

<!-- The Characters view of Stats: the Stats layout gives the page
     heading and the tablist, so this view's headings start at h2. -->
<div class="map" onfocusin={trackFocus}>
	<header class="head">
		<h2>{t('stats.map.title')}</h2>
		{#if !notHan}
			<p class="hint">{t('stats.map.intro')}</p>
		{/if}
	</header>

	{#if notHan}
		<p class="hint" role="status">
			{t('stats.map.notHan')}
			<a href="/stats">{t('stats.map.seeOverview')}</a>
		</p>
	{:else if noWorkspace}
		<p class="hint" role="status">{t('stats.map.noWorkspace')}</p>
	{:else if loadError}
		<div class="error-box" role="alert">
			<p class="error">{loadError}</p>
			<Button variant="secondary" type="button" onclick={retry}>{t('stats.map.retry')}</Button>
		</div>
	{:else if loading || universe === null}
		<div class="skeleton" role="status" aria-label={t('stats.map.loading')}>
			<span class="sk-line wide"></span>
			<span class="sk-line"></span>
			{#each [0, 1, 2] as n (n)}
				<span class="sk-block"></span>
			{/each}
		</div>
	{:else if universe.count === 0}
		<p class="banner" role="status">
			<Msg key="stats.map.noneInstalled">{#snippet code(text: string)}<code>{text}</code>{/snippet}</Msg>
		</p>
	{:else}
		{#if grouping !== null}
		<section class="summary" aria-label={t('stats.map.summary')}>
			<p class="total">
				<strong>{learnedSummary(totals.learned, totals.total)}</strong>
				<span class="hint small">{t('widgets.characters.learnedRule', { threshold: MASTERY_THRESHOLD })}</span>
			</p>
			<StageBar byStage={totals.byStage} size="large" />
			<ul class="stage-legend" aria-label={t('stats.map.legend')}>
				{#each STAGE_INFO as item (item.stage)}
					<li>
						<span class="swatch st-{item.stage}" aria-hidden="true"></span>
						{item.label}
					</li>
				{/each}
			</ul>
			<div class="filters" role="group" aria-label={t('stats.map.showStage')}>
				{#each FILTERS as item (item.value)}
					<button
						type="button"
						class="filter"
						aria-pressed={stageFilter === item.value}
						onclick={() => (stageFilter = item.value)}
					>
						{item.label}
						<span class="num">{formatCount(filterCounts[item.value])}</span>
					</button>
				{/each}
			</div>
		</section>
		{/if}

		{#if levelHint}
			<p class="banner" role="status">
				<Msg key="stats.map.stale">{#snippet code(text: string)}<code>{text}</code>{/snippet}</Msg>
			</p>
		{/if}

		{#if unresolvedCards > 0}
			<p class="hint note" role="status">
				{t('stats.map.unresolved', { count: unresolvedCards })}
			</p>
		{/if}

		<section class="controls" aria-label={t('stats.map.controls')}>
			<div class="control">
				<Select
					label={t('stats.map.grading')}
					value={grading ?? ''}
					options={gradings.map((option) => ({ value: option.value, label: option.label }))}
					hint={t('stats.map.grading.hint')}
					onchange={(event) => chooseGrading(event.currentTarget.value)}
				/>
			</div>
			{#if focusItems.length > 0}
				<div class="control level">
					<Select
						label={t('stats.map.level')}
						value={focus}
						options={focusItems}
						hint={t('stats.map.level.hint')}
						onchange={(event) => chooseFocus(event.currentTarget.value)}
					/>
				</div>
			{/if}
			<div class="control grow">
				<Field
					label={t('stats.map.search')}
					type="search"
					id="map-search"
					placeholder={t('stats.map.searchPlaceholder')}
					bind:value={queryInput}
					oninput={onSearchInput}
					onkeydown={(event) => event.key === 'Escape' && !isImeKey(event) && clearSearch()}
				/>
			</div>
			<form class="jump" onsubmit={jump}>
				<Field
					label={t('stats.map.jump')}
					id="map-jump"
					maxlength={8}
					autocomplete="off"
					bind:value={jumpInput}
				/>
				<Button variant="secondary" type="submit">{t('stats.map.go')}</Button>
			</form>
		</section>
		{#if scheme !== null && levels !== null}
			<div class="study-set">
				<fieldset class="study-levels">
					<legend>{t('stats.map.studyLevels')}</legend>
					{#each levels.all as level (level.levelId)}
						{@const on = setLevelIds.has(level.levelId)}
						<label class="inline">
							<input
								type="checkbox"
								checked={on}
								disabled={on && levels.set.length === 1}
								onchange={(event) => toggleLevel(level.ord, event.currentTarget.checked)}
							/>
							{level.name}
						</label>
					{/each}
				</fieldset>
				<label class="inline outside">
					<input
						type="checkbox"
						checked={mapSettings.includeOutside}
						onchange={(event) => chooseOutside(event.currentTarget.checked)}
					/>
					{t('stats.map.includeOutside', { grading: gradingOption?.label ?? '' })}
				</label>
			</div>
		{/if}
		{#if mapError}
			<p class="error" role="alert">{mapError}</p>
		{/if}
		{#if attributionLine}
			<p class="hint small attribution">
				{attributionLine} · <a href="/sources">{t('stats.map.sources')}</a>
			</p>
		{/if}
		{#if schemesError}
			<p class="hint small">{schemesError}</p>
		{/if}

		<p class="sr" role="status" aria-live="polite">{announcement}</p>

		{#if membersError && schemeId !== null}
			<div class="error-box" role="alert">
				<p class="error">{membersError}</p>
				<Button
					variant="secondary"
					type="button"
					onclick={() => schemeId !== null && loadMembers(schemeId)}>{t('stats.map.retry')}</Button
				>
			</div>
		{:else if grouping === null}
			<p class="hint" role="status">{membersLoading ? t('stats.map.loadingLevels') : ''}</p>
		{:else}
			<div class="bar-row">
				<p class="hint small">
					{#if filtering}
						{t('stats.map.shownOf', { shown: formatCount(shownTotal), total: formatCount(totals.total) })}
					{:else}
						{t('stats.map.sections', { count: visibleViews.length })}
					{/if}
				</p>
				{#if visibleViews.length > 1}
					<Button variant="plain" type="button" onclick={toggleAll}>
						{allOpen ? t('stats.map.collapseAll') : t('stats.map.expandAll')}
					</Button>
				{/if}
			</div>

			{#if focus !== LEVEL_ALL && filteredChars.length === 0}
				<p class="hint">{t('stats.map.level.empty')}</p>
			{:else if filtering && shownTotal === 0}
				<p class="hint">{t('stats.map.noMatch')}</p>
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
							<Icon name={open ? 'expand-down' : 'forward'} size="s" />
							<span class="label">{view.label}</span>
							<span
								class="count"
								aria-hidden="true"
								title={view.variants > 0
									? t('stats.map.variantsTitle', {
											total: formatCount(view.stats.total),
											variants: formatCount(view.variants)
										})
									: undefined}
							>{learnedSummary(view.stats.learned, view.stats.total)}{#if view.variants > 0}
									<small>{t('stats.map.variantsSmall', { variants: formatCount(view.variants) })}</small>{/if}</span
							>
							{#if filtering}
								<span class="shown" aria-hidden="true">{t('stats.map.shown', { shown: formatCount(view.shown.length) })}</span>
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

			{#if profileOf(language).variants}
				<p class="hint small foot">
					{t('stats.map.zhFoot')}
				</p>
			{/if}
		{/if}
	{/if}

	<CellTip {tip} id={TIP_ID} lang={langTag} />
</div>

<style>
	.head h2 {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-l);
		font-weight: var(--weight-strong);
	}

	.head .hint {
		margin: 0;
	}

	.summary {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}

	.total {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		font-size: var(--font-size-m);
	}

	/* The worded legend: five stage names with decorative swatches. */
	.stage-legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.stage-legend li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
	}

	/* A text toggle: no pill, a 2px accent underline when pressed. */
	.filter {
		padding: var(--space-1) 0;
		border: 0;
		background: none;
		color: var(--readable-muted);
		font: inherit;
		font-size: var(--font-size-s);
		cursor: pointer;
		box-shadow: inset 0 -2px 0 transparent;
	}

	.filter[aria-pressed='true'] {
		color: var(--text);
		font-weight: var(--weight-strong);
		box-shadow: inset 0 -2px 0 var(--accent);
	}

	.filter:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
		border-radius: 2px;
	}

	.num {
		font-variant-numeric: tabular-nums;
		color: var(--readable-muted);
	}

	.swatch {
		display: inline-block;
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 2px;
		border: 1px solid var(--line);
	}

	.swatch.st-unknown {
		background: transparent;
		border-style: dashed;
		border-color: var(--muted);
	}

	.swatch.st-fresh {
		background: var(--mastery-1);
	}

	.swatch.st-learning {
		background: var(--mastery-2);
	}

	.swatch.st-mature {
		background: var(--mastery-3);
	}

	.swatch.st-learned {
		background: var(--mastery-4);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-3) var(--space-4);
		margin-top: var(--space-5);
	}

	.control {
		min-width: 0;
	}

	/* The study set: the pack's levels as a wrapping row of checkboxes, then the outside switch. */
	.study-set {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.study-levels {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.study-levels legend {
		width: 100%;
		margin-bottom: var(--space-1);
		padding: 0;
		font-weight: var(--weight-strong);
	}

	.control.grow {
		flex: 1 1 14rem;
	}

	.jump {
		display: flex;
		align-items: end;
		gap: var(--space-2);
	}

	.jump :global(input) {
		width: 4.5rem;
	}

	.bar-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}

	.bar-row p {
		margin: 0;
	}

	/* A hairline between groups; no box. */
	.block {
		border-top: 1px solid var(--hair);
		/* No content-visibility here: with every section open it lays the
		   whole 10k-cell block out in one frame the first time it scrolls
		   into view (a 1 s freeze); plain layout costs a little more up
		   front but scrolls smoothly. Measured in the Task 4 fix round. */
	}

	.block-head {
		margin: 0;
		font-size: var(--font-size-m);
	}

	.block-head button {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		width: 100%;
		min-height: 2.8rem;
		padding: var(--space-2) var(--space-1);
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
		outline: var(--focus-ring);
		outline-offset: calc(-1 * var(--focus-ring-offset));
	}

	.label {
		font-weight: var(--weight-strong);
		flex: 1 1 auto;
	}

	.count {
		font-variant-numeric: tabular-nums;
		font-weight: var(--weight-regular);
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.shown {
		font-weight: var(--weight-regular);
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.banner {
		margin: var(--space-4) 0 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--warn);
		border-inline-start-width: 3px;
		border-radius: var(--radius);
	}

	.hint {
		color: var(--readable-muted);
	}

	.small {
		font-size: var(--font-size-s);
	}

	.attribution {
		margin: var(--space-1) 0 0;
		max-width: 100%;
		overflow-wrap: anywhere;
		line-height: var(--line-body);
	}

	.attribution a {
		color: inherit;
		text-decoration: underline;
	}

	.foot {
		margin-top: var(--space-6);
	}

	.error-box {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		font-weight: var(--weight-strong);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
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
		gap: var(--space-3);
		margin-top: var(--space-5);
	}

	.sk-line,
	.sk-block {
		display: block;
		border-radius: var(--radius);
		background: var(--raised);
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
