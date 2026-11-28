<script lang="ts">
	// /study/advanced (the study modal design, 4.3): every control of the
	// saved study setup, the study page moved. Changes are saved as they are
	// made (session.setups); Start lives in the study modal, deck management on
	// the decks page. "Back to study" returns where the learner came from
	// (?from=) and opens the modal there.
	import { goto } from '$app/navigation';
	import { errorText } from '$lib/api/apiErrors';
	import { fetchCharacters } from '$lib/api/characters';
	import { getFrequencyPacks } from '$lib/api/frequency';
	import { fetchSchemeCharacters } from '$lib/api/schemes';
	import type { CharRow, FrequencyPack, Level } from '$lib/api/types';
	import { useApp, useSession } from '$lib/context/context';
	import { STATS_ID, featureKnownOff } from '$lib/features';
	import CardManager from '$lib/features/flashcards/decks/CardManager.svelte';
	import DeckCardTypes from '$lib/features/flashcards/decks/DeckCardTypes.svelte';
	import { createSetupData } from '$lib/features/flashcards/setup/setupData.svelte';
	import { hiddenTypesText, noteText } from '$lib/features/flashcards/setup/studyModalView';
	import UnreadableRowsNotice from '$lib/features/flashcards/UnreadableRowsNotice.svelte';
	import { t } from '$lib/i18n';
	import { usesHan } from '$lib/languages';
	import { profileOf } from '$lib/languages/profiles';
	import { pageTitle } from '$lib/routing/pageTitle';
	import { safeFrom } from '$lib/routing/here';
	import { vacationBanner, vacationStatus } from '$lib/settings/vacationForm';
	import type { SchemeLevelMembers } from '$lib/studycore/charGroups';
	import { saveDeckCardTypesForDecks } from '$lib/features/flashcards/commands/decks';
	import { onContextStale } from '$lib/studycore/currentContext';
	import { onStudyChange, touches } from '$lib/studycore/data';
	import { cleanCardTypes, enabledKinds, type DeckSettings } from '$lib/studycore/deckSettings';
	import { levelMastery } from '$lib/studycore/levelMastery';
	import { startTodayText } from '$lib/features/flashcards/session/limitsText';
	import { resolveSessionOrder } from '$lib/studycore/newOrder';
	import { decodeOrder, encodeOrder, mixedNote, sessionOrderChoices } from '$lib/features/flashcards/session/newOrderView';
	import { cardsInDecks } from '$lib/studycore/readModel';
	import { CARD_TYPES, type StudySessionMode } from '$lib/features/flashcards/session/session';
	import { repairSetup, setupDeckIds, setupKinds } from '$lib/features/flashcards/setup/setup';
	import { planSetup } from '$lib/features/flashcards/setup/setupPlan';
	import type { SetupPatch } from '$lib/features/flashcards/setup/setupStore.svelte';
	import { deckOrdersOf } from '$lib/features/flashcards/session/sessionOrder';
	import { parseTypeOrder, typeOrderChoices } from '$lib/features/flashcards/session/typeOrderView';
	import { CARD_KINDS, GENERAL_DECK_ID, OPT_IN_KINDS, type OptInKind, type StudyCardKind } from '$lib/studycore/types';
	import { Button, Field, Section, Select } from '$lib/ui';

	const session = useSession();
	const data = createSetupData(session, { fresh: true });

	const MAX_LIMIT = 999;
	// One line per card type, shown next to its checkbox.
	const TYPE_INFO: Record<StudyCardKind, string> = {
		vocab: t('study.setup.info.vocab'),
		sentence: t('study.setup.info.sentence'),
		writing: t('study.setup.info.writing'),
		tone: t('study.setup.info.tone'),
		reverse: t('study.setup.info.reverse'),
		cloze: t('study.setup.info.cloze')
	};

	// Where "Back to study" returns (?from=, an app path only).
	const from = safeFrom(typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('from'));

	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	const language = $derived(session.workspaces.current?.language ?? '');

	// Refetch when the active workspace changes; the header switcher makes that possible without leaving the page.
	$effect(() => {
		const ws = workspaceId;
		void data.load(ws, session.workspaces.current?.language ?? null);
		if (ws !== null) void session.setups.refresh(ws);
	});
	// A new learner day (or zone) changes what is due and on vacation.
	$effect(() => onContextStale(session.zone, () => void data.refresh()));
	// A change of the workspace's study rows (a write on this page, or a row another
	// device wrote in the second of the load, #193) reloads the counts.
	$effect(() =>
		onStudyChange(session.study, (changed) => {
			if (touches(changed, data.workspaceId)) void data.refresh();
		})
	);

	let frequencyPacks = $state.raw<FrequencyPack[]>([]);
	$effect(() => {
		getFrequencyPacks()
			.then((list) => (frequencyPacks = Array.isArray(list) ? list : []))
			.catch(() => (frequencyPacks = []));
	});

	const ready = $derived(data.status === 'ready' && data.workspaceId === workspaceId);
	const entry = $derived(workspaceId === null ? null : session.setups.of(workspaceId));
	const repaired = $derived(
		entry === null
			? null
			: repairSetup(entry.setup, {
					deckIds: ready ? data.decks.map((deck) => deck.id) : null,
					schemes: data.knownSchemes,
					language
				})
	);
	const setup = $derived(repaired?.setup ?? null);
	const note = $derived(repaired === null ? null : noteText(repaired.notes));

	// Optimistic per-deck switches after the global Reverse/Cloze click, until the data reloads.
	let pendingSettings = $state.raw<Record<string, DeckSettings> | null>(null);
	$effect(() => {
		void data.deckSettings;
		pendingSettings = null;
	});
	const deckSettings = $derived(pendingSettings ?? data.deckSettings);

	const allDecks = $derived([
		{ id: GENERAL_DECK_ID, name: t('flashcards.deck.general'), createdAt: '' },
		...[...data.decks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
	]);
	const deckIds = $derived(setup === null ? [] : setupDeckIds(setup, data.decks));
	const enabled = $derived(enabledKinds(deckSettings, deckIds));
	const kinds = $derived<StudyCardKind[]>(setup === null ? [] : setupKinds(setup, enabled, language));
	const scheme = $derived(setup === null ? null : (data.schemes.find((s) => s.id === setup.schemeId) ?? null));
	const schemeLevels = $derived.by((): Level[] => (scheme === null ? [] : [...scheme.levels].sort((a, b) => a.ord - b.ord)));

	$effect(() => {
		const level = setup?.mode === 'levels' && scheme !== null && scheme.levels.some((l) => l.name === setup.levelName) ? setup.levelName : null;
		if (level === null || scheme === null) data.clearLevel();
		else void data.loadLevel(scheme.id, level);
	});

	// The scheme's characters per level (for "L of N learned"); optional decoration.
	let schemeCharacters = $state.raw<SchemeLevelMembers[]>([]);
	let universeRows = $state.raw<CharRow[]>([]);
	let charactersSeq = 0;
	$effect(() => {
		const shown = setup?.mode === 'levels' ? scheme : null;
		const seq = ++charactersSeq;
		if (shown === null) {
			schemeCharacters = [];
			return;
		}
		Promise.all([fetchSchemeCharacters(session.caches.schemes, shown.id), fetchCharacters(session.caches.characters, shown.language)]).then(
			([levels, list]) => {
				if (seq !== charactersSeq) return;
				schemeCharacters = levels;
				universeRows = list.chars;
			},
			() => {
				if (seq !== charactersSeq) return;
				schemeCharacters = [];
				universeRows = [];
			}
		);
	});
	const levelLearned = $derived(levelMastery(schemeCharacters, universeRows, data.cards, data.reviews, new Date(), data.weights, data.ctx.clock));
	function levelOptionLabel(name: string): string {
		const count = levelLearned.get(name);
		return count === undefined || count.total === 0
			? name
			: t('study.setup.levelOption', { level: name, learned: count.learned, total: count.total });
	}

	const plan = $derived(
		setup === null
			? null
			: planSetup(
					{
						status: workspaceId === null ? 'no-workspace' : ready ? 'ready' : 'loading',
						mode: setup.mode,
						deckIds,
						kinds,
						newLimit: setup.newLimit,
						reviewLimit: setup.reviewLimit,
						cards: data.cards,
						reviews: data.reviews,
						deckSettings,
						weights: data.weights,
						ctx: data.ctx,
						language,
						// The words the server says cannot make a card of a kind (#288).
						skip: session.eligibility.skip(),
						// The Reverse and Cloze switches here turn a kind on for every deck.
						optIns: 'any',
						level: {
							scheme,
							levelName: setup.levelName,
							schemesLoaded: data.schemesLoaded,
							schemeError: data.schemeError,
							schemeCount: data.schemes.length,
							entries: data.levelEntries,
							loading: data.levelLoading,
							error: data.levelError
						}
					},
					new Date()
				)
	);

	const selectedCards = $derived(cardsInDecks(data.cards, deckIds));
	const levelNoun = $derived(
		plan === null
			? ''
			: plan.levelUnit === 'character'
				? t('study.setup.unit.characters', { count: plan.levelEntryTotal })
				: t('study.setup.unit.words', { count: plan.levelEntryTotal })
	);
	const vacationText = $derived(
		workspaceId === null || !ready || !data.ctx.vacationToday
			? null
			: vacationBanner(vacationStatus(data.vacations, workspaceId, data.ctx.day.today()), data.ctx.day.today())
	);

	// The card types: the language's, opt-in ones only for deck sessions; once the
	// counts are known only those with something to study (#289).
	const available = $derived(plan !== null && ready ? plan.available : null);
	const visibleTypes = $derived(
		CARD_TYPES.filter(
			(type) =>
				profileOf(language).cardKinds.includes(type.id) &&
				(setup?.mode !== 'levels' || !isOptIn(type.id)) &&
				(available === null || available.includes(type.id))
		)
	);
	function isOptIn(kind: string): kind is OptInKind {
		return (OPT_IN_KINDS as readonly string[]).includes(kind);
	}
	const shownKinds = $derived(
		kinds.filter((kind) => (setup?.mode !== 'levels' || !isOptIn(kind)) && visibleTypes.some((type) => type.id === kind))
	);
	const app = useApp();
	const hiddenLines = $derived(plan !== null && ready ? hiddenTypesText(plan.hidden, { admin: app.auth.user?.admin === true }) : []);

	const orderView = $derived(
		sessionOrderChoices({
			mode: setup?.mode ?? 'decks',
			language,
			packs: frequencyPacks,
			schemes: data.schemes,
			levelScheme: scheme
		})
	);
	const orderValue = $derived.by(() => {
		const value = setup === null ? 'random' : encodeOrder(setup.newOrder);
		return orderView.choices.some((choice) => choice.value === value) ? value : 'random';
	});
	const ordersMixed = $derived(
		setup?.mode === 'decks' && orderValue === 'deck' && resolveSessionOrder('deck', deckOrdersOf(deckIds, data.decks, deckSettings)).mixed
	);

	let limitError = $state('');
	let typeSaving = $state<string | null>(null);
	let typeError = $state('');
	let advancedOpen = $state(false);

	/** save writes `change` for the workspace shown now (captured at the call). */
	function save(change: SetupPatch): void {
		const ws = workspaceId;
		if (ws === null || setup === null) return;
		// Only the changed members: the store writes them over the row read again (another device's stay).
		void session.setups.update(ws, change);
	}

	function saveLimit(which: 'newLimit' | 'reviewLimit', raw: string): void {
		const value = Number(raw);
		if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
			limitError = which === 'newLimit' ? t('study.config.newLimit', { max: MAX_LIMIT }) : t('study.config.reviewLimit', { max: MAX_LIMIT });
			return;
		}
		limitError = '';
		save({ [which]: value });
	}

	function selectMode(next: StudySessionMode): void {
		if (setup === null) return;
		if (next === 'levels' && scheme === null && data.schemes.length > 0) {
			const first = data.schemes[0];
			save({ mode: next, schemeId: first.id, levelName: [...first.levels].sort((a, b) => a.ord - b.ord)[0]?.name ?? null });
			return;
		}
		save({ mode: next });
	}

	function selectScheme(id: number): void {
		const chosen = data.schemes.find((s) => s.id === id);
		if (chosen === undefined) return;
		save({ mode: 'levels', schemeId: chosen.id, levelName: [...chosen.levels].sort((a, b) => a.ord - b.ord)[0]?.name ?? null });
	}

	function toggleAllDecks(): void {
		if (setup === null) return;
		save({ decks: setup.decks === 'all' ? [...deckIds] : 'all' });
	}

	function toggleDeck(id: string): void {
		const next = deckIds.includes(id) ? deckIds.filter((deckId) => deckId !== id) : [...deckIds, id];
		if (next.length === 0) return;
		save({ decks: next });
	}

	async function toggleCardType(id: StudyCardKind): Promise<void> {
		typeError = '';
		if (setup === null) return;
		if (!isOptIn(id)) {
			save({ cardTypes: CARD_KINDS.filter((kind) => (kind === id ? !setup.cardTypes.includes(kind) : setup.cardTypes.includes(kind))) });
			return;
		}
		// "Reverse and Cloze apply to all decks": the switch of every deck, and the setup's uncheck.
		const ws = workspaceId;
		if (ws === null) return;
		const next = !kinds.includes(id);
		const before = setup;
		const optimistic: Record<string, DeckSettings> = { ...deckSettings };
		for (const deck of allDecks) {
			const stored = optimistic[deck.id];
			const current = cleanCardTypes(stored?.cardTypes ?? []);
			optimistic[deck.id] = {
				deckId: deck.id,
				cardTypes: next ? cleanCardTypes([...current, id]) : current.filter((value) => value !== id),
				...(stored?.newOrder ? { newOrder: stored.newOrder } : {}),
				extra: stored?.extra ?? {}
			};
		}
		pendingSettings = optimistic;
		void session.setups.update(ws, {
			unchecked: next ? before.unchecked.filter((kind) => kind !== id) : OPT_IN_KINDS.filter((kind) => kind === id || before.unchecked.includes(kind))
		});
		typeSaving = id;
		try {
			const result = await saveDeckCardTypesForDecks(session.study, ws, allDecks.map((deck) => deck.id), id, next);
			// Decks whose stored switches this version cannot read keep them (#167).
			if (result.unreadable.length > 0 && workspaceId === ws) typeError = t('study.store.unreadableRow');
		} catch (err) {
			if (workspaceId === ws) {
				pendingSettings = null;
				typeError = errorText(err, t('study.types.saveFailed'));
			}
		} finally {
			typeSaving = null;
		}
	}

	/** A per-deck switch under Advanced that turns a kind on clears the learner's uncheck of it. */
	function deckTypesSaved(saved: DeckSettings): void {
		if (setup === null) return;
		const cleared = setup.unchecked.filter((kind) => !saved.cardTypes.includes(kind));
		if (cleared.length !== setup.unchecked.length) save({ unchecked: cleared });
	}

	function backToStudy(event: MouseEvent): void {
		event.preventDefault();
		void goto(from).then(() => {
			if (session.alive) session.studyModal.show();
		});
	}
