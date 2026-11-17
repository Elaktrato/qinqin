<script lang="ts">
	// A line icon of the set (design §5): 24 grid, stroke 1.5, currentColor.
	// The shapes are Lucide's (lib/ui/icons/lucide.ts, ISC; credited on the
	// Sources page). Decorative unless `label` is given: next to visible text,
	// or inside a button that has its own name, leave `label` out.
	//
	// API: <Icon name size? label? />
	//   name   one of IconName (lib/ui/icons/lucide.ts)
	//   size   's' | 'm' | 'l' (--icon-s/m/l: 16/20/24px; default 'm') or px
	//   label  makes it an image with that accessible name
	//   class  extra classes for the caller's :global() styling
	import { ICONS, type IconName } from './icons/lucide';

	let {
		name,
		size = 'm',
		label,
		class: className = ''
	}: { name: IconName; size?: 's' | 'm' | 'l' | number; label?: string; class?: string } = $props();

	const px = $derived(typeof size === 'number' ? size : undefined);
</script>

<svg
	class="icon {typeof size === 'number' ? '' : `size-${size}`} {className}"
	viewBox="0 0 24 24"
	width={px}
	height={px}
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	{#each ICONS[name] as [tag, attrs], i (i)}
		<svelte:element this={tag} {...attrs} />
	{/each}
</svg>

<style>
	.icon {
		flex: none;
		display: block;
	}
	.size-s {
		width: var(--icon-s);
		height: var(--icon-s);
	}
	.size-m {
		width: var(--icon-m);
		height: var(--icon-m);
	}
	.size-l {
		width: var(--icon-l);
		height: var(--icon-l);
	}
</style>
