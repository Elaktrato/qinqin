<script lang="ts">
	// The account's avatar (design §9): the name's first letter in a circle.
	// Always decorative: the button around it carries the name.
	let { name, size = 'm' }: { name: string; size?: 'm' | 'l' } = $props();

	const initial = $derived((Array.from(name.trim())[0] ?? '?').toLocaleUpperCase());
</script>

<span class="avatar {size}" aria-hidden="true">{initial}</span>

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: var(--raised);
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--hair);
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
		line-height: 1;
	}
	.l {
		width: 2.25rem;
		height: 2.25rem;
		font-size: 1rem;
	}
	@media (forced-colors: active) {
		.avatar {
			border: 1px solid CanvasText;
		}
	}
</style>
