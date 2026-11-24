<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { goto } from '$app/navigation';
	import { t } from '$lib/i18n';
	import { page } from '$app/state';
	import { fetchCharacters } from '$lib/api/characters';
	import { fetchComponents, type ComponentIndex } from '$lib/api/components';
	import type { CharRow } from '$lib/api/types';
	import { dictionaryHint } from '$lib/coverage';
	import { languageLabel, usesHan } from '$lib/languages';
	import { pageTitle } from '$lib/pageTitle';
	import { primaryLanguage, radicalTable } from '$lib/radicals/kangxi';
	import { buildIndex, isEmpty, lookup, pickerParts, RESULT_CAP, type Selection } from '$lib/radicals/lookup';
	import {
		selectionChips,
		statusLine,
		strokesLabel,
		togglePart,
		toggleRadical,
		toggleStrokes,
		typedOptions,
		type TypedOption
	} from '$lib/radicals/selection';
	import { partsHref, selectionFromParams } from '$lib/radicals/url';
	import { Button, Field, Section } from '$lib/ui';
	import { useApp } from '$lib/context/context';
	import { useSession } from '$lib/context/context';
	const session = useSession();
	const app = useApp();

	const lang = $derived(session.workspaces.language);
	const supported = $derived(lang !== null && usesHan(lang));

	let chars = $state.raw<CharRow[] | null>(null);
	const EMPTY_COMPONENTS: ComponentIndex = { packs: [], parts: [], chars: {} };
	let comps = $state.raw<ComponentIndex>(EMPTY_COMPONENTS);
	let loadError = $state('');
	let showAllParts = $state(false);
	let showAllResults = $state(false);
	let typed = $state('');
	// The meanings of an ambiguous typed character (阝), until one is picked.
	let typedChoices = $state.raw<TypedOption[]>([]);
	let seq = 0;

	async function load(language: string): Promise<void> {
		const mine = ++seq;
		chars = null;
		loadError = '';
		try {
			// Components are optional: a failed request leaves the radical
			// table and strokes working, with the "no components" note.
			const parts = fetchComponents(session.caches.components, language).catch(() => EMPTY_COMPONENTS);
			const [list, index] = await Promise.all([fetchCharacters(session.caches.characters, language), parts]);
			if (mine !== seq) return;
			chars = list.chars;
			comps = index;
		} catch (err) {
			if (mine !== seq) return;
			loadError = errorText(err, t('search.parts.loadFailed'));
		}
	}

	$effect(() => {
		if (lang !== null && supported) void load(lang);
	});

	const sel = $derived(selectionFromParams(page.url.searchParams));
	const index = $derived(buildIndex(chars ?? [], comps.chars));
	const result = $derived(lookup(index, sel, { cap: showAllResults ? Infinity : RESULT_CAP }));
	const table = $derived(radicalTable(lang ?? ''));
	const picker = $derived(pickerParts(comps.parts, result.availableParts, showAllParts));
	const strokeChips = $derived(
		sel.s !== undefined && !result.availableStrokes.includes(sel.s)
			? [...result.availableStrokes, sel.s].sort((a, b) => a - b)
			: result.availableStrokes
	);
	const glyphLang = $derived(primaryLanguage(lang ?? ''));

	function go(next: Selection): void {
		showAllResults = false;
		goto(partsHref(next), { keepFocus: true, noScroll: true }).catch(() => {});
	}

	function submitTyped(event: SubmitEvent): void {
		event.preventDefault();
		const known = new Set(comps.parts.map((x) => x.c));
		const options = typedOptions(sel, typed, (x) => known.has(x));
		if (options.length === 0) return;
		typed = '';
		if (options.length === 1) {
			typedChoices = [];
			go(options[0].next);
		} else {
			typedChoices = options;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(t('search.parts.title'))}</title>
</svelte:head>

<div class="page-body parts-page">
	<h1>{t('search.parts.heading')}</h1>
	<p><a href="/search">{t('search.parts.back')}</a></p>

	{#if lang === null}
		{#if session.workspaces.loaded}
			<p class="hint">{t('search.parts.noWorkspace')}</p>
		{/if}
	{:else if !supported}
		<p class="hint">{t('search.parts.unsupported')}</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<Button onclick={() => void load(lang)}>{t('common.action.retry')}</Button>
	{:else if chars === null}
		<p class="hint" aria-live="polite">{t('common.loading')}</p>
	{:else if chars.length === 0}
		<p class="hint" role="status">{dictionaryHint(languageLabel(lang), app.auth.user?.admin === true)}</p>
	{:else}
		<form class="typed" onsubmit={submitTyped}>
			<div class="typed-field">
				<Field
					label={t('search.parts.typeLabel')}
					bind:value={typed}
					placeholder={t('search.parts.typePlaceholder')}
					maxlength={4}
				/>
			</div>
			<Button type="submit" variant="primary">{t('search.parts.add')}</Button>
			<Button disabled={isEmpty(sel)} onclick={() => go({ p: [] })}>{t('search.parts.clear')}</Button>
		</form>

		{#if typedChoices.length > 0}
			<div class="chips" role="group" aria-label={t('search.parts.whichOne')}>
				{#each typedChoices as option (option.key)}
					<Button
						variant="plain"
						class="chip"
						lang={glyphLang}
						onclick={() => {
							typedChoices = [];
							go(option.next);
						}}
					>
						{option.name}
					</Button>
				{/each}
			</div>
		{/if}

		{#if !isEmpty(sel)}
			<div class="chips selected" role="group" aria-label={t('search.parts.selected')}>
				{#each selectionChips(sel) as chip (chip.key)}
					<Button
						variant="plain"
						class="chip"
						lang={glyphLang}
						aria-label={t('search.parts.remove', { name: chip.name })}
						onclick={() => go(chip.next)}
					>
						{chip.label} <span aria-hidden="true">×</span>
					</Button>
				{/each}
			</div>
		{/if}

		<Section title={t('search.parts.radical')}>
			<div class="radicals" role="group" aria-label={t('search.parts.radicals')}>
				{#each table as group (group.s)}
					<h3 class="group-label">{group.s}</h3>
					<div class="tiles">
						{#each group.radicals as r (r.n)}
							<Button
								variant="plain"
								class="tile"
								lang={glyphLang}
								aria-pressed={sel.r === r.n}
								title={t('search.parts.radicalNumber', { n: r.n })}
								onclick={() => go(toggleRadical(sel, r.n))}
							>
								{r.c}{#if r.forms.length > 0}<span class="forms">{r.forms.join('')}</span>{/if}
							</Button>
						{/each}
					</div>
				{/each}
			</div>
		</Section>

		<Section title={t('search.parts.parts')}>
			{#if comps.parts.length === 0}
				<p class="note">{t('search.parts.noComponents')}</p>
			{:else}
				<div class="parts" role="group" aria-label={t('search.parts.parts')}>
					{#each picker as group (group.s)}
						<h3 class="group-label">{group.s === 0 ? '?' : group.s}</h3>
						<div class="tiles">
							{#each group.parts as part (part.c)}
								{@const chosen = sel.p.includes(part.c)}
								<Button
									variant="plain"
									class="tile"
									lang={glyphLang}
									aria-pressed={chosen}
									aria-disabled={part.disabled && !chosen}
									onclick={() => {
										if (!part.disabled || chosen) go(togglePart(sel, part.c));
									}}
								>
									{part.c}
								</Button>
							{/each}
						</div>
					{/each}
				</div>
				<Button variant="plain" onclick={() => (showAllParts = !showAllParts)}>
					{showAllParts ? t('search.parts.showCommon') : t('search.parts.showAll')}
				</Button>
			{/if}
		</Section>

		{#if strokeChips.length > 0}
			<Section title={t('search.parts.totalStrokes')}>
				<div class="chips" role="group" aria-label={t('search.parts.totalStrokes')}>
					{#each strokeChips as s (s)}
						<Button variant="plain" class="chip" aria-pressed={sel.s === s} onclick={() => go(toggleStrokes(sel, s))}>
							{s}
						</Button>
					{/each}
				</div>
			</Section>
		{/if}

		<p class="status" role="status" aria-live="polite">{statusLine(sel, result.total)}</p>

		{#if result.total > 0}
			<ul class="results" aria-label={t('search.parts.matching')} lang={glyphLang}>
				{#each result.groups as group (group.s)}
					{#if group.cells.length > 0}
						<li class="result-group">
							<h3 class="result-label">{strokesLabel(group.s)}</h3>
							<ul class="cells">
								{#each group.cells as cell (cell.i)}
									<li><a class="cell" href={`/entry/${cell.i}`} title={cell.m ?? ''}>{cell.c}</a></li>
								{/each}
							</ul>
						</li>
					{/if}
				{/each}
			</ul>
			{#if result.total > result.results.length}
				<Button variant="plain" onclick={() => (showAllResults = true)}>{t('search.parts.showAllResults', { count: result.total })}</Button>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.typed {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: end;
		max-width: 32rem;
	}

	.typed-field {
		flex: 1 1 10rem;
	}

	.selected {
		margin-top: 0.75rem;
	}

	.group-label {
		margin: 0.5rem 0 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--readable-muted);
	}

	.tiles,
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	:global(.tile) {
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0.2rem 0.35rem;
		font: inherit;
		font-size: 1.2rem;
		line-height: 1;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 0.3rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	:global(.tile) .forms {
		margin-left: 0.15rem;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}

	:global(.tile[aria-pressed='true']),
	:global(.chip[aria-pressed='true']) {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}

	:global(.tile[aria-disabled='true']) {
		opacity: 0.3;
		cursor: default;
	}

	.cell:focus-visible {
		outline: 2px solid var(--focus-colour);
		outline-offset: 2px;
	}

	.status {
		margin-top: 1.25rem;
		font-weight: 600;
	}

	.results,
	.cells {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.result-label {
		margin: 0.75rem 0 0.25rem;
		font-size: 0.85rem;
		color: var(--readable-muted);
	}

	.cells {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(2.75rem, 1fr));
		gap: 0.25rem;
	}

	.cell {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		min-height: 2.75rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.3rem;
		font-size: 1.3rem;
		line-height: 1;
		text-decoration: none;
		color: inherit;
	}

	.cell:hover {
		border-color: currentColor;
	}

	.hint,
	.note {
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
