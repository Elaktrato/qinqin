<script lang="ts">
	// The milestone card on home: the current workspace's log families only
	// (no replay). Loads once the plugin states are ready, again on a study
	// write or a posted event of the workspace; a slower answer for another
	// workspace is dropped.
	import { onEventLogChange } from '$lib/events';
	import { pluginStates } from '$lib/plugins/states';
	import { ALL_WORKSPACES, onStudyWrite } from '$lib/study/store';
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
		const offWrite = onStudyWrite(again);
		return () => {
			offLog();
			offWrite();
		};
	});

	function dismiss(): void {
		const shown = view;
		if (shown === null || workspaceId === null) return;
		view = { ...shown, plan: { kind: 'none' } };
		void markSeen(workspaceId, shown);
	}
</script>

{#if view !== null}
	<MilestoneCard {view} ondismiss={dismiss} />
{/if}
