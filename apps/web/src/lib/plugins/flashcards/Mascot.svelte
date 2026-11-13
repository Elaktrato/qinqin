<script lang="ts" module>
	// One HEAD probe per asset path for the whole page lifetime. Static
	// art is optional and not bundled, so most installs get the placeholder.
	const probes = new Map<string, Promise<boolean>>();

	function probe(path: string): Promise<boolean> {
		let known = probes.get(path);
		if (known === undefined) {
			known = (async () => {
				try {
					const response = await fetch(path, { method: 'HEAD' });
					// An SPA fallback answers a missing file with index.html and
					// 200, so only a real image content type counts.
					const type = response.headers.get('content-type') ?? '';
					return response.ok && type.toLowerCase().startsWith('image/');
				} catch {
					return false;
				}
			})();
			probes.set(path, known);
		}
		return known;
	}
</script>

<script lang="ts">
	import { mascotState, type MascotMood } from '$lib/study/mascot';

	let {
		level,
		streak,
		todayDone,
		size = 64
	}: { level: number; streak: number; todayDone: boolean; size?: number } = $props();

	const buddy = $derived(mascotState({ level, streak, todayDone }));
	const label = $derived(`Study buddy, stage ${buddy.stage}, ${buddy.mood}`);

	// Which path is known to exist; anything else shows the placeholder.
	let available = $state<string | null>(null);

	$effect(() => {
		const path = buddy.assetPath;
		let stale = false;
		void probe(path).then((ok) => {
			if (!stale) available = ok ? path : null;
		});
		return () => {
			stale = true;
		};
	});

	const TINT: Record<MascotMood, string> = {
		sleepy: '#7b8aa0',
		happy: '#2ea043',
		proud: '#0b6bcb',
		cheering: '#ef8f00'
	};
</script>

{#if available === buddy.assetPath}
	<img src={buddy.assetPath} alt={label} width={size} height={size} class="mascot" />
{:else}
	<svg class="mascot" role="img" aria-label={label} width={size} height={size} viewBox="0 0 64 64">
		<circle
			cx="32"
			cy="32"
			r="28"
			fill={TINT[buddy.mood]}
			fill-opacity="0.25"
			stroke={TINT[buddy.mood]}
			stroke-width="3"
		/>
		{#if buddy.mood === 'sleepy'}
			<path
				d="M20 28 q4 4 8 0 M36 28 q4 4 8 0"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
			/>
			<path d="M26 44 h12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
		{:else}
			<circle cx="24" cy="28" r="3" fill="currentColor" />
			<circle cx="40" cy="28" r="3" fill="currentColor" />
			{#if buddy.mood === 'cheering'}
				<ellipse cx="32" cy="43" rx="7" ry="6" fill="currentColor" />
			{:else}
				<path d="M24 40 q8 8 16 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
			{/if}
		{/if}
	</svg>
{/if}

<style>
	.mascot {
		flex: none;
		display: block;
		color: inherit;
	}
</style>
