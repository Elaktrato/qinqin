<script lang="ts">
	// The milestone card on home: the current workspace's log families only
	// (no replay). Loads once the feature switches are ready, again on a study
	// write or a posted event of the workspace; a slower answer for another
	// workspace is dropped.
	import { untrack } from 'svelte';
	import { ALL_WORKSPACES, onStudyChange } from '$lib/studycore/data';
	import MilestoneCard from './MilestoneCard.svelte';
	import { loadMilestones, markSeen, type MilestonesView } from './loadMilestones';
	import { useSession } from '$lib/context/context';


	const session = useSession();

	let view = $state.raw<MilestonesView | null>(null);
	let seq = 0;

	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	const language = $derived(session.workspaces.current?.language ?? '');
	const ready = $derived(session.features.status === 'ready');

	async function load(id: number | null, lang: string, isReady: boolean): Promise<void> {
		const mine = ++seq;
		// Another workspace's card never stays on screen while this one loads.
		// untrack: the load must not depend on the view it replaces.
		if (untrack(() => view !== null && view.workspaceId !== id)) view = null;
		if (id === null || !isReady) {
			view = null;
			return;
		}
		try {
			const loaded = await loadMilestones(session, id, { scope: 'home', language: lang, states: session.features });
			if (mine === seq) view = loaded;
		} catch {
			if (mine === seq) view = null;
		}
	}

	$effect(() => {
		void load(workspaceId, language, ready);
	});
	$effect(() => {
		const id = workspaceId;
		const lang = language;
		const isReady = ready;
		const again = (touched: number): void => {
			if (id !== null && (touched === id || touched === ALL_WORKSPACES)) void load(id, lang, isReady);
		};
		const offLog = session.events.onChange(again);
		const offWrite = onStudyChange(session.study, again);
		return () => {
			offLog();
			offWrite();
		};
	});

	function dismiss(): void {
		const shown = view;
		if (shown === null || shown.workspaceId !== workspaceId) return;
		view = { ...shown, plan: { kind: 'none' } };
		void markSeen(session, shown);
	}
</script>

<!-- Always rendered: the status region must exist before the card's text arrives. -->
<MilestoneCard {view} ondismiss={dismiss} />
