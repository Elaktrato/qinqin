<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { fetchCharacters } from '$lib/api/characters';
	import { fetchComponents, type ComponentIndex } from '$lib/api/components';
	import type { CharRow } from '$lib/api/types';
	import { user } from '$lib/auth';
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
	import { currentLanguage, workspacesLoaded } from '$lib/workspaces';

	const lang = $derived($currentLanguage);
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
			const parts = fetchComponents(language).catch(() => EMPTY_COMPONENTS);
			const [list, index] = await Promise.all([fetchCharacters(language), parts]);
			if (mine !== seq) return;
			chars = list.chars;
			comps = index;
		} catch (err) {
			if (mine !== seq) return;
			loadError =
				err instanceof ApiError || err instanceof Error ? err.message || 'Could not load.' : 'Could not load.';
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
	<title>{pageTitle('Radicals and parts')}</title>
</svelte:head>

<main class="parts-page">
	<h1>Find a character by radical or part</h1>
	<p><a href="/search">Back to search</a></p>

	{#if lang === null}
		{#if $workspacesLoaded}
			<p class="hint">No workspace selected. Create or select a workspace in the header.</p>
		{/if}
	{:else if !supported}
		<p class="hint">Radical lookup is available in Chinese and Japanese workspaces.</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<button type="button" class="retry" onclick={() => void load(lang)}>Try again</button>
	{:else if chars === null}
		<p class="hint" aria-live="polite">Loading…</p>
	{:else if chars.length === 0}
		<p class="hint" role="status">{dictionaryHint(languageLabel(lang), $user?.admin === true)}</p>
	{:else}
		<form class="typed" onsubmit={submitTyped}>
			<input
				type="text"
				bind:value={typed}
				aria-label="Type a radical or part"
				placeholder="Type a radical or part (氵, 口…)"
				maxlength="4"
			/>
			<button type="submit">Add</button>
			<button type="button" class="clear" disabled={isEmpty(sel)} onclick={() => go({ p: [] })}>Clear</button>
		</form>

		{#if typedChoices.length > 0}
			<div class="chips" role="group" aria-label="Which one?">
				{#each typedChoices as option (option.key)}
					<button
						type="button"
						class="chip"
						lang={glyphLang}
						onclick={() => {
							typedChoices = [];
							go(option.next);
						}}
					>
						{option.name}
					</button>
				{/each}
			</div>
		{/if}

		{#if !isEmpty(sel)}
			<div class="chips selected" role="group" aria-label="Selected">
				{#each selectionChips(sel) as chip (chip.key)}
					<button
						type="button"
						class="chip"
						lang={glyphLang}
						aria-label={`Remove ${chip.name}`}
						onclick={() => go(chip.next)}
					>
						{chip.label} <span aria-hidden="true">×</span>
					</button>
				{/each}
			</div>
		{/if}

		<section aria-labelledby="radicals-heading">
			<h2 id="radicals-heading">Radical</h2>
			<div class="radicals" role="group" aria-label="Radicals">
				{#each table as group (group.s)}
					<h3 class="group-label">{group.s}</h3>
					<div class="tiles">
						{#each group.radicals as r (r.n)}
							<button
								type="button"
								class="tile"
								lang={glyphLang}
								aria-pressed={sel.r === r.n}
								title={`Radical ${r.n}`}
								onclick={() => go(toggleRadical(sel, r.n))}
							>
								{r.c}{#if r.forms.length > 0}<span class="forms">{r.forms.join('')}</span>{/if}
							</button>
						{/each}
					</div>
				{/each}
			</div>
		</section>

		<section aria-labelledby="parts-heading">
			<h2 id="parts-heading">Parts</h2>
			{#if comps.parts.length === 0}
				<p class="note">
					No character components are installed for this language; pick a radical or a stroke count.
				</p>
			{:else}
				<div class="parts" role="group" aria-label="Parts">
					{#each picker as group (group.s)}
						<h3 class="group-label">{group.s === 0 ? '?' : group.s}</h3>
						<div class="tiles">
							{#each group.parts as part (part.c)}
								{@const chosen = sel.p.includes(part.c)}
								<button
									type="button"
									class="tile"
									lang={glyphLang}
									aria-pressed={chosen}
									aria-disabled={part.disabled && !chosen}
									onclick={() => {
										if (!part.disabled || chosen) go(togglePart(sel, part.c));
									}}
								>
									{part.c}
								</button>
							{/each}
						</div>
					{/each}
				</div>
				<button type="button" class="link" onclick={() => (showAllParts = !showAllParts)}>
					{showAllParts ? 'Show common parts' : 'Show all parts'}
				</button>
			{/if}
		</section>

		{#if strokeChips.length > 0}
			<section aria-labelledby="strokes-heading">
				<h2 id="strokes-heading">Total strokes</h2>
				<div class="chips" role="group" aria-label="Total strokes">
					{#each strokeChips as s (s)}
						<button type="button" class="chip" aria-pressed={sel.s === s} onclick={() => go(toggleStrokes(sel, s))}>
							{s}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<p class="status" role="status" aria-live="polite">{statusLine(sel, result.total)}</p>

		{#if result.total > 0}
			<ul class="results" aria-label="Matching characters" lang={glyphLang}>
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
				<button type="button" class="link" onclick={() => (showAllResults = true)}>Show all {result.total}</button>
			{/if}
		{/if}
	{/if}
</main>

<style>
	.parts-page section {
		margin-top: 1.25rem;
	}

	.typed {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		max-width: 32rem;
	}

	.typed input {
		flex: 1;
		min-width: 8rem;
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
	}

	.typed button,
	.chip,
	.retry {
		font: inherit;
		min-height: 2.75rem;
		padding: 0.3rem 0.85rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.selected {
		margin-top: 0.75rem;
	}

	.clear:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.group-label {
		margin: 0.5rem 0 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		opacity: 0.7;
	}

	.tiles,
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.tile {
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

	.tile .forms {
		margin-left: 0.15rem;
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.tile[aria-pressed='true'],
	.chip[aria-pressed='true'] {
		background: #0b6bcb;
		border-color: #0b6bcb;
		color: #fff;
	}

	.tile[aria-disabled='true'] {
		opacity: 0.3;
		cursor: default;
	}

	.tile:focus-visible,
	.chip:focus-visible,
	.cell:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.link {
		margin-top: 0.5rem;
		font: inherit;
		min-height: 2.75rem;
		border: none;
		background: none;
		color: #0b6bcb;
		text-decoration: underline;
		cursor: pointer;
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
		opacity: 0.75;
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
		opacity: 0.75;
	}

	.error {
		color: #c62828;
		font-weight: 600;
	}
</style>
