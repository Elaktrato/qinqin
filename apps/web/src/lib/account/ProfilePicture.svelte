<script lang="ts">
	// Settings → Account → Profile: the profile picture (#189,
	// docs/contracts/auth/avatar.json). Choose a file (on a phone the file input
	// offers the camera and the photo picker), crop it to a square with drag
	// and zoom (mouse, touch, keyboard; the crop rules are lib/account/avatarCrop.ts),
	// save, replace or remove. The cropped square is drawn on a canvas and
	// uploaded; the server decodes it and stores fresh files.
	import { tick } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { removeAvatar, uploadAvatar } from '$lib/api/avatar';
	import { useApp } from '$lib/context/context';
	import Avatar from '$lib/frame/Avatar.svelte';
	import { t } from '$lib/i18n';
	import { Button } from '$lib/ui';
	import {
		MAX_ZOOM,
		imageBox,
		initialCrop,
		keyStep,
		panBy,
		pinchZoom,
		sourceRect,
		wheelZoom,
		zoomTo,
		type Crop,
		type Point
	} from './avatarCrop';
	import { cropToBlob } from './avatarPicture';

	const app = useApp();
	const uid = $props.id();
	const VIEW = 240; // the crop view's side in CSS px

	let input = $state<HTMLInputElement>();
	let area = $state<HTMLElement>();
	let chooser = $state<HTMLElement>();
	let picture = $state<HTMLImageElement>();
	let objectUrl = $state<string | null>(null);
	let crop = $state<Crop | null>(null);
	let busy = $state(false);
	let error = $state('');
	let done = $state('');

	const user = $derived(app.auth.user);
	const hasPicture = $derived(!!user?.avatarUrl);
	const box = $derived(crop ? imageBox(crop) : null);

	function discard(): void {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = null;
		crop = null;
		pointers.clear();
		pinch = null;
	}

	$effect(() => () => {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
	});

	function choose(event: Event): void {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		(event.currentTarget as HTMLInputElement).value = '';
		if (!file) return;
		discard();
		error = done = '';
		objectUrl = URL.createObjectURL(file);
	}

	async function loaded(): Promise<void> {
		if (!picture || !picture.naturalWidth || !picture.naturalHeight) {
			unreadable();
			return;
		}
		crop = initialCrop(picture.naturalWidth, picture.naturalHeight, VIEW);
		await tick();
		area?.focus();
	}

	function unreadable(): void {
		discard();
		error = t('settings.account.avatar.error.read');
	}

	async function back(): Promise<void> {
		discard();
		await tick();
		chooser?.focus();
	}

	// Pointers (mouse, pen, fingers) on the crop area: one drags, two pinch.
	const pointers = new Map<number, Point>();
	let pinch: { zoom: number; distance: number } | null = null;

	function local(event: PointerEvent): Point {
		const r = area?.getBoundingClientRect();
		return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
	}

	function spread(): { distance: number; mid: Point } {
		const [a, b] = [...pointers.values()];
		return { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
	}

	function down(event: PointerEvent): void {
		if (!crop) return;
		area?.setPointerCapture?.(event.pointerId);
		pointers.set(event.pointerId, local(event));
		if (pointers.size === 2) pinch = { zoom: crop.zoom, distance: spread().distance };
	}

	function move(event: PointerEvent): void {
		const last = pointers.get(event.pointerId);
		if (!crop || !last) return;
		const now = local(event);
		pointers.set(event.pointerId, now);
		if (pointers.size >= 2 && pinch) {
			const { distance, mid } = spread();
			crop = pinchZoom(crop, pinch, distance, mid);
		} else if (pointers.size === 1) {
			crop = panBy(crop, now.x - last.x, now.y - last.y);
		}
	}

	function up(event: PointerEvent): void {
		pointers.delete(event.pointerId);
		if (pointers.size < 2) pinch = null;
	}

	function wheel(event: WheelEvent): void {
		if (!crop) return;
		event.preventDefault();
		crop = wheelZoom(crop, event.deltaY, local(event as unknown as PointerEvent));
	}

	function keys(event: KeyboardEvent): void {
		if (!crop) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			void back();
			return;
		}
		const next = keyStep(crop, event.key, event.shiftKey);
		if (next === null) return;
		event.preventDefault();
		crop = next;
	}

	async function save(): Promise<void> {
		if (!crop || !picture || busy) return;
		busy = true;
		error = done = '';
		try {
			await uploadAvatar(await cropToBlob(picture, sourceRect(crop)));
			await app.auth.loadMe();
			done = t('settings.account.avatar.saved');
			await back();
		} catch (err) {
			error = errorText(err, t('settings.account.avatar.error.save'));
		} finally {
			busy = false;
		}
	}

	async function remove(): Promise<void> {
		if (busy) return;
		busy = true;
		error = done = '';
		try {
			await removeAvatar();
			await app.auth.loadMe();
			done = t('settings.account.avatar.removed');
			await tick();
			chooser?.focus();
		} catch (err) {
			error = errorText(err, t('settings.account.avatar.error.remove'));
		} finally {
			busy = false;
		}
	}
