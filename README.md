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

### 5. Add to phone home screen
Open the Pages URL on her phone in Safari (iOS) or Chrome (Android) → Share/menu → **Add to Home Screen**. It launches full-screen like a normal app, under the generic name/icon.

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

### Working offline

Adding/editing/deleting a bill or a notepad page works with no signal. Each is identified by an id generated on the phone itself (not by the server), so a change made offline queues in `localStorage` and replays automatically once back online (checked on reconnect, and every 30s while anything's queued) — no data is lost, and nothing needs to be redone. A yellow bar under the header shows how many changes are waiting to sync. Bill photos are included in the queued write itself, so a handful of queued photos is fine, but this isn't meant for a large backlog — `localStorage` has only a few MB to work with per browser.

⚠️ If you already deployed an earlier version of `AppsScript.gs` (one with separate `saveNotePage`/`addNotePage` actions instead of `upsertNote`, or a `saveBill` that always generated its own id for new rows), **redeploy it** — this version changed the API shape and older deployed code won't match `api.js` anymore. Apps Script deployments don't auto-update from GitHub, so: paste the current `AppsScript.gs` back into the Apps Script editor's `Code.gs`, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. This keeps the same `/exec` URL, so `index.html` doesn't need to change.

## Data model (Google Sheet tabs, auto-created on first request)

- **Bills**: `id, name, amount, due_day, priority (High/Medium/Low), status (Paid/Unpaid), notes, photo_url, updated`
- **Notes**: `id, page_order, content, updated`

Photos are uploaded via the Apps Script to a Drive folder (`lileboomboom-photos`, created automatically) and linked by URL.

## License

Same as this author's other small projects: [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/).
