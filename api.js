/* ============================================================================
   api.js — Backend abstraction for lileboomboom.

   The only module that talks to the Apps Script web app. core.js never
   builds a request payload itself — this split means the backend can be
   swapped later without touching core.js.

   Everything (including reads) requires a session token minted by login().
   The token lives only in memory here — never persisted — so a fresh page
   load always starts logged out, as required.
   ============================================================================ */

(function () {
  const CFG = window.LBB_CONFIG || {};
  if (!CFG.APPS_SCRIPT_URL) {
    console.error("LBB_CONFIG missing — define window.LBB_CONFIG before loading api.js");
    return;
  }

  let sessionToken = null;

  async function call(action, payload) {
    const res = await fetch(CFG.APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(Object.assign({ action, token: sessionToken }, payload))
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  async function login(passcode) {
    const data = await call("login", { passcode });
    sessionToken = data.token;
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

  async function listBills() { return (await call("listBills", {})).bills; }
  async function saveBill(bill, photoFile) {
    let photo = null;
    if (photoFile) photo = await downscalePhoto(photoFile);
    return call("saveBill", {
      bill: Object.assign({}, bill, {
        photoBase64: photo ? photo.base64 : null,
        photoMimeType: photo ? photo.mimeType : null
      })
    });
  }
  async function deleteBill(id) { return call("deleteBill", { id }); }

  async function listNotes() { return (await call("listNotes", {})).notes; }
  async function saveNotePage(id, content) { return call("saveNotePage", { id, content }); }
  async function addNotePage() { return (await call("addNotePage", {})).id; }
  async function deleteNotePage(id) { return call("deleteNotePage", { id }); }

  window.LBBAPI = {
    login, isLoggedIn, logout,
    listBills, saveBill, deleteBill,
    listNotes, saveNotePage, addNotePage, deleteNotePage
  };
})();
