<script lang="ts">
	// The study modal (design 2026-11-25-study-modal-design.md, 4.1): the
	// summary, this session's size, the card-type chips, Start and Study all,
	// and the way to Advanced settings — nothing else. It starts the
	// workspace's saved setup (session.setups); a chip saves it at once. A
	// dialog on the desktop frame, the bottom sheet on the phone frame
	// (lib/frame/breakpoint.ts); both are on the dismiss stack, so the Android
	// back button closes it. Opened through session.studyModal.
	import { goto } from '$app/navigation';
	import { errorText } from '$lib/api/apiErrors';
	import { useSession } from '$lib/context/context';
	import { PHONE_MEDIA_QUERY } from '$lib/frame/breakpoint';
	import { t } from '$lib/i18n';
	import { here } from '$lib/routing/here';
	import { vacationBanner, vacationStatus } from '$lib/settings/vacationForm';
	import { enabledKinds } from '$lib/studycore/deckSettings';
	import { loadIneligible } from '../session/ineligible';
	import { newSessionSeed, saveConfig } from '../session/session';
	import { repairSetup, setupDeckIds, setupKinds, setupSessionConfig } from './setup';
	import { planSetup } from './setupPlan';
	import type { StudyCardKind } from '$lib/studycore/types';
	import { Button, Dialog, IconButton, Sheet } from '$lib/ui';
	import UnreadableRowsNotice from '../UnreadableRowsNotice.svelte';
	import { createSetupData } from './setupData.svelte';
	import { chipPatch, noteText, summaryLine, todayLine, visibleChips } from './studyModalView';

	const session = useSession();
	const modal = session.studyModal;
	const data = createSetupData(session, { fresh: false });

	let phone = $state(typeof matchMedia === 'function' && matchMedia(PHONE_MEDIA_QUERY).matches);
	$effect(() => {
		if (typeof matchMedia !== 'function') return;
		const query = matchMedia(PHONE_MEDIA_QUERY);
		phone = query.matches;
		const change = (e: { matches: boolean }): void => void (phone = e.matches);
		query.addEventListener('change', change);
		return () => query.removeEventListener('change', change);
	});

	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	const language = $derived(session.workspaces.current?.language ?? '');

	// Each opening (and a workspace switch while open) reads the data and the setup again.
	$effect(() => {
		if (!modal.open) return;
		const ws = workspaceId;
		const lang = session.workspaces.current?.language ?? null;
		void data.load(ws, lang);
		if (ws !== null) void session.setups.refresh(ws);
	});

	const entry = $derived(workspaceId === null ? null : session.setups.of(workspaceId));
	const ready = $derived(data.status === 'ready' && data.workspaceId === workspaceId);
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
	const deckIds = $derived(setup === null ? [] : setupDeckIds(setup, data.decks));
	const enabled = $derived(enabledKinds(data.deckSettings, deckIds));
	const kinds = $derived<StudyCardKind[]>(setup === null ? [] : setupKinds(setup, enabled, language));
	const chips = $derived(setup === null ? [] : visibleChips(setup, enabled, language));
	const scheme = $derived(setup === null ? null : (data.schemes.find((s) => s.id === setup.schemeId) ?? null));

	// A level setup counts the level's entries.
	$effect(() => {
		const level = setup?.mode === 'levels' && scheme !== null && scheme.levels.some((l) => l.name === setup.levelName) ? setup.levelName : null;
		if (level === null || scheme === null) data.clearLevel();
		else void data.loadLevel(scheme.id, level);
	});

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
						deckSettings: data.deckSettings,
						weights: data.weights,
						ctx: data.ctx,
						language,
						skip: workspaceId === null ? undefined : loadIneligible(workspaceId),
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

	const vacationText = $derived(
		workspaceId === null || !ready || !data.ctx.vacationToday
			? null
			: vacationBanner(vacationStatus(data.vacations, workspaceId, data.ctx.day.today()), data.ctx.day.today())
	);
	const note = $derived(repaired === null ? null : noteText(repaired.notes));
	const canStart = $derived(plan !== null && ready && plan.guidance === '' && vacationText === null);
	const canStudyAll = $derived(
		plan !== null && ready && vacationText === null && (plan.guidance === '' || plan.allCounts.due + plan.allCounts.fresh > 0)
	);
	const advancedHref = $derived(`/study/advanced?from=${encodeURIComponent(modal.open ? here() : '/')}`);

	// Focus starts on Start (design 5). On a cold start Start is enabled only
	// once the counts arrive: focus moves there then, unless the learner already
	// did something in the modal.
	let startButton = $state<HTMLElement>();
	let touched = false;
	let focused = false;
	$effect(() => {
		if (!modal.open) {
			touched = false;
			focused = false;
			return;
		}
		if (canStart && !focused && !touched && startButton) {
			focused = true;
			startButton.focus();
		}
	});

	function toggle(id: StudyCardKind): void {
		// The workspace whose chips were clicked, captured now (#174).
		const ws = workspaceId;
		if (ws === null || setup === null) return;
		void session.setups.update(ws, chipPatch(setup, id, enabled, language));
	}

	function start(studyAll = false): void {
		if (setup === null || workspaceId === null) return;
		saveConfig(setupSessionConfig(setup, deckIds, kinds, { studyAll, seed: newSessionSeed(), from: here() }));
		modal.hide();
		void goto('/study/session');
	}

	function close(): void {
		modal.hide();
	}