</script>

<div class="picture" role="group" aria-labelledby="{uid}-label">
	<p class="label" id="{uid}-label">{t('settings.account.avatar.label')}</p>
	{#if objectUrl}
		<!-- The crop view: a focusable area that takes pointer, wheel and key input (the hint says how). -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
		<div
			bind:this={area}
			class="crop"
			style:--view="{VIEW}px"
			role="application"
			tabindex="0"
			aria-roledescription={t('settings.account.avatar.cropArea')}
			aria-label={t('settings.account.avatar.cropArea')}
			aria-describedby="{uid}-crop-hint"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			onwheel={wheel}
			onkeydown={keys}
		>
			<img
				bind:this={picture}
				src={objectUrl}
				alt=""
				draggable="false"
				onload={loaded}
				onerror={unreadable}
				style:left="{box?.left ?? 0}px"
				style:top="{box?.top ?? 0}px"
				style:width={box ? `${box.width}px` : undefined}
				style:height={box ? `${box.height}px` : undefined}
				style:visibility={box ? 'visible' : 'hidden'}
			/>
			<span class="ring" aria-hidden="true"></span>
		</div>
		<p class="hint" id="{uid}-crop-hint">{t('settings.account.avatar.cropHint')}</p>
		<label class="zoom">
			{t('settings.account.avatar.zoom')}
			<input
				type="range"
				min="1"
				max={MAX_ZOOM}
				step="0.01"
				value={crop?.zoom ?? 1}
				disabled={!crop}
				oninput={(e) => crop && (crop = zoomTo(crop, Number((e.currentTarget as HTMLInputElement).value)))}
			/>
		</label>
		<div class="actions">
			<Button variant="primary" busy={busy} disabled={!crop} onclick={save}
				>{busy ? t('settings.account.avatar.saving') : t('settings.account.avatar.save')}</Button
			>
			<Button disabled={busy} onclick={back}>{t('common.action.cancel')}</Button>
		</div>
	{:else}
		<div class="current">
			<Avatar name={user?.username ?? ''} size="xl" src={user?.avatarUrl ?? null} alt={t('settings.account.avatar.current')} />
			<div class="stack">
				<p class="hint">{t('settings.account.avatar.hint')}</p>
				<div class="actions">
					<Button bind:element={chooser} disabled={busy} onclick={() => input?.click()}
						>{hasPicture ? t('settings.account.avatar.replace') : t('settings.account.avatar.choose')}</Button
					>
					{#if hasPicture}
						<Button tone="danger" busy={busy} onclick={remove}
							>{busy ? t('settings.account.avatar.removing') : t('settings.account.avatar.remove')}</Button
						>
					{/if}
				</div>
			</div>
		</div>
	{/if}
	<!-- A plain file input: the browser's picker, and on a phone the camera or the photo picker. -->
	<input
		bind:this={input}
		class="visually-hidden"
		type="file"
		accept="image/jpeg,image/png,image/webp"
		tabindex="-1"
		aria-hidden="true"
		onchange={choose}
	/>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="ok" role="status">{done}</p>
</div>

<style>
	.picture {
		display: grid;
		gap: var(--space-3);
		margin-block: var(--space-3);
	}
	.label {
		margin: 0;
		font-weight: var(--weight-strong);
	}
	.current {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}
	.stack {
		display: grid;
		gap: var(--space-2);
		max-width: 24rem;
	}
	.crop {
		position: relative;
		width: var(--view);
		height: var(--view);
		max-width: 100%;
		overflow: hidden;
		touch-action: none;
		cursor: grab;
		background: var(--panel);
		border-radius: var(--radius);
		user-select: none;
	}
	.crop:active {
		cursor: grabbing;
	}
	.crop:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.crop img {
		position: absolute;
		max-width: none;
		pointer-events: none;
	}
	.ring {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		/* the square is uploaded; the circle shows what the round avatar shows */
		box-shadow: 0 0 0 999px color-mix(in srgb, var(--text) 45%, transparent);
		outline: 2px solid var(--panel);
		pointer-events: none;
	}
	.zoom {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
		max-width: 24rem;
	}
	.zoom input {
		flex: 1;
	}
	.hint {
		margin: 0;
		color: var(--readable-muted);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
	.ok {
		margin: 0;
		min-height: 1.2em;
	}
	@media (forced-colors: active) {
		.ring {
			box-shadow: none;
			border: 2px solid CanvasText;
		}
	}
</style>
