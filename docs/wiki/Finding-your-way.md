# Finding your way

Every signed-in page sits in the same frame. On a screen 720 px wide or more it is a raised page under a top bar; below 720 px (a phone) it is a slim bar at the top, with the sections in a bar at the bottom or in a side menu. There is no footer.

## The top bar (720 px and wider)

- **The logo**, on the left, is the link to the home page (its tooltip says "Home"). There is no separate Home icon.
- **The sections**, in the middle, as icons. Hover or focus one to see its name. In order:
  1. **Search** (also the place of entries and the [lookup history](Searching-and-entries#lookup-history)),
  2. **Decks**, **Reader**, **Journal** and **Grammar**, unless you switched them off in Settings → Features,
  3. **Stats**, always last.

  The current section has an accent-coloured icon with a small dot. Until your settings have loaded only Search and Stats show, so a feature you switched off never flashes in.
- **On the right**: the flag of the current workspace and your avatar.

## On a phone (under 720 px)

A phone shows the sections either in a **bottom bar** (the default) or in a **side menu**; you choose in Settings → Layout.

With the **bottom bar**, the sections are at the bottom of the screen and the top bar has **the logo** on the left (a link to the home page, as on the desktop), the page's own buttons, the workspace flag and your avatar (the account menu). The top bar shows no section or page name: the bottom bar marks the section, and the page's heading names the page.

With the **side menu**, the top bar has the **menu button**, the title of the page and the workspace flag. The menu button opens a drawer:

- at the top, your workspaces as a row of flags (tap one to switch) and **+** (**Add workspace**, which opens Settings → Workspaces); the current workspace is named under the row,
- the sections with their names: **Home** first (there is no logo to tap), then the same sections as on the desktop, Stats last,
- at the bottom, your account: the avatar opens the account menu, beside your name and a Settings button.

The drawer closes when you follow a link or switch workspace, with Escape, by tapping outside it, by swiping it toward the edge, or when the window grows to the desktop width. While it is open, keyboard focus stays inside it (it starts on the current workspace's flag) and returns to the menu button afterwards.

## The workspace flag

The flag opens the workspace menu: each workspace with its flag, language and name, a check on the current one, and **Manage workspaces**, which opens Settings → Workspaces (where new ones are made). A single workspace without a name shows only its flag. See [Workspaces and languages](Workspaces-and-languages).

## The account menu

The avatar opens it. It names you and offers:

- **Settings** ([Settings tour](Settings-tour)),
- **Theme: <current theme>**, a quick switch between the themes of the light or dark mode you see now, with **Appearance settings…** at the end ([Appearance and themes](Appearance-and-themes)),
- **Admin settings**, for administrators,
- **Sources**: credits and licences of all data and software in use,
- **Sign out** (if reviews made offline have not been sent yet, qinqin asks first, see [Install and offline](Install-and-offline#several-people-on-one-device)).

Settings, Sources and the account pages are reached from here; they belong to no section.

## The home page

The home page greets you by the time of day on your device ("Good morning"), shows today's date in your study day, and has a search box (**Search entries…**) that opens Search. Below it come a card for new [milestones](Milestones), when there are any, and your widgets ([Settings → Home](Settings-tour#home) chooses them). If none of your widgets fits the current workspace, the page says so and links to Settings.

## Pages you can open without signing in

The **Sources** page (`/sources`) is open to everyone, so the licence and attribution credits can always be read. Signed out it shows a small bar with the logo and **Sign in**; signed in it has the usual frame. `/login` and `/register` are for signed-out visitors only; every other page asks you to sign in.

A session that must do one thing first (choose a new password an administrator asked for, or set up a required two-step sign-in) sees only that page; its account menu has Sources and Sign out only.

## Switched-off features

A page of a feature you switched off (Decks, Reader) says "You switched this off for yourself" with a link to Settings → Features. Nothing was deleted.

## Keyboard and screen readers

- The first Tab stop on every page is **Skip to content**, which moves focus to the page itself.
- The logo is named "qinqin, home". Every icon-only control (sections, flag, avatar, menu button) has a name and a tooltip, and the current section is marked for screen readers.
- Menus open with Enter or Space and are moved through with the arrow keys; Escape closes them.
- Every page has its own title in the browser tab ("Characters · Stats · qinqin").

## Old addresses

Links from older versions keep working: `/p/flashcards` opens the Decks page, `/p/reader` the Reader, `/p/journal` the Journal, `/p/grammar` Grammar, `/study/map` opens Stats → Characters, and `/study` opens the study modal over the home page. Any other `/p/…` address is gone.
