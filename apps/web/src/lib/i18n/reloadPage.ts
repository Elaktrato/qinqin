// A full reload after the interface language changed: the catalogue is chosen once, before the app mounts (spec
// Ruling: `t` is no store). Its own module so tests can replace it.
export function reloadPage(): void {
	location.reload();
}
