// The whole app is a client-side SPA served by the Go binary: no server
// rendering, no prerendering, so every route is an entry into the router.
// Auth is client-only too: the layout hydrates `qinqin.token` from
// localStorage in onMount, which only runs with SSR off.
export const ssr = false;
export const prerender = false;
