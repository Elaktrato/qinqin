# Android pages checklist (#37)

For the owner, on a real phone with the debug APK (steps in `docs/wiki/Android.md`). Every page in the shell, in qinqin
Day and qinqin Night (Settings, Appearance, Mode: Light or Dark; the default themes are qinqin Day and qinqin Night).

**CI already covers** (job `extended`, suite `pages`, Pixel 6 emulator, 412 px wide, both themes; screenshots in the
artifact `android-emulator-extended`, files `pages-day-*.png` and `pages-night-*.png`): every page loads without an
uncaught error; no horizontal overflow; the bottom bar covers none of the last content; header text is not clipped;
the bar's items are at least 44 px; the theme switch works through Settings. **CI does not cover** what a person
judges: contrast and legibility, touch comfort, the real keyboard, the real status/navigation bar, fonts, notches,
rotation, a large system font size, TalkBack, a slow network. Look at those.

## Look at on every page (both themes)

1. Nothing sideways: the page does not scroll left and right; no clipped button or card at the right edge.
2. Status bar and navigation bar match the page colour (`chrome`), icons readable (dark icons on Day, light on Night).
3. The bottom bar sits above the system navigation bar, never covers the last line, keeps its current item marked.
4. Text readable at the default size and at the largest system font size (Settings, Display); the header title is not cut.
5. Tap targets comfortable with a thumb (about 44 px); nothing needs a precise tap.
6. The keyboard: opening a field does not hide it; the bar steps aside; closing the keyboard restores the layout.
7. Back button or gesture: closes a sheet, menu or dialog first, then goes back in history, then leaves the app.
8. Rotate to landscape and back: no lost state, no overlap.

## Pages

Tick Day and Night for each. "CI" = covered by the crawl for the invariants above; the last column is what to look for by eye.

| Page | Path | Day | Night | CI | Look for |
|---|---|---|---|---|---|
| Home | `/` | [ ] | [ ] | yes | widgets in order, the Study button, no empty gaps |
| Search | `/search` | [ ] | [ ] | yes | input and search button reachable with the keyboard open |
| Search results | `/search?q=` | [ ] | [ ] | yes | result rows, readings in the right script, the detail opens |
| Search by parts | `/search/parts` | [ ] | [ ] | yes | the parts grid is tappable, selected parts stand out |
| Entry | `/entry/<id>` | [ ] | [ ] | yes | readings, senses, characters, sentences; audio buttons |
| Lookup history | `/lookups` | [ ] | [ ] | yes | list, delete |
| Decks | `/flashcards` | [ ] | [ ] | yes | deck list and counts, add card |
| Study modal | `/study` (over Home) | [ ] | [ ] | yes | a bottom sheet; the chips; Start studying focused |
| Study advanced | `/study/advanced` | [ ] | [ ] | yes | every control reachable, Back returns to the modal |
| Study scheduling | `/study/scheduling` | [ ] | [ ] | yes | sliders and steppers usable by thumb |
| Study session | `/study/session` | [ ] | [ ] | partly | card front and back, grade buttons docked above the bar, Back regrades, the keyboard on a typing card |
| Writing card | in a session | [ ] | [ ] | touch only | the pad is square and fits, ink colour readable, scroll never steals a stroke |
| Tone card | in a session | [ ] | [ ] | touch only | pads, the contour drawn, Check |
| Reader library | `/reader` | [ ] | [ ] | yes | book cards, upload (the file picker opens) |
| Reader book | `/reader/book/<id>/<n>` | [ ] | [ ] | yes | text size, tap a word opens the sheet, the word stays above the sheet, long press selects |
| Reader sources | `/reader/sources` | [ ] | [ ] | yes | source list |
| Journal | `/journal` | [ ] | [ ] | yes | entries list, New entry |
| Journal editor | `/journal/new`, `/journal/e/<id>` | [ ] | [ ] | partly | editor with the keyboard open, saves while typing, corrections margin |
| Conversation | in the journal | [ ] | [ ] | no | the message box with the keyboard open |
| Grammar | `/grammar` | [ ] | [ ] | yes | lesson list or the empty message |
| Stats | `/stats` | [ ] | [ ] | yes | charts readable, no clipped labels |
| Stats, characters | `/stats/characters` | [ ] | [ ] | yes | the map, filters |
| Stats, week | `/stats/week` | [ ] | [ ] | yes | the week chart |
| Settings, Workspaces | `/settings?tab=workspaces` | [ ] | [ ] | yes | add and delete workspace dialogs |
| Settings, Layout | `?tab=layout` | [ ] | [ ] | yes | bottom bar vs side menu, drag to reorder with a finger (not tested by CI) |
| Settings, Appearance | `?tab=appearance` | [ ] | [ ] | yes | switching the mode repaints at once, system bars follow |
| Settings, Study | `?tab=study` | [ ] | [ ] | yes | all controls reachable |
| Settings, Features | `?tab=features` | [ ] | [ ] | yes | switches |
| Settings, Notifications | `?tab=notifications` | [ ] | [ ] | yes | the permission prompt, a reminder arrives |
| Settings, AI | `?tab=ai` | [ ] | [ ] | yes | provider form with the keyboard |
| Settings, Account | `?tab=account` | [ ] | [ ] | yes | Offline status, downloads open Android's save screen |
| Settings, Data (admin) | `?tab=data` | [ ] | [ ] | yes | packs list |
| Settings, Admin (admin) | `?tab=admin` and `&section=` users, invites, email, security, backup, updates | [ ] | [ ] | yes | tables do not overflow sideways |
| Sources | `/sources` | [ ] | [ ] | yes | licence texts wrap |
| Change password | `/account/password` | [ ] | [ ] | yes | password manager fill works |
| Two-factor setup | `/account/two-factor-setup` | [ ] | [ ] | yes | the secret and the QR fit |
| Sign in | `/login` | [ ] | [ ] | partly | the keyboard, autofill |
| Register, Reset | `/register`, `/reset` | [ ] | [ ] | no | forms with the keyboard |
| First-run screen | shell | [ ] | [ ] | partly | address field, the http warning, Try again, Change server |

## Dialogs, sheets and menus

Open each, check both themes, then close with the back button: the **More** sheet, the **account menu** (and its theme
level), the **workspace menu**, the **study modal**, the **reader lookup sheet** and its history, the **highlight
editor**, the **delete workspace** dialog, the **sign-out** confirmation (with unsent reviews), the **Change server**
screen. CI opens More, the account menu, the study modal and the reader sheet and closes them with the back button; it
does not look at the others.

Record problems as issues with a screenshot; fix web issues that appear only in the WebView in `apps/web`.
