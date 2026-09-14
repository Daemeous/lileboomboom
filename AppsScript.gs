/* ============================================================================
   lileboomboom — Apps Script backend.

   This file is a TEMPLATE. It is not executed from GitHub — copy its
   contents into the Sheet's own Apps Script project (Extensions > Apps
   Script), not the other way around. Never paste a real passcode into this
   copy of the file before committing it back here; this repo is public
   (GitHub Pages needs that), so anything committed is world-readable.

   One-time setup, done once inside the Apps Script editor itself (this
   step never touches GitHub):
     1. Open the Sheet > Extensions > Apps Script.
     2. Paste this file's contents in as Code.gs.
     3. Temporarily set PLAINTEXT_PASSCODE below to the real passcode.
     4. Run the "setPasscode" function once (Run menu > setPasscode).
     5. Clear PLAINTEXT_PASSCODE back to "" and save. The hash is now
        stored in Script Properties — the plaintext is never stored
        anywhere, including in the Apps Script project itself.
     6. Deploy > New deployment > type "Web app".
          Execute as: Me
          Who has access: Anyone
     7. Copy the resulting /exec URL into index.html's APPS_SCRIPT_URL.

   All reads and writes require a session token minted by "login" — unlike
   the pothole app's public CSV pattern, nothing here is readable without
   the passcode, so the Sheet's own "Publish to web" setting should be
   switched OFF for this Sheet (it isn't used by this app at all).
   ============================================================================ */

const PLAINTEXT_PASSCODE = ""; // fill in only long enough to run setPasscode() once, then clear
const SESSION_HOURS = 6;
const BILLS_SHEET = "Bills";
const NOTES_SHEET = "Notes";

function setPasscode() {
  if (!PLAINTEXT_PASSCODE) throw new Error("Set PLAINTEXT_PASSCODE first, run this, then clear it.");
  PropertiesService.getScriptProperties().setProperty("PASSCODE_HASH", sha256(normalizePasscode(PLAINTEXT_PASSCODE)));
  Logger.log("Passcode stored. Clear PLAINTEXT_PASSCODE now and save.");
}

function sha256(text) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return raw.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}

