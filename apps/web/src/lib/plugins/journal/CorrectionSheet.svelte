<script lang="ts">
	// The phone's correction sheet (#103): the shared lib/ui Sheet, labelled
	// "Correction n of total", holding the expanded note. Swipe or the arrow
	// keys page through the corrections in text order; closing returns focus
	// to the mark of the correction shown last. The ideas variant uses the
	// same Sheet.
	import { t } from '$lib/i18n';
	import Sheet from '$lib/ui/Sheet.svelte';
	import type { Correction } from './corrections';
	import { nextId } from './corrections';
	import CorrectionNote from './CorrectionNote.svelte';
	import IdeasPanel from './IdeasPanel.svelte';
	import type { AiGate } from './editorLogic';

	let {
		mode,
		corrections,
		openId,
		onopen,
		onclose,
		studyLang,
		explanationLang,
		workspaceId,
		gate,
		onstart
	}: {
		mode: 'corrections' | 'ideas';
		corrections: Correction[];
		openId: string | null;
		onopen: (id: string | null) => void;
		onclose: () => void;
		studyLang: string;
		explanationLang: string;
		workspaceId?: number;
		gate?: AiGate;
		onstart?: (title: string) => void;
	} = $props();

	let sheetOpen = $state(true);
	let lastId = $state<string | null>(null);

	$effect(() => {
		if (openId !== null) lastId = openId;
	});

	const current = $derived(corrections.find((c) => c.annotation.id === openId) ?? null);
	const label = $derived(
		mode === 'ideas'
			? t('journal.list.ideasToday')
			: current === null
				? t('journal.margin.corrections', { count: corrections.length })
				: t('journal.sheet.position', { n: current.index + 1, total: corrections.length })
	);

	function page(direction: -1 | 1): void {
		if (openId === null) return;
		const next = nextId(corrections, openId, direction);
		if (next !== null) onopen(next);
	}

	function close(): void {
		const id = lastId;
		sheetOpen = false;
		onclose();
		queueMicrotask(() => {
			if (id !== null) document.getElementById(`mark-${id}`)?.focus();
		});
	}
</script>

{#if mode === 'ideas' || current !== null}
	<Sheet bind:open={sheetOpen} {label} onclose={close} onnext={() => page(1)} onprev={() => page(-1)}>
		{#if mode === 'ideas' && workspaceId !== undefined && gate !== undefined && onstart !== undefined}
			<IdeasPanel {workspaceId} {gate} {onstart} title={t('journal.list.ideasToday')} />
		{:else if current !== null}
			<div class="correction" id={`correction-${current.annotation.id}`}>
				<CorrectionNote
					correction={current}
					open={true}
					onopen={() => {}}
					{explanationLang}
					{studyLang}
					id={`sheet-${current.annotation.id}`}
				/>
			</div>
		{/if}
	</Sheet>
{/if}
