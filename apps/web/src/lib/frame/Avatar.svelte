<script lang="ts">
	// The account's avatar (design §9): the profile picture (#189) when there
	// is one and it has loaded, else the name's first letter in a circle — also
	// when the picture fails to load or to show. Decorative by default: the
	// control around it carries the name; `alt` names it where it stands alone.
	import { avatarObjectUrl } from '$lib/api/avatar';
	import { existingApp } from '$lib/context/context';
	import { AVATAR_PX, avatarSrc, type AvatarSize } from './avatarImage';

	let {
		name,
		size = 'm',
		src = null,
		alt = ''
	}: { name: string; size?: AvatarSize; src?: string | null; alt?: string } = $props();

	const session = existingApp()?.session ?? null;

	// The first user-perceived character (a grapheme: a letter with its
	// combining marks, a flag, a ZWJ emoji), else the first code point where
	// Intl.Segmenter is missing. Upper-cased only when that keeps it one
	// character long (ß would become SS).
	function firstGrapheme(text: string): string | undefined {
		if (typeof Intl.Segmenter === 'function') {
			for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) return segment;
			return undefined;
		}
		return Array.from(text)[0];
	}

	function upper(char: string): string {
		const up = char.toLocaleUpperCase();
		return up.length === char.length ? up : char;
	}

	const initial = $derived(upper(firstGrapheme(name.trim()) ?? '?'));
	const file = $derived(
		src ? avatarSrc(src, AVATAR_PX[size], typeof window === 'undefined' ? 1 : window.devicePixelRatio) : null
	);

	let shown = $state<string | null>(null);
	let broken = $state<string | null>(null);

	$effect(() => {
		const want = file;
		shown = null;
		if (want === null || session === null) return;
		let live = true;
		avatarObjectUrl(session.caches.avatars, want).then(
			(url) => {
				if (live) shown = url;
			},
			() => undefined // the letter stays
		);
		return () => {
			live = false;
		};
	});
</script>

<span
	class="avatar {size}"
	aria-hidden={alt ? undefined : 'true'}
	role={alt ? 'img' : undefined}
	aria-label={alt || undefined}
	>{#if shown && shown !== broken}<img src={shown} alt="" onerror={() => (broken = shown)} />{:else}{initial}{/if}</span
>

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 1.75rem;
		height: 1.75rem;
		overflow: hidden;
		border-radius: 50%;
		background: var(--selected-wash);
		color: var(--reading-accent);
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
		line-height: 1;
	}
	.l {
		width: 2.25rem;
		height: 2.25rem;
		font-size: 1rem;
	}
	.xl {
		width: 6rem;
		height: 6rem;
		font-size: 2.5rem;
	}
	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	@media (forced-colors: active) {
		.avatar {
			border: 1px solid CanvasText;
		}
	}
</style>
