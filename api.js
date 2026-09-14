/* ============================================================================
   api.js — Backend abstraction for lileboomboom.

   The only module that talks to the Apps Script web app. core.js never
   builds a request payload itself — this split means the backend can be
   swapped later without touching core.js.

   Everything (including reads) requires a session token minted by login().
   The token lives only in memory here — never persisted — so a fresh page
   load always starts logged out, as required.

   Offline queue: every mutation (saveBill/deleteBill/upsertNote/
   deleteNotePage) is id-addressed with a client-generated id (see uuid()
   below), so a write made with no signal can be queued in localStorage and
   replayed later under that same id — no server round trip is needed just
   to mint an id before the UI can show something. AppsScript.gs's saveBill/
   upsertNote both honor a client-supplied id for creates as well as
   updates, which is what makes this safe to replay without reconciliation.
   ============================================================================ */

(function () {
  const CFG = window.LBB_CONFIG || {};
  if (!CFG.APPS_SCRIPT_URL) {
    console.error("LBB_CONFIG missing — define window.LBB_CONFIG before loading api.js");
    return;
  }

  let sessionToken = null;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function rawCall(action, payload) {
    const res = await fetch(CFG.APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(Object.assign({ action, token: sessionToken }, payload))
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Request failed.");
    return data;
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
  async function login(passcode) {
    const data = await rawCall("login", { passcode });
    sessionToken = data.token;
    flushQueue();
    return true;
  }
  function isLoggedIn() { return !!sessionToken; }
  function logout() { sessionToken = null; }

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

  async function listBills() { return (await rawCall("listBills", {})).bills; }
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

  async function listNotes() { return (await rawCall("listNotes", {})).notes; }
  async function upsertNote(note) { return callOrQueue("upsertNote", { note }); }
  async function deleteNotePage(id) { return callOrQueue("deleteNotePage", { id }); }

  window.LBBAPI = {
    login, isLoggedIn, logout, newId: uuid,
    listBills, saveBill, deleteBill,
    listNotes, upsertNote, deleteNotePage,
    getQueueLength: () => queue.length,
    onQueueChange: cb => { onQueueChange = cb; },
    flushQueue
  };
})();
