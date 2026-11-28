<script lang="ts">
	// Home: "How would you like to start?" for a fresh workspace whose language has a course (#225, startOffer.ts).
	// "I'm new" starts the course and can add the Starter words with Starter mode (the course has no place for the
	// Starter base set, #223); "I know some already" finds the learner's place in the course (#224) or declares levels
	// (#74). Where a course applies it stands in for the Starter and placement offers: `onsettle` tells Home whether
	// it does. Quiet on any failure: the card is a nicety.
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import { COURSES_ID, featureEnabled } from '$lib/features';
	import { workspaceCourse } from '$lib/features/courses/courseData';
	import { courseHome } from '$lib/features/courses/home';
	import { courseState } from '$lib/features/courses/progress';
	import { courseHref } from '$lib/features/courses/route';
	import { placementFirst } from '$lib/features/courses/tests';
	import { languageLabel } from '$lib/languages';
	import { loadStudyHistory, onStudyChange, touches } from '$lib/studycore/data';
	import { Button } from '$lib/ui';
	import { readStarterSettings, starterProfile } from './starter';
	import { courseStartApplies, isCourseStartDismissed, setCourseStartDismissed, shouldOfferCourseStart } from './startOffer';
	import StarterAdd from './StarterAdd.svelte';

	/** onsettle: true when a course applies (the older offers stay away), false when not, null while deciding. */
	let { onsettle }: { onsettle?: (applies: boolean | null) => void } = $props();

	const session = useSession();

	let offer = $state.raw<{ start: string; placement: string | null } | null>(null);
	let seq = 0;
	// Bumped when this workspace's study data or event log changes (a write, a background refresh): the card is
	// decided again, so levels marked known or a first card after a reload of held data take it away (#225).
	let changes = $state(0);
	const workspace = $derived(session.workspaces.current);
	const featuresReady = $derived(session.features.status === 'ready' || session.features.status === 'error');
	const coursesOn = $derived(session.features.status === 'ready' && featureEnabled(COURSES_ID, session.features.list));
	const starterOn = $derived(readStarterSettings(workspace?.settings).enabled);

	function storage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	$effect(() => {
		const ws = workspace;
		if (ws === undefined || ws === null) return;
		const again = (touched: number): void => {
			if (touches(touched, ws.id)) changes++;
		};
		const offLog = session.events.onChange(again);
		const offWrite = onStudyChange(session.study, again);
		return () => {
			offLog();
			offWrite();
		};
	});

	$effect(() => {
		const ws = workspace;
		const on = coursesOn;
		const ready = featuresReady;
		void changes;
		const mine = ++seq;
		offer = null;
		// Deciding again (another workspace, the switches arrived): Home keeps the older offers back meanwhile, so they
		// never flash in before this card. Without a workspace they have nothing to offer either.
		onsettle?.(null);
		if (ws === undefined || ws === null || !ready) return;
		if (!on) {
			onsettle?.(false);
			return;
		}
		void (async () => {
			const course = await workspaceCourse(session, { id: ws.id, language: ws.language });
			if (mine !== seq) return;
			if (course === null) {
				onsettle?.(false);
				return;
			}
			let history;
			try {
				history = await loadStudyHistory(session.study, ws.id);
			} catch {
				if (mine === seq) onsettle?.(true);
				return;
			}
			if (mine !== seq) return;
			const facts = {
				coursesOn: on,
				hasCourse: true,
				cards: history.cards.length,
				marks: history.known?.length ?? 0,
				courseEvents: history.courseEvents.length,
				dismissed: isCourseStartDismissed(storage(), ws.id)
			};
			onsettle?.(courseStartApplies(facts));
			if (!shouldOfferCourseStart(facts)) return;
			const next = courseHome(course, courseState(course, history)).next;
			const first = placementFirst(course.sections);
			offer = {
				start: next?.href ?? courseHref({ view: 'roadmap', course: null }),
				placement: first === null ? null : courseHref({ view: 'placement', course: course.id, section: first })
			};
		})();
	});

	function later(): void {
		if (workspace) setCourseStartDismissed(storage(), workspace.id);
		offer = null;
	}
</script>

{#if offer !== null && workspace}
	<section class="offer" aria-labelledby="course-start-title" data-testid="course-start-offer">
		<h2 id="course-start-title">{t('app.home.courseStart.title')}</h2>
		<div class="paths">
			<div class="path">
				<h3>{t('app.home.courseStart.newTitle', { language: languageLabel(workspace.language) })}</h3>
				<p>{t('app.home.courseStart.newText')}</p>
				<div class="row">
					<Button variant="primary" href={offer.start}>{t('app.home.courseStart.newAction')}</Button>
					{#if !starterOn && starterProfile(workspace.language) !== null}
						<StarterAdd language={workspace.language} workspaceId={workspace.id} label={t('app.home.courseStart.starterAction')} enableMode />
					{/if}
				</div>
			</div>
			<div class="path">
				<h3>{t('app.home.courseStart.someTitle')}</h3>
				<p>{t('app.home.courseStart.someText')}</p>
				<div class="row">
					{#if offer.placement !== null}
						<Button variant="primary" href={offer.placement}>{t('app.home.courseStart.someAction')}</Button>
					{/if}
					<Button variant="plain" href="/settings?tab=study#known">{t('app.home.courseStart.levelsAction')}</Button>
				</div>
			</div>
		</div>
		<Button variant="plain" onclick={later}>{t('app.home.courseStart.later')}</Button>
	</section>
{/if}

<style>
	.offer {
		margin: var(--space-3) 0;
		padding: 0 0 var(--space-3);
		border-bottom: 1px solid var(--hair);
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
	}
	h3 {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
	}
	p {
		margin: 0 0 var(--space-2);
	}
	.paths {
		display: grid;
		gap: var(--space-4);
		margin-bottom: var(--space-2);
	}
	@media (min-width: 720px) {
		.paths {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.path {
		min-width: 0;
	}
	.row {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		align-items: center;
	}
</style>
