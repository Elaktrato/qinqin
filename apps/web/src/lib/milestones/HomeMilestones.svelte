<script lang="ts">
	// The milestone card on home: the current workspace's log families only
	// (no replay). Loads once the plugin states are ready, again on a study
	// write or a posted event of the workspace; a slower answer for another
	// workspace is dropped.
	import { untrack } from 'svelte';
	import { onEventLogChange } from '$lib/events';
	import { pluginStates } from '$lib/plugins/states';
	import { ALL_WORKSPACES, onStudyChange } from '$lib/study/data';
	import { workspaces } from '$lib/workspaces';
	import MilestoneCard from './MilestoneCard.svelte';
	import { loadMilestones, markSeen, type MilestonesView } from './loadMilestones';

	let view = $state.raw<MilestonesView | null>(null);
	let seq = 0;

	const workspaceId = $derived($workspaces.current?.id ?? null);
	const language = $derived($workspaces.current?.language ?? '');
	const ready = $derived($pluginStates.status === 'ready');

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
			const loaded = await loadMilestones(id, { scope: 'home', language: lang });
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
		const offLog = onEventLogChange(again);
		const offWrite = onStudyChange(again);
		return () => {
			offLog();
			offWrite();
		};
	});

	function dismiss(): void {
		const shown = view;
		if (shown === null || shown.workspaceId !== workspaceId) return;
		view = { ...shown, plan: { kind: 'none' } };
		void markSeen(shown);
	}
</script>

<!-- Always rendered: the status region must exist before the card's text arrives. -->
<MilestoneCard {view} ondismiss={dismiss} />
