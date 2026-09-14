/* ============================================================================
   core.js — lileboomboom app logic.

   Passcode gate (required on every load — no persisted session) in front of
   three tabs: Bills (amounts owed, priority, due day, notes, photos),
   Notepad (free-text pages), Calculator (plain arithmetic). All data reads
   and writes go through window.LBBAPI (api.js) — this file never talks to
   Apps Script directly.
   ============================================================================ */

(function () {
  const CFG = window.LBB_CONFIG || {};
  if (!window.LBBAPI) { console.error("api.js must be loaded before core.js"); return; }

  const PRIORITIES = [
    { key: "High",   colour: "#f75f5f" },
    { key: "Medium", colour: "#f5c842" },
    { key: "Low",    colour: "#3ecf6e" }
  ];
  function priorityColour(p) { return (PRIORITIES.find(x => x.key === p) || PRIORITIES[1]).colour; }
  function priorityRank(p) { const i = PRIORITIES.findIndex(x => x.key === p); return i === -1 ? 1 : i; }

  function escHtml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function money(n) { const v = Number(n) || 0; return "£" + v.toFixed(2); }

  // ── Icons/manifest — deliberately generic, no wording anywhere implying
  // finances. Reused abstract placeholder icon shapes. ───────────────────────
  const PWA_ICON_192 = "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAADUklEQVR42u3dwW3jQBBEUWZg+OSwnJnT9VFKQSB7yOmuR+AnINabkQGv9/j6/nlJqR0+BAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABMK8zj88NgIihgwGAsUMBgNHDAIDRwwCA4YMAgOGDAIDhgwBA4+H//v1fDgQAWgy/YuxPoQDA8Lce/F0gADD+NqNfhQEAw285fBAAKB9/x+FXQgAgdPwThl8FAYCg8U8cfgUEAAwfhIEQDuPPHD8EAwEY/n0QADB+CAAwfggAaDN+A18DAQDjhwCAfQEY83oEABg/BAAYPwQAGD8EABg/BAA8AMBI90AAgNPfLQCA8UMAgK8+vgoBYPwQAAAAAAAYPwQAlAAwvj4IAHD6uwUAcPq7BQBw+rsFAHD6uwUAcPq7BQBw+rsFAHD6uwUAMH63AAAAAJAIwPghAAAAAAAAAIAwAMYPAQAAAAAAAAAAAAAAABh/BoJ4AE5/twAAAAAAAAAAAAAAAAAYvx+EAQAAgOkAfP0B4GkEAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAeC3QeW3QQEQAL4Gyb8IA0AAACAAABAAfhCWvwznFjB+fxsUAAAAAAAAAAAAAAAIjN//EQYAAAAAAAAAEBg/AAAAAMDrk8e4+o8fALeA0x8At4DTHwC3gNMfALeA0x8At4DTHwC3gNMfALeA0x8At4DTPx4ABMYPAAAAJAOAwPgB+PAxyr3GDwAExg+Ar0K++gDgFnD6AwCB8QMAgfEDAIHxAwCB8QNwBwAI1o4fAAiMH4AeCECoG3738Y8BAIHxxwOAwPjjAZxBkA7hzDNpL+MAQGD88QBAMHwALiCYCuHsM3kf4wFcQTAFwpVn+jYiAFxF0BXC1SdhFzEAkiAYPgBLEeyIoepJ20IkgGoIT4CoflI3EA1gFYRqFCuf9HcPwE0Qdnu8bwAiIXi/AERC8D4BiITg/QEQh8F7AiAOg/cBQAwKnzMAETB8bgBIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAAgAH4IAkACQAJAAkACQAJAAkACQAJBm9QZjxVBqEAz9WgAAAABJRU5ErkJggg==";
  const PWA_ICON_512 = "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAM2UlEQVR42u3dwVEjQRBFQXlAcMIsPMNdjmDDXNRd9bIj0gE2dv6blth9fXx+/QEALS8/BAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAADwwD8vWCH6cpAS1QAAAABJRU5ErkJggg==";
  const PWA_APPLE_ICON = "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAADAklEQVR42u3d0U3EMBBF0e0A8UVZdEa7fILogMROMvPmWLoN2EcjZ1ebfb29f/xIKb1sgoCWgJaAloAW0BLQEtAS0BLQAloCWgJaAloCWkBLQEtAS0BXbP/LPsEdCuwq8s+A90aMOBAxyOGG+hYxHADHQ0ZbKAjIYMN9O3IPr++wQa6PuQ/qLsDG+jbIF8B+C7gQMP8GOKrcAM9FHIlxFfgBnoI5g6Qd8EGOhhzR8g7YAMNMthA18OcCHkVNtAwQw30c5gnQV6BDTTMUAMNM9RAH8IM8DpsoGGGGmiYoQYa5htRAw0z1EDDDHU4aJihBlpAw6wE1C+YlYS6LWjonkcNtOlsSgMNsyndGDTMUAMtoCuChhlqoAV0RdAwQw20gK4IGmaogRbQHUFD1Av1eNCmsykNtIDuCBoe145WoE1nUxpoAd0RNDSuHUALaNcNJV07gBbQrhuqeu0AWkADLaCBBhpoAQ20gPaRnTI+ugNaQAMtoIEGeiJoSDwYmtAyoYEW0EALaKCB9k2hPBACLaCBFtBAC2iggQZaQPvVt/zqG2gB7doBtDcnAQ20t4/KdQNoAe3aIW/wN6VhBhpooP1PoVw3/JOsxkxnoAU01DBXxQy0gIYa5qqYgRbQUMNcFTPQAhpqmKtibgsa6hqYgTalTWegoTadA0BDDXMcaKhhBlpAQ60EzG1AQw1zHGioYR4JGur9mIGGGmagoYZ5KOgjqME+B7kj5tagoYY5DjTUMMeBPop6Guyjq7uFCNBQwxwH+gzqVNhnVoqBKNDTYU+GHA36LOqusM+uxHOPBb2CugvslZV65tGgd8Cuhnt1pZ/1CNA7UD+Je9eacM5jQO+GfSXw3WvS+Y4DfRXs/8C/e00817Ggn4INMtBggwz0JNjODej2uJ0P0O1xOwegWwO3z0C3Am+fgJaAFtAS0BLQEtAS0AJaAloCWgJaAlpAS0BLQEtAS0ALaAloCWgJaAloAS0BLQEtAS2gJaClev0CJHNfV+3/t+EAAAAASUVORK5CYII=";

  function injectPwaHead() {
    const baseUrl = new URL("./", document.location.href).href;
    const manifest = {
      name: CFG.TITLE || "lileboomboom",
      short_name: (CFG.TITLE || "lileboomboom").slice(0, 24),
      description: "Personal notes.",
      start_url: baseUrl, scope: baseUrl, display: "standalone",
      background_color: "#14151b", theme_color: "#14151b",
      icons: [
        { src: `data:image/png;base64,${PWA_ICON_192}`, sizes: "192x192", type: "image/png" },
        { src: `data:image/png;base64,${PWA_ICON_512}`, sizes: "512x512", type: "image/png" }
      ]
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    const manifestLink = document.createElement("link");
    manifestLink.rel = "manifest"; manifestLink.href = URL.createObjectURL(blob);
    document.head.appendChild(manifestLink);

    const themeColor = document.createElement("meta");
    themeColor.name = "theme-color"; themeColor.content = "#14151b";
    document.head.appendChild(themeColor);

    const appleIcon = document.createElement("link");
    appleIcon.rel = "apple-touch-icon"; appleIcon.href = `data:image/png;base64,${PWA_APPLE_ICON}`;
    document.head.appendChild(appleIcon);

    [["apple-mobile-web-app-capable", "yes"],
     ["apple-mobile-web-app-status-bar-style", "black-translucent"],
     ["apple-mobile-web-app-title", CFG.TITLE || "lileboomboom"]].forEach(([name, content]) => {
      const m = document.createElement("meta"); m.name = name; m.content = content; document.head.appendChild(m);
    });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let allBills = [];
  let allNotes = [];
  let currentNoteIdx = 0;
  let activeTab = "bills";
  let noteSaveTimer = null;

  document.title = CFG.TITLE || "lileboomboom";

  function appShellHtml() {
    return `
  <div id="gate-screen">
    <form id="gate-form">
      <input type="password" id="gate-input" placeholder="Code" autocomplete="off" autofocus>
      <button type="submit">Go</button>
      <div id="gate-msg"></div>
    </form>
  </div>
  <div id="app" style="display:none;">
    <header id="topbar">
      <div id="tabs">
        <button class="tab-btn active" data-tab="bills">Bills</button>
        <button class="tab-btn" data-tab="notepad">Notepad</button>
        <button class="tab-btn" data-tab="calculator">Calculator</button>
      </div>
      <button id="logout-btn">Log out</button>
    </header>
    <main id="panels">
      <section id="panel-bills" class="panel active"></section>
      <section id="panel-notepad" class="panel"></section>
      <section id="panel-calculator" class="panel"></section>
    </main>
    <div id="toast"></div>
  </div>`;
  }

  function boot() {
    document.body.innerHTML = appShellHtml();
    injectPwaHead();

    document.getElementById("gate-form").addEventListener("submit", onGateSubmit);
    document.getElementById("logout-btn").addEventListener("click", onLogout);
    document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  }

  async function onGateSubmit(e) {
    e.preventDefault();
    const input = document.getElementById("gate-input");
    const msg = document.getElementById("gate-msg");
    const code = input.value;
    input.value = "";
    msg.textContent = "";
    try {
      await LBBAPI.login(code);
      document.getElementById("gate-screen").style.display = "none";
      document.getElementById("app").style.display = "";
      await Promise.all([loadBills(), loadNotes()]);
    } catch (err) {
      msg.textContent = "Try again.";
      input.focus();
    }
  }

  function onLogout() {
    LBBAPI.logout();
    document.getElementById("app").style.display = "none";
    document.getElementById("gate-screen").style.display = "";
    document.getElementById("gate-input").focus();
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + tab));
  }

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3000);
  }

  // ── Bills ─────────────────────────────────────────────────────────────────
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function cutoffDayFor(year, monthIdx) { return monthIdx === 1 ? (isLeap(year) ? 29 : 28) : 29; }
  function nextCutoffDate(now) {
    let year = now.getFullYear(), month = now.getMonth();
    let day = cutoffDayFor(year, month);
    let candidate = new Date(year, month, day, 23, 59, 59);
    if (now > candidate) {
      month += 1; if (month > 11) { month = 0; year += 1; }
      day = cutoffDayFor(year, month);
      candidate = new Date(year, month, day, 23, 59, 59);
    }
    return candidate;
  }

  async function loadBills() {
    allBills = await LBBAPI.listBills();
    renderBills();
  }

  function renderBills() {
    const panel = document.getElementById("panel-bills");
    const now = new Date();
    const cutoff = nextCutoffDate(now);
    const daysLeft = Math.ceil((cutoff - now) / 86400000);
    const unpaid = allBills.filter(b => (b.status || "Unpaid") !== "Paid");
    const totals = { High: 0, Medium: 0, Low: 0 };
    unpaid.forEach(b => { totals[b.priority || "Medium"] = (totals[b.priority || "Medium"] || 0) + (Number(b.amount) || 0); });
    const grand = totals.High + totals.Medium + totals.Low;

    const sorted = allBills.slice().sort((a, b) => {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return (Number(a.dueDay) || 0) - (Number(b.dueDay) || 0);
    });

    panel.innerHTML = `
      <div class="summary-card">
        <div class="summary-row"><span>Next cutoff</span><strong>${cutoff.toLocaleDateString()} (${daysLeft}d)</strong></div>
        ${PRIORITIES.map(p => `<div class="summary-row"><span style="color:${p.colour}">${p.key}</span><span>${money(totals[p.key])}</span></div>`).join("")}
        <div class="summary-row summary-total"><span>Total owed</span><strong>${money(grand)}</strong></div>
      </div>
      <button class="add-btn" id="add-bill-btn">+ Add bill</button>
      <div id="bill-list">
        ${sorted.map(billCardHtml).join("") || `<p class="empty-msg">Nothing here yet.</p>`}
      </div>`;

    document.getElementById("add-bill-btn").addEventListener("click", () => openBillForm(null));
    sorted.forEach(b => wireBillCard(b));
  }

  function billCardHtml(b) {
    const paid = (b.status || "Unpaid") === "Paid";
    return `
    <div class="bill-card ${paid ? "paid" : ""}" data-id="${escHtml(b.id)}" style="border-left-color:${priorityColour(b.priority)}">
      <div class="bill-head">
        <span class="bill-name">${escHtml(b.name)}</span>
        <span class="bill-amount">${money(b.amount)}</span>
      </div>
      <div class="bill-meta">
        <label>Due day <input type="number" min="1" max="31" class="due-day-input" value="${escHtml(b.dueDay)}"></label>
        <select class="priority-select">${PRIORITIES.map(p => `<option value="${p.key}" ${p.key === b.priority ? "selected" : ""}>${p.key}</option>`).join("")}</select>
        <button class="status-toggle-btn">${paid ? "Paid ✓" : "Mark paid"}</button>
      </div>
      ${b.notes ? `<div class="bill-notes">${escHtml(b.notes)}</div>` : ""}
      ${b.photoUrl ? `<img class="bill-photo" src="${escHtml(b.photoUrl)}" alt="">` : ""}
      <div class="bill-actions">
        <button class="edit-btn">Edit</button>
        <button class="delete-btn">Delete</button>
      </div>
    </div>`;
  }

  function wireBillCard(b) {
    const card = document.querySelector(`.bill-card[data-id="${CSS.escape(b.id)}"]`);
    if (!card) return;
    card.querySelector(".due-day-input").addEventListener("change", async e => {
      const dueDay = Math.max(1, Math.min(31, Number(e.target.value) || 1));
      await saveBillPatch(b, { dueDay });
    });
    card.querySelector(".priority-select").addEventListener("change", async e => {
      await saveBillPatch(b, { priority: e.target.value });
    });
    card.querySelector(".status-toggle-btn").addEventListener("click", async () => {
      const status = (b.status || "Unpaid") === "Paid" ? "Unpaid" : "Paid";
      await saveBillPatch(b, { status });
    });
    card.querySelector(".edit-btn").addEventListener("click", () => openBillForm(b));
    card.querySelector(".delete-btn").addEventListener("click", async () => {
      if (!confirm(`Delete "${b.name}"?`)) return;
      await LBBAPI.deleteBill(b.id);
      await loadBills();
    });
  }

  async function saveBillPatch(bill, patch) {
    const updated = Object.assign({}, bill, patch);
    try {
      await LBBAPI.saveBill(updated);
      await loadBills();
    } catch (err) { toast("Save failed: " + err.message); }
  }

  function openBillForm(bill) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-head"><h2>${bill ? "Edit" : "Add"} bill</h2><button class="modal-close">✕</button></div>
        <div class="modal-body">
          <label class="form-label">Name</label>
          <input type="text" id="f-name" value="${bill ? escHtml(bill.name) : ""}">
          <label class="form-label">Amount</label>
          <input type="number" step="0.01" id="f-amount" value="${bill ? escHtml(bill.amount) : ""}">
          <label class="form-label">Due day (1-31)</label>
          <input type="number" min="1" max="31" id="f-dueday" value="${bill ? escHtml(bill.dueDay) : "29"}">
          <label class="form-label">Priority</label>
          <select id="f-priority">${PRIORITIES.map(p => `<option value="${p.key}" ${bill && bill.priority === p.key ? "selected" : ""}>${p.key}</option>`).join("")}</select>
          <label class="form-label">Notes</label>
          <textarea id="f-notes" rows="3">${bill ? escHtml(bill.notes) : ""}</textarea>
          <label class="form-label">Photo (upload, or paste one anywhere in this box)</label>
          <input type="file" id="f-photo" accept="image/*">
          <img id="f-photo-preview" style="display:none;">
          <div id="f-msg" class="form-msg"></div>
          <button id="f-submit" class="add-btn">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    let pastedFile = null;
    function setPreview(file) {
      const img = overlay.querySelector("#f-photo-preview");
      img.src = URL.createObjectURL(file); img.style.display = "block";
    }
    overlay.querySelector("#f-photo").addEventListener("change", e => {
      const file = e.target.files[0]; if (file) { pastedFile = null; setPreview(file); }
    });
    overlay.addEventListener("paste", e => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          pastedFile = item.getAsFile();
          setPreview(pastedFile);
          break;
        }
      }
    });
    overlay.querySelector(".modal-close").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector("#f-submit").addEventListener("click", async () => {
      const name = overlay.querySelector("#f-name").value.trim();
      const amount = Number(overlay.querySelector("#f-amount").value) || 0;
      const dueDay = Math.max(1, Math.min(31, Number(overlay.querySelector("#f-dueday").value) || 29));
      const priority = overlay.querySelector("#f-priority").value;
      const notes = overlay.querySelector("#f-notes").value.trim();
      const msg = overlay.querySelector("#f-msg");
      if (!name) { msg.textContent = "Name is required."; return; }
      const fileInput = overlay.querySelector("#f-photo");
      const photoFile = pastedFile || fileInput.files[0] || null;
      msg.textContent = "Saving…";
      try {
        const payload = Object.assign({}, bill, { name, amount, dueDay, priority, notes });
        await LBBAPI.saveBill(payload, photoFile);
        overlay.remove();
        await loadBills();
      } catch (err) { msg.textContent = "Save failed: " + err.message; }
    });
  }

  // ── Notepad ───────────────────────────────────────────────────────────────
  async function loadNotes() {
    allNotes = await LBBAPI.listNotes();
    currentNoteIdx = 0;
    renderNotepad();
  }

  function renderNotepad() {
    const panel = document.getElementById("panel-notepad");
    const page = allNotes[currentNoteIdx];
    panel.innerHTML = `
      <div class="notepad-bar">
        <button id="note-prev">‹ Prev</button>
        <span id="note-page-indicator">Page ${currentNoteIdx + 1} of ${allNotes.length}</span>
        <button id="note-next">Next ›</button>
      </div>
      <textarea id="note-text" placeholder="Write anything…">${page ? escHtml(page.content) : ""}</textarea>
      <div class="notepad-bar">
        <button id="note-new">+ New page</button>
        <button id="note-delete" class="delete-btn">Delete page</button>
      </div>`;

    document.getElementById("note-prev").disabled = currentNoteIdx <= 0;
    document.getElementById("note-next").disabled = currentNoteIdx >= allNotes.length - 1;

    document.getElementById("note-prev").addEventListener("click", () => { currentNoteIdx--; renderNotepad(); });
    document.getElementById("note-next").addEventListener("click", () => { currentNoteIdx++; renderNotepad(); });
    document.getElementById("note-new").addEventListener("click", async () => {
      const id = await LBBAPI.addNotePage();
      await loadNotes();
      currentNoteIdx = allNotes.findIndex(n => n.id === id);
      renderNotepad();
    });
    document.getElementById("note-delete").addEventListener("click", async () => {
      if (allNotes.length <= 1) { toast("Can't delete the only page."); return; }
      if (!confirm("Delete this page?")) return;
      await LBBAPI.deleteNotePage(page.id);
      await loadNotes();
    });
    document.getElementById("note-text").addEventListener("input", e => {
      clearTimeout(noteSaveTimer);
      const content = e.target.value;
      noteSaveTimer = setTimeout(async () => {
        try { await LBBAPI.saveNotePage(page.id, content); page.content = content; }
        catch (err) { toast("Save failed: " + err.message); }
      }, 800);
    });
  }

  // ── Calculator ────────────────────────────────────────────────────────────
  function renderCalculator() {
    const panel = document.getElementById("panel-calculator");
    if (panel.dataset.built) return;
    panel.dataset.built = "1";
    panel.innerHTML = `
      <div class="calc">
        <div id="calc-display">0</div>
        <div class="calc-grid">
          <button data-k="C">C</button><button data-k="±">±</button><button data-k="%">%</button><button data-k="/" class="op">÷</button>
          <button data-k="7">7</button><button data-k="8">8</button><button data-k="9">9</button><button data-k="*" class="op">×</button>
          <button data-k="4">4</button><button data-k="5">5</button><button data-k="6">6</button><button data-k="-" class="op">−</button>
          <button data-k="1">1</button><button data-k="2">2</button><button data-k="3">3</button><button data-k="+" class="op">+</button>
          <button data-k="0" class="wide">0</button><button data-k=".">.</button><button data-k="=" class="op">=</button>
        </div>
      </div>`;

    let acc = null, pendingOp = null, current = "0", justEvaluated = false;
    const display = () => panel.querySelector("#calc-display").textContent = current;
    function apply(a, b, op) {
      switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? NaN : a / b;
        default: return b;
      }
    }
    panel.querySelectorAll(".calc-grid button").forEach(btn => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.k;
        if (k === "C") { acc = null; pendingOp = null; current = "0"; justEvaluated = false; }
        else if (k === "±") { current = String(-parseFloat(current || "0")); }
        else if (k === "%") { current = String(parseFloat(current || "0") / 100); }
        else if (k === ".") { if (!current.includes(".")) current += "."; }
        else if (/[0-9]/.test(k)) { current = (justEvaluated || current === "0") ? k : current + k; justEvaluated = false; }
        else if (["+", "-", "*", "/"].includes(k)) {
          if (acc !== null && pendingOp && !justEvaluated) acc = apply(acc, parseFloat(current), pendingOp);
          else acc = parseFloat(current);
          pendingOp = k; current = "0"; justEvaluated = false;
        } else if (k === "=") {
          if (acc !== null && pendingOp) { current = String(apply(acc, parseFloat(current), pendingOp)); acc = null; pendingOp = null; justEvaluated = true; }
        }
        display();
      });
    });
    display();
  }

  const origSwitchTab = switchTab;
  switchTab = function (tab) {
    origSwitchTab(tab);
    if (tab === "calculator") renderCalculator();
  };

  boot();
})();
