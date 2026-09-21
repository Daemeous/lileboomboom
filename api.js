/* ============================================================================
   api.js — Backend abstraction for lileboomboom.

   The only module that talks to the Apps Script web app. core.js never
   builds a request payload itself — this split means the backend can be
   swapped later without touching core.js.

   A real session token is only ever minted by the server and only ever
   lives in memory — never persisted — so a fresh page load always starts
   logged out, and every read/write while online is checked against the
   real passcode every time, as required.

   Offline login: a passcode typed with no signal at all can't be checked
   by the server, so after every successful ONLINE login this also stores
   a local hash of the passcode (never the passcode itself) in localStorage.
   Typing the same passcode again with no signal is verified against that
   hash instead, unlocking an "offline session" — read from cache, queue
   writes — with no real token, so writes stay queued until she's back
   online and re-enters the passcode once to get a genuine token. This is
   a deliberately weaker check than the real one (a copy of the hash sits
   on the phone), acceptable here because the phone itself, not just a
   glance at it, would have to be gotten into to make use of it.

   Offline queue: every mutation (saveBill/deleteBill/upsertNote/
   deleteNotePage) is id-addressed with a client-generated id (see uuid()
   below), so a write made with no signal can be queued in localStorage and
   replayed later under that same id — no server round trip is needed just
   to mint an id before the UI can show something. AppsScript.gs's saveBill/
   upsertNote both honor a client-supplied id for creates as well as
   updates, which is what makes this safe to replay without reconciliation.

   Offline reads: the last successful listBills()/listNotes() result is
   also cached in localStorage, so reopening the app with no signal at all
   (a fresh page load, not just a backgrounded tab) still shows the bills
   and notes as of the last sync, instead of an empty list.
   ============================================================================ */

