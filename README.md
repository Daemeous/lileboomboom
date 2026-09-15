# lileboomboom

A personal, passcode-protected notes app: bills with amounts/due dates/priority/photos/notes, a free-text notepad with multiple pages, and a plain calculator. Built to be used from a phone home-screen icon, not the Google Sheets mobile app.

Deliberately named and iconed to not look like a finance app — nothing in the title, icon, or page source says what it's for. All bill/note data lives in a private Google Sheet behind a passcode; the static site itself (this repo, hosted on GitHub Pages) contains no data at all.

## One-time setup

### 1. Apps Script backend
1. Open the Google Sheet this app uses, then **Extensions → Apps Script**.
2. Paste the contents of [`AppsScript.gs`](AppsScript.gs) in as `Code.gs`.
3. Temporarily set `PLAINTEXT_PASSCODE` at the top to the real passcode.
4. Run the `setPasscode` function once (Run menu → `setPasscode`, grant the permissions it asks for). This stores a hash of the passcode in Script Properties — the plaintext is never saved anywhere. The passcode is normalized before hashing (lowercased, spaces/punctuation stripped), and the login screen normalizes the same way, so `godrickshollow`, `Godric's Hollow`, `GodricsHollow` and `Godrics Hollow` are all treated as the same passcode.
5. Clear `PLAINTEXT_PASSCODE` back to `""` and save. **Never commit a real passcode to this repo** — it's public (GitHub Pages requires that for a free site), so anything committed is world-readable. `AppsScript.gs` in this repo is a template only; the live copy with your passcode set lives solely inside the Apps Script project, which is separate from GitHub.
6. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Copy the resulting `/exec` URL.

### 2. Point the site at your deployment
Edit `index.html`, replace `PASTE_APPS_SCRIPT_EXEC_URL_HERE` with the URL from step 7, commit and push.

### 3. Turn off "Publish to web" on the Sheet
This app never reads the Sheet's published CSV — every read and write goes through the passcode-gated Apps Script endpoint instead. If "File → Share → Publish to web" is still on for this Sheet from earlier setup, turn it off — otherwise anyone with that link can read the raw data with no passcode at all.

### 4. Enable GitHub Pages
Repo **Settings → Pages → Deploy from branch → `main` / root**. The site will be live at `https://daemeous.github.io/lileboomboom/`.

### 5. Add to her Android phone's home screen
1. Open the Pages URL (`https://daemeous.github.io/lileboomboom/`) in **Chrome** on her phone.
2. Log in once with the real passcode while she has signal — this is what lets offline logins work later (see below), so it has to happen online at least once.
3. Tap the **⋮** menu (top right) → **Add to Home screen** (on some versions of Chrome this shows up as a banner/popup on its own — "Install app" or "Add lileboomboom to Home screen" — either works the same way).
4. Confirm the name it offers (leave it as `lileboomboom`) → **Add** / **Install**.
5. An icon appears on her home screen like any other app. Opening it from there launches full-screen, with no browser address bar — Chrome itself isn't visibly involved.

No app store, no account, nothing to update manually — it always loads the current version from GitHub Pages when she has signal.

## How it works

| File | Purpose |
|------|---------|
| `index.html` | Config block (Apps Script URL, title) |
| `api.js` | Only module that talks to the Apps Script backend — sends the session token with every call |
| `core.js` | App logic: passcode gate, Bills/Notepad/Calculator tabs |
| `styles.css` | Mobile-first dark UI |
| `sw.js` | Offline shell for the static files only (never caches data requests) |
| `AppsScript.gs` | Backend template — see setup above |

The passcode is required on every visit (the session token lives only in memory, never `localStorage`), and every read/write requires that token — nothing is fetchable just by knowing the Apps Script URL.

### Decoy passcode

Entering `dobby` instead of the real passcode opens a harmless, Bills-free view — just the Notepad (seeded with a shopping list) and Calculator. It's checked entirely client-side before any network call is made, so it never touches the real Sheet, never mints a real session, and its notes live only in that browser's `localStorage` — completely separate from the real notepad's pages. Useful if someone insists on seeing what's behind the passcode.

### Recurring bills

Ticking "Recurring monthly" on a bill (in the add/edit form, or the checkbox on its card) means it comes back as Unpaid automatically at the start of each calendar month — no need to re-add it, and no new row gets created each month, so the list doesn't grow forever. This check runs on the phone whenever the app is opened (there's no server-side scheduler here), so it takes effect the next time the app is opened after the month rolls over, not at the exact stroke of midnight.

### Working offline — including logging in

Everything works with no signal, across as many separate app opens as needed — not just while the app happens to still be running:

- **Logging in offline.** The very first login on a phone has to happen online (see step 2 above) — that's what saves a local, one-way hash of the passcode on that phone (never the passcode itself). After that, entering the same passcode with no signal at all is checked against that local hash instead and unlocks the app. A blue bar appears saying "Unlocked offline — tap to sync once back online," because nothing can actually reach the Sheet yet: writes queue locally same as always, but need a real server round trip to actually land, which needs the real passcode typed once more while online (tapping that bar prompts for it). This is a deliberately weaker check than the real one — a copy of the passcode's hash now lives in that phone's storage — which is a reasonable trade for a phone that isn't itself a target, just glanced at.
- **Seeing your bills/notes offline.** Every successful sync also saves a local copy of the bill list and notepad pages, so reopening the app with zero signal — even after fully closing it, restarting the phone, anything — still shows things as of the last time it had a connection, instead of a blank screen.
- **Making changes offline.** Adding/editing/deleting a bill or a notepad page works the same whether online or not. Each is identified by an id generated on the phone itself (not by the server), so a change made offline queues in `localStorage` and replays automatically once back online *and* re-authenticated (checked on reconnect, and every 30s while anything's queued) — no data is lost, and nothing needs to be redone. A yellow bar under the header shows how many changes are waiting to sync. Bill photos are included in the queued write itself, so a handful of queued photos is fine, but this isn't meant for a large backlog — `localStorage` has only a few MB to work with per browser.

⚠️ **Redeploy `AppsScript.gs` again after this update** (same steps as below) — `saveBill` now writes two extra columns (`recurring`, `cycle_key`), and a currently-deployed older version won't accept them. Existing bill rows don't need any manual editing; the new columns just start getting used the next time each bill is saved.

**Redeploy steps** (also needed whenever `AppsScript.gs` changes going forward): paste the current `AppsScript.gs` into the Apps Script editor's `Code.gs`, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. This keeps the same `/exec` URL, so `index.html` doesn't need to change. Apps Script deployments don't auto-update from GitHub — this step is always manual.

If she's already added the icon to her home screen from an earlier version of this app, she doesn't need to redo that step — opening it once with signal picks up all of this automatically (the service worker now always prefers the live version over its cache when online, only falling back to the cached copy when there's truly no connection).

## Data model (Google Sheet tabs, auto-created on first request)

- **Bills**: `id, name, amount, due_day, priority (High/Medium/Low), status (Paid/Unpaid), notes, photo_url, updated, recurring, cycle_key`
- **Notes**: `id, page_order, content, updated`

Photos are uploaded via the Apps Script to a Drive folder (`lileboomboom-photos`, created automatically) and linked by URL.

## License

Same as this author's other small projects: [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/).