</script>

{#snippet body(withTitle: boolean)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="study-modal" onkeydown={() => (touched = true)} onpointerdown={() => (touched = true)}>
		{#if withTitle}<h2 class="title">{t('study.modal.title')}</h2>{/if}
		{#if plan === null || setup === null}
			<p class="line" role="status">{t('study.guide.noWorkspace')}</p>
		{:else}
			{#if vacationText !== null}
				<p class="line" role="status">
					{vacationText}. <a href="/settings?tab=study" onclick={close}>{t('study.setup.change')}</a>
				</p>
			{:else if !ready}
				<p class="line muted" role="status">{data.status === 'error' ? data.error : t('study.modal.loading')}</p>
			{:else}
				<p class="line summary">
					{summaryLine({
						mode: setup.mode,
						due: plan.counts.due,
						fresh: plan.counts.fresh,
						decks: deckIds.length,
						scheme: scheme?.name ?? null,
						level: setup.levelName
					})}
				</p>
				<p class="line today" role="status">{todayLine(plan.session, plan.guidance)}</p>
			{/if}
			{#if note !== null}<p class="line muted">{note}</p>{/if}

			<fieldset class="chips">
				<legend class="visually-hidden">{t('study.modal.chips')}</legend>
				{#each chips as chip (chip.id)}
					<label class="chip" class:checked={chip.checked}>
						<!-- Disabled until the saved setup is known (the server answered or the device holds it). -->
						<input type="checkbox" checked={chip.checked} disabled={chip.locked || !entry?.known} onchange={() => toggle(chip.id)} />
						<span>{chip.label}</span>
					</label>
				{/each}
			</fieldset>
			{#if ready && plan.warnings.length > 0}
				<ul class="warnings" aria-label={t('study.summary.warnings')}>
					{#each plan.warnings as warning (warning)}<li>{warning}</li>{/each}
				</ul>
			{/if}
			{#if entry?.saveError}<p class="line error" role="alert">{errorText(entry.saveError, t('study.modal.notSaved'))}</p>{/if}
			<UnreadableRowsNotice {workspaceId} />

			<div class="actions">
				<Button variant="primary" bind:element={startButton} data-start disabled={!canStart} onclick={() => start()}>
					{t('study.summary.start')}
				</Button>
				<Button disabled={!canStudyAll} onclick={() => start(true)}>{t('study.summary.startAll')}</Button>
			</div>
			<p class="advanced"><a href={advancedHref} onclick={close}>{t('study.modal.advanced')}</a></p>
		{/if}
	</div>
{/snippet}

{#if modal.open}
	{#if phone}
		<Sheet open={true} label={t('study.modal.title')} onclose={close} initialFocus="[data-start]:not([disabled])">
			{@render body(true)}
		</Sheet>
	{:else}
		<Dialog open={true} title={t('study.modal.title')} onclose={close} initialFocus="[data-start]:not([disabled])">
			<div class="close"><IconButton label={t('common.action.close')} icon="close" onclick={close} /></div>
			{@render body(false)}
		</Dialog>
	{/if}
{/if}

<style>
	.study-modal {
		display: grid;
		gap: var(--space-3);
	}
	.title {
		margin: 0;
		font-size: var(--font-size-l);
		font-weight: var(--weight-strong);
	}
	.close {
		position: absolute;
		inset-block-start: var(--space-3);
		inset-inline-end: var(--space-3);
	}
	.line {
		margin: 0;
	}
	.summary {
		font-weight: var(--weight-medium);
	}
	.muted {
		color: var(--readable-muted);
	}
	.error {
		color: var(--readable-bad);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
	}
	/* A chip (design §9): a label on a --raised wash; a checked one in the primary wash with a check. */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--hit);
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		background: var(--raised);
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}
	.chip.checked {
		background: var(--primary-wash);
	}
	.chip input {
		margin: 0;
		accent-color: var(--accent);
	}
	.chip:has(input:focus-visible) {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.chip:has(input:disabled) {
		cursor: default;
	}
	.warnings {
		margin: 0;
		padding-inline-start: var(--space-4);
		color: var(--readable-muted);
		font-size: var(--font-size-label);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.advanced {
		margin: 0;
	}
	@media (forced-colors: active) {
		.chip {
			outline: 1px solid CanvasText;
		}
	}
</style>