(function () {
  const CFG = window.LBB_CONFIG || {};
  if (!CFG.APPS_SCRIPT_URL) {
    console.error("LBB_CONFIG missing — define window.LBB_CONFIG before loading api.js");
    return;
  }

  let sessionToken = null;
  let offlineSession = false; // unlocked via the local hash, no real token yet

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // A failed fetch() throws the exact same generic TypeError whether there's
  // genuinely no network or Apps Script's own serving layer just hiccuped
  // (that happens — a dropped response there comes back with no CORS
  // headers, which the browser also reports as a plain "failed to fetch").
  // Every offline fallback in this file keys off that TypeError, so one
  // short retry here filters out the transient case before anything decides
  // "we're offline" and queues a write or falls back to cached data.
  async function rawCall(action, payload, isRetry) {
    try {
      const res = await fetch(CFG.APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify(Object.assign({ action, token: sessionToken }, payload))
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Request failed.");
      return data;
    } catch (err) {
      if (!isRetry && err instanceof TypeError) {
        await new Promise(r => setTimeout(r, 1200));
        return rawCall(action, payload, true);
      }
      throw err;
    }
  }

  // ── Offline queue ──────────────────────────────────────────────────────────
  const QUEUE_KEY = "lbb_queue_v1";
  let queue = [];
  let flushing = false;
  let onQueueChange = null;
  function loadQueue() { try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (e) { queue = []; } }
  function saveQueue() { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) {} }
  function notifyQueue() { if (onQueueChange) onQueueChange(queue.length); }
  loadQueue();

  function isOfflineError(err) {
    // fetch() rejects with a generic TypeError when there's no network at
    // all (as opposed to the server responding with an error, which throws
    // a normal Error above after a successful round trip) — that's the only
    // case that should get queued rather than surfaced immediately.
    return err instanceof TypeError;
  }

  // action/payload here are exactly what a later flush will replay — kept
  // as plain data (no functions/dates) so JSON.stringify round-trips it.
  async function callOrQueue(action, payload) {
    try {
      return await rawCall(action, payload);
    } catch (err) {
      if (!isOfflineError(err)) throw err;
      queue.push({ qid: uuid(), action, payload, ts: Date.now() });
      saveQueue();
      notifyQueue();
      scheduleFlush();
      return { ok: true, queued: true };
    }
  }

  async function flushQueue() {
    if (flushing || !queue.length || !sessionToken) return;
    flushing = true;
    let i = 0;
    for (; i < queue.length; i++) {
      const item = queue[i];
      let data;
      try {
        data = await rawCall(item.action, item.payload);
      } catch (err) {
        if (isOfflineError(err)) break; // still offline — this and the rest stay queued
        break; // e.g. session expired mid-queue — stop and retry the whole batch after next login
      }
      if (!data.ok) break;
    }
    queue = queue.slice(i);
    saveQueue();
    notifyQueue();
    flushing = false;
  }

  let flushTimer = null;
  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushQueue, 1500);
  }
  window.addEventListener("online", () => flushQueue());
  setInterval(() => { if (queue.length) flushQueue(); }, 30000);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const OFFLINE_AUTH_KEY = "lbb_offline_auth_v1";
  function normalizeForHash(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  function cacheOfflineAuth(passcode) {
    sha256Hex(normalizeForHash(passcode))
      .then(hash => { try { localStorage.setItem(OFFLINE_AUTH_KEY, hash); } catch (e) {} })
      .catch(() => {});
  }
  function hasOfflineAuth() {
    try { return !!localStorage.getItem(OFFLINE_AUTH_KEY); } catch (e) { return false; }
  }
  async function verifyOfflineAuth(passcode) {
    let stored;
    try { stored = localStorage.getItem(OFFLINE_AUTH_KEY); } catch (e) { stored = null; }
    if (!stored) return false;
    return (await sha256Hex(normalizeForHash(passcode))) === stored;
  }

  async function login(passcode) {
    try {
      const data = await rawCall("login", { passcode });
      sessionToken = data.token;
      offlineSession = false;
      cacheOfflineAuth(passcode); // so the same passcode can unlock offline later
      flushQueue();
      return { offline: false };
    } catch (err) {
      if (!isOfflineError(err)) throw err; // a real "incorrect code" from the server — not a connectivity issue
      const ok = await verifyOfflineAuth(passcode);
      if (!ok) {
        throw new Error(hasOfflineAuth()
          ? "Incorrect code."
          : "No connection, and this device hasn't saved a login yet — connect once first.");
      }
      sessionToken = null;
      offlineSession = true;
      return { offline: true };
    }
  }
  function isLoggedIn() { return !!sessionToken || offlineSession; }
  // True once she's unlocked the app offline but hasn't yet exchanged that
  // for a real token — writes are queuing, but need her to retype the
  // passcode once while online to actually reach the server.
  function needsReauth() { return offlineSession && !sessionToken; }
  function logout() { sessionToken = null; offlineSession = false; }

  // ── Photo downscale/compress before upload — same pattern as the pothole
  // app's api.js, keeps the Apps Script POST payload small. ─────────────────
  const MAX_PHOTO_DIMENSION = 1600;
  const PHOTO_JPEG_QUALITY = 0.75;
  function downscalePhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY);
        resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
      img.src = url;
    });
  }

  // ── Read cache ──────────────────────────────────────────────────────────
  // Last-known-good listBills()/listNotes() results, so a fresh page load
  // with no signal at all still shows something instead of an empty app.
  const BILLS_CACHE_KEY = "lbb_cache_bills_v1";
  const NOTES_CACHE_KEY = "lbb_cache_notes_v1";
  function cacheSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function cacheGet(key) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

  async function listBills() {
    try {
      const data = await rawCall("listBills", {});
      cacheSet(BILLS_CACHE_KEY, data.bills);
      return data.bills;
    } catch (err) {
      if (!isOfflineError(err)) throw err;
      const cached = cacheGet(BILLS_CACHE_KEY);
      if (cached) return cached;
      throw err;
    }
  }
  // bill.id is always set by the caller (core.js mints it via LBBAPI.newId()
  // for a brand-new bill) before this is called, so an offline create and an
  // offline edit look identical to the queue.
  async function saveBill(bill, photoFile) {
    let photo = null;
    if (photoFile) photo = await downscalePhoto(photoFile);
    return callOrQueue("saveBill", {
      bill: Object.assign({}, bill, {
        photoBase64: photo ? photo.base64 : null,
        photoMimeType: photo ? photo.mimeType : null
      })
    });
  }
  async function deleteBill(id) { return callOrQueue("deleteBill", { id }); }

  async function listNotes() {
    try {
      const data = await rawCall("listNotes", {});
      cacheSet(NOTES_CACHE_KEY, data.notes);
      return data.notes;
    } catch (err) {
      if (!isOfflineError(err)) throw err;
      const cached = cacheGet(NOTES_CACHE_KEY);
      if (cached) return cached;
      throw err;
    }
  }
  async function upsertNote(note) { return callOrQueue("upsertNote", { note }); }
  async function deleteNotePage(id) { return callOrQueue("deleteNotePage", { id }); }

  window.LBBAPI = {
    login, isLoggedIn, needsReauth, logout, newId: uuid,
    listBills, saveBill, deleteBill,
    listNotes, upsertNote, deleteNotePage,
    getQueueLength: () => queue.length,
    onQueueChange: cb => { onQueueChange = cb; },
    flushQueue
  };
})();