</script>

<svelte:head>
	<title>{pageTitle(t('study.advanced.title'), t('study.setup.title'))}</title>
</svelte:head>

<div class="page-body setup">
	<p class="back"><Button variant="plain" icon="back" href={from} onclick={backToStudy}>{t('study.advanced.back')}</Button></p>
	<h1>{t('study.advanced.title')}</h1>

	{#if vacationText !== null}
		<p class="vacation" role="status">{vacationText}. <a href="/settings?tab=study">{t('study.setup.change')}</a></p>
	{/if}
	<p class="hint">{t('study.setup.intro')}</p>
	<UnreadableRowsNotice {workspaceId} />
	{#if session.workspaces.current && usesHan(session.workspaces.current.language) && !featureKnownOff(STATS_ID, session.features)}
		<p class="hint"><a href="/stats/characters">{t('study.setup.masteryMap')}</a></p>
	{/if}
	{#if note !== null}<p class="hint" role="status">{note}</p>{/if}
	{#if entry?.saveError}<p class="error" role="alert">{errorText(entry.saveError, t('study.modal.notSaved'))}</p>{/if}

	{#if data.status === 'error'}
		<p class="error" role="alert">{data.error}</p>
	{:else if data.status === 'no-workspace' || setup === null || plan === null}
		<p class="hint" role="status">{t('study.guide.noWorkspace')}</p>
	{:else if !ready || !entry?.known}
		<!-- The controls wait for the saved setup (the server's answer or the device's copy), so a change
		     never starts from the defaults. -->
		<p class="hint" role="status">{t('study.guide.loading')}</p>
	{:else}
		<Section title={t('study.summary.title')} headingId="summary-heading">
			{#if vacationText === null}
				<p class="today">{startTodayText(plan.counts.due, plan.counts.fresh, plan.noDailyLimit)}</p>
			{/if}
			{#if setup.mode === 'levels'}
				<p class="stats">
					<strong>{plan.levelEntryTotal}</strong>
					{t('study.summary.levelIn', { noun: levelNoun })}
					<strong>{scheme?.name ?? t('study.summary.thisScheme')}</strong>
					{plan.levelSelected ? setup.levelName : ''} ·
					<strong>{plan.counts.due}</strong>
					{t('study.summary.dueDot')}
					<strong>{plan.counts.fresh}</strong>
					{t('study.summary.new')}
				</p>
			{:else}
				<p class="stats">
					<strong>{selectedCards.length}</strong>
					{t('study.summary.cardsIn', { count: selectedCards.length })}
					<strong>{deckIds.length}</strong>
					{t('study.summary.decksDot', { count: deckIds.length })}
					<strong>{plan.counts.due}</strong>
					{t('study.summary.dueDot')}
					<strong>{plan.counts.fresh}</strong>
					{t('study.summary.new')}
				</p>
				{#if plan.companions > 0}
					<p class="hint">{t('study.summary.companions', { count: plan.companions })}</p>
				{/if}
			{/if}
			{#if plan.warnings.length > 0}
				<ul class="warnings" aria-label={t('study.summary.warnings')}>
					{#each plan.warnings as warning (warning)}<li>{warning}</li>{/each}
				</ul>
			{/if}
			{#if plan.guidance && vacationText === null}
				<p class="hint" role="status">{plan.guidance}</p>
			{/if}
		</Section>

		<Section title={t('study.limitsSection.title')} headingId="limits-heading">
			<p class="hint">{t('study.limitsSection.intro')}</p>
			<div class="limits">
				<Field
					label={t('study.limitsSection.newCards')}
					type="number"
					min={1}
					max={MAX_LIMIT}
					step={1}
					value={String(setup.newLimit)}
					onchange={(event: Event) => saveLimit('newLimit', (event.currentTarget as HTMLInputElement).value)}
				/>
				<Field
					label={t('study.limitsSection.reviews')}
					type="number"
					min={1}
					max={MAX_LIMIT}
					step={1}
					value={String(setup.reviewLimit)}
					onchange={(event: Event) => saveLimit('reviewLimit', (event.currentTarget as HTMLInputElement).value)}
				/>
			</div>
			{#if limitError}<p class="error" role="alert">{limitError}</p>{/if}
			<Select
				label={t('study.limitsSection.order')}
				value={orderValue}
				onchange={(event) => save({ newOrder: decodeOrder((event.currentTarget as HTMLSelectElement).value) })}
				options={orderView.choices.map((choice) => ({ value: choice.value, label: choice.label }))}
			/>
			{#if ordersMixed}
				<p class="hint" role="status">{mixedNote()}</p>
			{/if}
			{#if orderView.hint !== null}
				<p class="hint">{orderView.hint}</p>
			{/if}
			<Select
				label={t('study.limitsSection.typeOrder')}
				value={setup.typeOrder}
				onchange={(event) => save({ typeOrder: parseTypeOrder((event.currentTarget as HTMLSelectElement).value) })}
				options={typeOrderChoices()}
			/>
			<p class="hint">
				<a href="/study/scheduling">{t('study.limitsSection.scheduling', { label: data.schedulingLabel })}</a>
			</p>
		</Section>

		<Section title={t('study.setup.source')} headingId="mode-heading">
			<div class="modes" role="radiogroup" aria-labelledby="mode-heading">
				<label class="inline">
					<input type="radio" name="session-mode" value="decks" checked={setup.mode === 'decks'} onchange={() => selectMode('decks')} />
					{t('study.setup.myDecks')}
				</label>
				<label class="inline">
					<input type="radio" name="session-mode" value="levels" checked={setup.mode === 'levels'} onchange={() => selectMode('levels')} />
					{t('study.setup.byLevel')}
				</label>
			</div>
		</Section>

		{#if setup.mode === 'decks'}
			<Section title={t('study.decks.title')} headingId="decks-heading">
				<ul class="decks">
					<li class="deck">
						<label class="deck-choice">
							<input type="checkbox" checked={setup.decks === 'all'} onchange={toggleAllDecks} />
							<span class="deck-name">{t('study.decks.all')}</span>
						</label>
					</li>
					{#each allDecks as deck (deck.id)}
						{@const ticked = deckIds.includes(deck.id)}
						<li class="deck">
							<label class="deck-choice">
								<input type="checkbox" checked={ticked} disabled={ticked && deckIds.length === 1} onchange={() => toggleDeck(deck.id)} />
								<span class="deck-name">{deck.name}</span>
								{#if deck.id === GENERAL_DECK_ID}<span class="tag">{t('study.decks.default')}</span>{/if}
							</label>
						</li>
					{/each}
				</ul>
				<p class="hint"><a href="/flashcards">{t('study.decks.manage')}</a></p>
			</Section>

			{#if workspaceId !== null}
				<!-- Its writes reach the page through onStudyChange (one reload each). -->
				<CardManager {workspaceId} cards={data.cards} decks={allDecks} />
			{/if}
		{:else}
			<Section title={t('study.level.title')} headingId="levels-heading">
				<p class="hint">{t('study.level.intro')}</p>
				{#if data.schemeError}
					<p class="error" role="alert">{data.schemeError}</p>
				{:else if !data.schemesLoaded}
					<p class="hint" role="status">{t('study.level.loadingSchemes')}</p>
				{:else if data.schemes.length === 0}
					<p class="hint">{t('study.level.noSchemes')}</p>
				{:else}
					<div class="levels">
						<Select
							label={t('study.level.scheme')}
							value={scheme === null ? '' : String(scheme.id)}
							onchange={(event) => selectScheme(Number((event.currentTarget as HTMLSelectElement).value))}
							options={data.schemes.map((s) => ({ value: String(s.id), label: s.name }))}
						/>
						<Select
							label={t('study.level.level')}
							value={setup.levelName ?? ''}
							onchange={(event) => save({ mode: 'levels', schemeId: scheme?.id ?? null, levelName: (event.currentTarget as HTMLSelectElement).value })}
							options={schemeLevels.map((level) => ({ value: level.name, label: levelOptionLabel(level.name) }))}
						/>
					</div>
					{#if data.levelError}
						<p class="error" role="alert">{data.levelError}</p>
					{:else if data.levelLoading}
						<p class="hint" role="status">{t('study.guide.loadingLevel')}</p>
					{/if}
				{/if}
			</Section>
		{/if}

		<Section title={t('study.types.title')} headingId="types-heading">
			<p class="hint">{t('study.types.intro')}</p>
			<ul class="types">
				{#each visibleTypes as type (type.id)}
					{@const checked = shownKinds.includes(type.id)}
					<li>
						<label class="type-choice">
							<input
								type="checkbox"
								{checked}
								disabled={typeSaving !== null || (checked && shownKinds.length === 1)}
								aria-describedby={`type-${type.id}-info`}
								onchange={() => void toggleCardType(type.id)}
							/>
							<span class="type-label">{type.label}</span>
							<span class="type-info" id={`type-${type.id}-info`}>{TYPE_INFO[type.id]}</span>
						</label>
					</li>
				{/each}
			</ul>
			{#each hiddenLines as line (line)}<p class="hint">{line}</p>{/each}
			{#if typeError}
				<p class="error" role="alert">{typeError}</p>
			{/if}
		</Section>

		{#if setup.mode === 'decks'}
			<Section title={t('study.advanced.perDeck')} headingId="advanced-heading">
				<p class="hint">{t('study.advanced.intro')}</p>
				<Button
					variant="secondary"
					icon={advancedOpen ? 'expand-down' : 'forward'}
					aria-expanded={advancedOpen}
					onclick={() => (advancedOpen = !advancedOpen)}
				>{t('study.advanced.toggle')}</Button>
				{#if advancedOpen}
					<ul class="advanced-decks">
						{#each allDecks as deck (deck.id)}
							<li>
								<span class="advanced-name">{deck.name}</span>
								<DeckCardTypes
									{workspaceId}
									deckId={deck.id}
									deckName={deck.name}
									cardTypes={deckSettings[deck.id]?.cardTypes ?? []}
									onSaved={(saved) => deckTypesSaved(saved)}
								/>
							</li>
						{/each}
					</ul>
				{/if}
			</Section>
		{/if}
	{/if}
</div>

<style>
	/* .page-body is the only page column (#106); the setup brings no second one. */
	h1 {
		margin-bottom: var(--space-2);
	}

	.back {
		margin: 0 0 var(--space-2);
	}

	.modes,
	.decks,
	.levels,
	.limits,
	.types {
		display: grid;
		gap: var(--space-2);
	}

	.advanced-decks {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}

	.advanced-decks li {
		padding-top: var(--space-2);
		border-top: 1px solid var(--hair);
	}

	.advanced-name {
		font-weight: var(--weight-medium);
	}

	.inline,
	.deck-choice,
	.type-choice {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		min-height: var(--hit);
	}

	.decks {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.deck {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		padding-block: var(--space-2);
	}

	.deck + .deck {
		border-top: 1px solid var(--hair);
	}

	.types {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.types li + li {
		border-top: 1px solid var(--hair);
	}

	.limits {
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		max-width: 28rem;
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		color: var(--readable-muted);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
	}
</style>