// Lowercases and strips everything but letters/digits, so "Godric's Hollow",
// "GodricsHollow" and "Godrics Hollow" all normalize to the same passcode.
function normalizePasscode(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getSS() { return SpreadsheetApp.getActiveSpreadsheet(); }

function ensureSheets() {
  const ss = getSS();
  if (!ss.getSheetByName(BILLS_SHEET)) {
    const sh = ss.insertSheet(BILLS_SHEET);
    sh.appendRow(["id", "name", "amount", "due_day", "priority", "status", "notes", "photo_url", "updated"]);
  }
  if (!ss.getSheetByName(NOTES_SHEET)) {
    const sh = ss.insertSheet(NOTES_SHEET);
    sh.appendRow(["id", "page_order", "content", "updated"]);
    sh.appendRow([Utilities.getUuid(), 1, "", new Date().toISOString()]);
  }
}

function doPost(e) {
  ensureSheets();
  const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  try {
    const result = route(body);
    return json(Object.assign({ ok: true }, result));
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route(body) {
  if (body.action === "login") return login(body.passcode);
  requireAuth(body.token);
  switch (body.action) {
    case "listBills":     return { bills: listBills() };
    case "saveBill":      return { bill: saveBill(body.bill) };
    case "deleteBill":    return deleteBill(body.id);
    case "listNotes":     return { notes: listNotes() };
    case "upsertNote":    return upsertNote(body.note);
    case "deleteNotePage": return deleteNotePage(body.id);
    default: throw new Error("Unknown action.");
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────
function login(passcode) {
  const expected = PropertiesService.getScriptProperties().getProperty("PASSCODE_HASH");
  if (!expected || sha256(normalizePasscode(passcode)) !== expected) throw new Error("Incorrect code.");
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("tok_" + token, "1", SESSION_HOURS * 3600);
  return { token: token };
}
function requireAuth(token) {
  if (!token || !CacheService.getScriptCache().get("tok_" + token)) throw new Error("Session expired — please log in again.");
}

// ── Bills ─────────────────────────────────────────────────────────────────
function billsSheet() { return getSS().getSheetByName(BILLS_SHEET); }
function listBills() {
  const rows = billsSheet().getDataRange().getValues();
  return rows.slice(1).filter(r => r[0]).map(r => ({
    id: r[0], name: r[1], amount: r[2], dueDay: r[3], priority: r[4],
    status: r[5], notes: r[6], photoUrl: r[7], updated: r[8]
  }));
}
// Honors a client-supplied id for BOTH update and create. This matters for
// the offline queue (see api.js): the client mints the id the moment a bill
// is created, whether or not it's online at that instant, so a queued
// create that syncs later lands under the same id the UI has already been
// showing — no reconciliation step needed after a delayed sync.
function saveBill(b) {
  const sh = billsSheet();
  const rows = sh.getDataRange().getValues();
  let photoUrl = b.photoUrl || "";
  if (b.photoBase64) photoUrl = uploadPhoto(b.photoBase64, b.photoMimeType || "image/jpeg");
  const now = new Date().toISOString();
  const id = b.id || Utilities.getUuid();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sh.getRange(i + 1, 1, 1, 9).setValues([[id, b.name, b.amount, b.dueDay, b.priority, b.status, b.notes || "", photoUrl, now]]);
      return { id: id, photoUrl: photoUrl };
    }
  }
  sh.appendRow([id, b.name, b.amount, b.dueDay, b.priority, b.status, b.notes || "", photoUrl, now]);
  return { id: id, photoUrl: photoUrl };
}
function deleteBill(id) {
  const sh = billsSheet();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) { sh.deleteRow(i + 1); break; }
  }
  return {};
}

// ── Photos ────────────────────────────────────────────────────────────────
function photosFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("PHOTOS_FOLDER_ID");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const folder = DriveApp.createFolder("lileboomboom-photos");
  props.setProperty("PHOTOS_FOLDER_ID", folder.getId());
  return folder;
}
function uploadPhoto(base64, mimeType) {
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, Utilities.getUuid() + ".jpg");
  const file = photosFolder().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return "https://drive.google.com/uc?export=view&id=" + file.getId();
}

// ── Notes ─────────────────────────────────────────────────────────────────
function notesSheet() { return getSS().getSheetByName(NOTES_SHEET); }
function listNotes() {
  const rows = notesSheet().getDataRange().getValues();
  return rows.slice(1).filter(r => r[0])
    .map(r => ({ id: r[0], pageOrder: r[1], content: r[2], updated: r[3] }))
    .sort((a, b) => a.pageOrder - b.pageOrder);
}
// Upsert, same client-id-wins reasoning as saveBill: the client mints a
// page's id (and its pageOrder) when it creates the page, online or not, so
// a page created offline and synced later keeps the id the UI already used.
function upsertNote(n) {
  const sh = notesSheet();
  const rows = sh.getDataRange().getValues();
  const now = new Date().toISOString();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === n.id) {
      sh.getRange(i + 1, 3).setValue(n.content || "");
      sh.getRange(i + 1, 4).setValue(now);
      return { id: n.id };
    }
  }
  const maxOrder = rows.slice(1).reduce((m, r) => Math.max(m, Number(r[1]) || 0), 0);
  sh.appendRow([n.id, n.pageOrder || (maxOrder + 1), n.content || "", now]);
  return { id: n.id };
}
function deleteNotePage(id) {
  const sh = notesSheet();
  const rows = sh.getDataRange().getValues();
  if (rows.length <= 2) throw new Error("Can't delete the only page.");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) { sh.deleteRow(i + 1); break; }
  }
  return {};
}
