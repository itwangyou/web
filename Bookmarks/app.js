/* =========================
   state
   - modalOpen: 书签新增/编辑模态是否打开
   - drawerOpen: 抽屉是否打开
   - savedScrollY: 打开覆盖层时保存滚动位置（body fixed 锁滚动，关闭后 rAF scrollTo 恢复）
   - lastFocus: 打开覆盖层前的焦点元素（关闭后恢复）
========================= */
const state = {
  modalOpen: false,
  drawerOpen: false,
  savedScrollY: 0,
  lastFocus: null,
  selectionMode: false,
  selectedIds: new Set(),
  bookmarks: []
};

/* =========================
   utils
========================= */
const utils = {
  now() { return Date.now(); },
  safeText(s) { return (s ?? "").toString().trim(); },

  splitTags(input) {
    const raw = utils.safeText(input);
    if(!raw) return [];
    const parts = raw.split(/[,，]/g).map(t => t.trim()).filter(Boolean);
    const uniq = [];
    const seen = new Set();
    for(const t of parts) {
      const key = t.toLowerCase();
      if(!seen.has(key)) {
        seen.add(key);
        uniq.push(t);
      }
    }
    return uniq;
  },

  normalizeUrl(input) {
    let s = utils.safeText(input);
    if(!s) return { ok: false, reason: "URL 不能为空" };
    if(!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = "https://" + s;

    try {
      const u = new URL(s);
      if(!/^https?:$/.test(u.protocol)) return { ok: false, reason: "仅支持 http/https" };
      const canonical = u.href;
      return { ok: true, url: canonical, canonical };
    } catch {
      return { ok: false, reason: "URL 格式不正确" };
    }
  },

  domainFromUrl(url) {
    try { return new URL(url).hostname; } catch { return ""; }
  },

  formatTime(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleString("zh-CN", { hour12: false });
    } catch {
      return "";
    }
  },

  /* 稳定 ID：对 urlCanonical 做 FNV-1a 64-bit（BigInt）哈希 */
  fnv1a64(str) {
    let h = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for(let i = 0; i < str.length; i++) {
      h ^= BigInt(str.charCodeAt(i));
      h = (h * prime) & 0xffffffffffffffffn;
    }
    return h;
  },
  idFromCanonical(canonical) {
    const h = utils.fnv1a64(canonical);
    const hex = h.toString(16).padStart(16, "0");
    return `u${hex}`;
  },

  getFocusables(root) {
    const all = root.querySelectorAll([
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(","));

    const visible = [];
    for(const node of all) {
      const style = window.getComputedStyle(node);
      if(style.display === "none" || style.visibility === "hidden") continue;
      if(node.offsetParent === null && style.position !== "fixed") continue;
      visible.push(node);
    }
    return visible;
  },

  buildPickersFromBookmarks(bookmarks) {
    const folders = new Set();
    const tags = new Set();
    for(const b of bookmarks) {
      if(b.folder) folders.add(b.folder);
      for(const t of (b.tags || []))
        if(t) tags.add(t);
    }
    return {
      folders: [...folders].sort((a, b) => a.localeCompare(b, "zh-CN")),
      tags: [...tags].sort((a, b) => a.localeCompare(b, "zh-CN"))
    };
  }
};

/* =========================
   services
========================= */
const storage = {
  key: "bookmarkVault.v1",
  load() {
    const raw = localStorage.getItem(storage.key);
    if(!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  save(items) {
    localStorage.setItem(storage.key, JSON.stringify(items));
  }
};

/* =========================
   view
========================= */
const el = {
  list: document.getElementById("list"),
  empty: document.getElementById("empty"),

  btnBatchToggle: document.getElementById("btnBatchToggle"),

  batchBarMain: document.getElementById("batchBarMain"),
  batchCountMain: document.getElementById("batchCountMain"),
  btnSelectAll: document.getElementById("btnSelectAll"),
  btnBatchAddTagMain: document.getElementById("btnBatchAddTagMain"),
  btnBatchDeleteMain: document.getElementById("btnBatchDeleteMain"),

  btnOpenDrawer: document.getElementById("btnOpenDrawer"),
  drawerBackdrop: document.getElementById("drawerBackdrop"),
  drawerShell: document.getElementById("drawerShell"),
  drawer: document.getElementById("drawer"),
  drawerContent: document.getElementById("drawerContent"),
  btnDrawerClose: document.getElementById("btnDrawerClose"),

  q: document.getElementById("q"),
  sort: document.getElementById("sort"),
  filterFolder: document.getElementById("filterFolder"),
  filterTag: document.getElementById("filterTag"),

  btnExport: document.getElementById("btnExport"),
  fileImport: document.getElementById("fileImport"),

  fabAdd: document.getElementById("fabAdd"),
  backdrop: document.getElementById("backdrop"),
  modalShell: document.getElementById("modalShell"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalContent: document.getElementById("modalContent"),

  form: document.getElementById("form"),
  title: document.getElementById("title"),
  url: document.getElementById("url"),
  desc: document.getElementById("desc"),
  tags: document.getElementById("tags"),
  tagPicker: document.getElementById("tagPicker"),
  folder: document.getElementById("folder"),
  folderPicker: document.getElementById("folderPicker"),
  pinned: document.getElementById("pinned"),
  editingId: document.getElementById("editingId"),
  hintTitle: document.getElementById("hintTitle"),
  hintUrl: document.getElementById("hintUrl"),
  btnClose: document.getElementById("btnClose"),
  btnCancel: document.getElementById("btnCancel")
};

const view = {
  render() {
    view.renderFilters();
    const items = view.getVisibleItems();

    if(state.selectionMode) view.pruneSelectionToVisible(items);

    view.renderList(items);
    view.renderEmpty(items.length === 0);
    view.renderBatchBar(items);
  },

  renderEmpty(show) {
    el.empty.hidden = !show;
  },

  renderFilters() {
    const { folders, tags } = utils.buildPickersFromBookmarks(state.bookmarks);

    const folderVal = el.filterFolder.value;
    const tagVal = el.filterTag.value;

    el.filterFolder.innerHTML = "";
    const optAllF = document.createElement("option");
    optAllF.value = "";
    optAllF.textContent = "全部文件夹";
    el.filterFolder.appendChild(optAllF);
    folders.forEach(f => {
      const o = document.createElement("option");
      o.value = f;
      o.textContent = f;
      el.filterFolder.appendChild(o);
    });

    el.filterTag.innerHTML = "";
    const optAllT = document.createElement("option");
    optAllT.value = "";
    optAllT.textContent = "全部标签";
    el.filterTag.appendChild(optAllT);
    tags.forEach(t => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      el.filterTag.appendChild(o);
    });

    el.filterFolder.value = folderVal || "";
    el.filterTag.value = tagVal || "";
  },

  renderModalPickers() {
    const { folders, tags } = utils.buildPickersFromBookmarks(state.bookmarks);

    el.tagPicker.innerHTML = "";
    const t0 = document.createElement("option");
    t0.value = "";
    t0.textContent = "选择标签";
    el.tagPicker.appendChild(t0);
    tags.forEach(t => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      el.tagPicker.appendChild(o);
    });
    el.tagPicker.value = "";

    el.folderPicker.innerHTML = "";
    const f0 = document.createElement("option");
    f0.value = "";
    f0.textContent = "选择文件夹";
    el.folderPicker.appendChild(f0);
    folders.forEach(f => {
      const o = document.createElement("option");
      o.value = f;
      o.textContent = f;
      el.folderPicker.appendChild(o);
    });
    el.folderPicker.value = "";
  },

  getVisibleItems() {
    const q = utils.safeText(el.q.value).toLowerCase();
    const folder = el.filterFolder.value;
    const tag = el.filterTag.value;
    const sort = el.sort.value;

    let items = state.bookmarks.slice();

    if(folder) items = items.filter(b => b.folder === folder);
    if(tag) items = items.filter(b => (b.tags || []).includes(tag));

    if(q) {
      items = items.filter(b => {
        const hay = [b.title, b.url, b.desc, b.folder, ...(b.tags || [])]
          .filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }

    const pinnedFirst = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);

    if(sort === "az") {
      items.sort((a, b) => {
        const p = pinnedFirst(a, b);
        if(p !== 0) return p;
        return a.title.localeCompare(b.title, "zh-CN");
      });
    } else if(sort === "createdDesc") {
      items.sort((a, b) => {
        const p = pinnedFirst(a, b);
        if(p !== 0) return p;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    } else {
      items.sort((a, b) => {
        const p = pinnedFirst(a, b);
        if(p !== 0) return p;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    }

    return items;
  },

  pruneSelectionToVisible(visibleItems) {
    const visible = new Set(visibleItems.map(b => b.id));
    for(const id of state.selectedIds) {
      if(!visible.has(id)) state.selectedIds.delete(id);
    }
  },

  renderBatchBar(visibleItems) {
    el.btnBatchToggle.textContent = state.selectionMode ? "完成" : "批量";
    el.btnBatchToggle.setAttribute("aria-pressed", state.selectionMode ? "true" : "false");

    el.batchBarMain.hidden = !state.selectionMode;
    if(!state.selectionMode) return;

    el.batchCountMain.textContent = `已选 ${state.selectedIds.size}`;

    const disabled = state.selectedIds.size === 0;
    el.btnBatchAddTagMain.disabled = disabled;
    el.btnBatchDeleteMain.disabled = disabled;

    const visibleIds = visibleItems.map(b => b.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => state.selectedIds.has(id));
    el.btnSelectAll.textContent = allVisibleSelected ? "取消全选" : "全选";
    el.btnSelectAll.disabled = visibleIds.length === 0;
  },

  renderList(items) {
    el.list.innerHTML = "";

    for(const b of items) {
      const li = document.createElement("li");
      li.className = "card";
      li.dataset.id = b.id;

      const top = document.createElement("div");
      top.className = "card-top";

      if(state.selectionMode) {
        const ckWrap = document.createElement("div");
        ckWrap.className = "card-check";

        const ck = document.createElement("input");
        ck.type = "checkbox";
        ck.checked = state.selectedIds.has(b.id);
        ck.setAttribute("aria-label", "选择该书签");
        ck.addEventListener("change", () => {
          if(ck.checked) state.selectedIds.add(b.id);
          else state.selectedIds.delete(b.id);
          view.render();
        });

        ckWrap.appendChild(ck);
        top.appendChild(ckWrap);
      }

      const main = document.createElement("div");
      main.className = "card-main";

      const head = document.createElement("div");
      head.className = "card-head";

      const h = document.createElement("h3");
      h.className = "card-title";

      const titleBtn = document.createElement("button");
      titleBtn.type = "button";
      titleBtn.className = "link";
      titleBtn.textContent = b.title || "(无标题)";
      titleBtn.addEventListener("click", () => actions.openUrl(b.url));
      h.appendChild(titleBtn);

      if(b.pinned) {
        const pin = document.createElement("span");
        pin.className = "pill pill-pin";
        pin.textContent = "置顶";
        h.appendChild(pin);
      }

      head.appendChild(h);

      const domain = utils.domainFromUrl(b.url);
      if(domain) {
        const d = document.createElement("span");
        d.className = "pill card-domain";
        d.textContent = domain;
        head.appendChild(d);
      }

      main.appendChild(head);

      const meta = document.createElement("div");
      meta.className = "meta";

      if(b.folder) {
        const f = document.createElement("span");
        f.className = "pill";
        f.textContent = `📁 ${b.folder}`;
        meta.appendChild(f);
      }

      if(b.tags && b.tags.length) {
        for(const t of b.tags.slice(0, 6)) {
          const tag = document.createElement("span");
          tag.className = "pill";
          tag.textContent = `#${t}`;
          meta.appendChild(tag);
        }
        if(b.tags.length > 6) {
          const more = document.createElement("span");
          more.className = "pill";
          more.textContent = `+${b.tags.length - 6}`;
          meta.appendChild(more);
        }
      }

      const time = document.createElement("span");
      time.className = "pill";
      time.textContent = `⏱ ${utils.formatTime(b.updatedAt || b.createdAt)}`;
      meta.appendChild(time);

      main.appendChild(meta);

      if(b.desc) {
        const p = document.createElement("p");
        p.className = "desc";
        p.textContent = b.desc;
        main.appendChild(p);
      }

      top.appendChild(main);
      li.appendChild(top);

      const actionsRow = document.createElement("div");
      actionsRow.className = "card-actions";

      const btnOpen = view.mkBtn("打开", () => actions.openUrl(b.url));
      const btnCopy = view.mkBtn("复制链接", () => actions.copyUrl(b.url));
      const btnEdit = view.mkBtn("编辑", () => actions.openEdit(b.id));
      const btnPin = view.mkBtn(b.pinned ? "取消置顶" : "置顶", () => actions.togglePin(b.id));
      const btnDel = view.mkBtn("删除", () => actions.deleteOne(b.id), "btn-danger");

      actionsRow.append(btnOpen, btnCopy, btnEdit, btnPin, btnDel);
      li.appendChild(actionsRow);

      el.list.appendChild(li);
    }
  },

  mkBtn(text, onClick, extraClass = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn ${extraClass}`.trim();
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  },

  setFormErrors({ title = "", url = "" } = {}) {
    el.hintTitle.textContent = title;
    el.hintUrl.textContent = url;
  }
};

/* =========================
   scroll lock
   保存 scrollY → body fixed/top 负值 → 关闭时 rAF scrollTo 恢复
========================= */
function lockScroll() {
  state.savedScrollY = window.scrollY || 0;
  document.body.classList.add("scroll-locked");
  document.body.style.top = `-${state.savedScrollY}px`;
}

function unlockScroll() {
  const y = state.savedScrollY;
  document.body.classList.remove("scroll-locked");
  document.body.style.top = "";
  requestAnimationFrame(() => window.scrollTo(0, y));
}

/* =========================
   focus helpers
========================= */
function focusEnter(root) {
  requestAnimationFrame(() => {
    const focusables = utils.getFocusables(root);
    if(focusables.length) focusables[0].focus();
    else root.focus();
  });
}

/* =========================
   drawer
========================= */
const drawer = {
  open(triggerEl) {
    if(state.modalOpen || state.drawerOpen) return;

    state.lastFocus = triggerEl || document.activeElement;
    state.drawerOpen = true;

    lockScroll();
    el.drawerBackdrop.hidden = false;
    el.drawerShell.hidden = false;

    requestAnimationFrame(() => el.drawerShell.classList.add("is-open"));
    focusEnter(el.drawer);
  },

  close() {
    if(!state.drawerOpen) return;

    state.drawerOpen = false;
    el.drawerShell.classList.remove("is-open");

    const done = () => {
      el.drawerBackdrop.hidden = true;
      el.drawerShell.hidden = true;
      unlockScroll();

      const back = state.lastFocus;
      state.lastFocus = null;
      if(back && typeof back.focus === "function") back.focus();
    };

    const t = setTimeout(done, 220);
    el.drawer.addEventListener("transitionend", () => {
      clearTimeout(t);
      done();
    }, { once: true });
  }
};

/* =========================
   modal
========================= */
const modal = {
  open({ mode, id }, triggerEl) {
    if(state.drawerOpen) drawer.close();

    state.lastFocus = triggerEl || document.activeElement;
    state.modalOpen = true;

    lockScroll();
    el.backdrop.hidden = false;
    el.modalShell.hidden = false;

    view.setFormErrors({ title: "", url: "" });

    if(mode === "edit") {
      const b = state.bookmarks.find(x => x.id === id);
      if(!b) return;

      el.modalTitle.textContent = "编辑书签";
      el.editingId.value = b.id;
      el.title.value = b.title || "";
      el.url.value = b.url || "";
      el.desc.value = b.desc || "";
      el.tags.value = (b.tags || []).join(", ");
      el.folder.value = b.folder || "";
      el.pinned.checked = !!b.pinned;
    } else {
      el.modalTitle.textContent = "新增书签";
      el.editingId.value = "";
      el.title.value = "";
      el.url.value = "";
      el.desc.value = "";
      el.tags.value = "";
      el.folder.value = "";
      el.pinned.checked = false;
    }

    view.renderModalPickers();
    focusEnter(el.modal);
  },

  close() {
    if(!state.modalOpen) return;

    state.modalOpen = false;
    el.backdrop.hidden = true;
    el.modalShell.hidden = true;

    unlockScroll();

    const back = state.lastFocus;
    state.lastFocus = null;
    if(back && typeof back.focus === "function") back.focus();
  }
};

/* =========================
   actions
========================= */
const actions = {
  toggleBatchFromTopbar() {
    if(state.selectionMode) {
      state.selectionMode = false;
      state.selectedIds.clear();
      view.render();
      return;
    }

    state.selectionMode = true;
    state.selectedIds.clear();
    if(state.drawerOpen) drawer.close();
    view.render();
  },

  selectAllVisibleToggle() {
    const visible = view.getVisibleItems().map(b => b.id);
    if(visible.length === 0) return;

    const allSelected = visible.every(id => state.selectedIds.has(id));
    if(allSelected) {
      for(const id of visible) state.selectedIds.delete(id);
    } else {
      for(const id of visible) state.selectedIds.add(id);
    }
    view.render();
  },

  openUrl(url) {
    if(!url) return;
    window.open(url, "_blank", "noopener");
  },

  async copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      actions.toast("已复制链接");
    } catch {
      actions.toast("复制失败（浏览器限制）");
    }
  },

  toast(text) {
    document.title = text;
    setTimeout(() => (document.title = "书签收藏"), 1200);
  },

  openNew() {
    modal.open({ mode: "new" }, el.fabAdd);
  },

  openEdit(id) {
    modal.open({ mode: "edit", id }, document.activeElement);
  },

  togglePin(id) {
    const b = state.bookmarks.find(x => x.id === id);
    if(!b) return;
    b.pinned = !b.pinned;
    b.updatedAt = utils.now();
    persist();
    view.render();
  },

  deleteOne(id) {
    const b = state.bookmarks.find(x => x.id === id);
    if(!b) return;
    if(!confirm(`删除 “${b.title || "未命名"}”？`)) return;

    state.bookmarks = state.bookmarks.filter(x => x.id !== id);
    state.selectedIds.delete(id);
    persist();
    view.render();
  },

  batchAddTag() {
    if(state.selectedIds.size === 0) return;
    const input = prompt("给已选书签添加标签（逗号分隔）：", "");
    if(input == null) return;

    const add = utils.splitTags(input);
    if(!add.length) return;

    for(const b of state.bookmarks) {
      if(!state.selectedIds.has(b.id)) continue;

      const cur = b.tags || [];
      const seen = new Set(cur.map(t => t.toLowerCase()));
      for(const t of add) {
        const key = t.toLowerCase();
        if(!seen.has(key)) {
          seen.add(key);
          cur.push(t);
        }
      }
      b.tags = cur;
      b.updatedAt = utils.now();
    }

    persist();
    view.render();
  },

  batchDelete() {
    if(state.selectedIds.size === 0) return;
    if(!confirm(`删除已选 ${state.selectedIds.size} 条书签？`)) return;

    const del = new Set(state.selectedIds);
    state.bookmarks = state.bookmarks.filter(b => !del.has(b.id));
    state.selectedIds.clear();
    persist();
    view.render();
  },

  exportJson() {
    const payload = { exportedAt: utils.now(), bookmarks: state.bookmarks };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });

    const a = document.createElement("a");
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    a.download = `bookmarks-${y}-${m}-${day}.json`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  async importJson(file) {
    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { alert("导入失败：JSON 格式错误"); return; }

    const incoming = Array.isArray(parsed) ?
      parsed :
      (parsed && Array.isArray(parsed.bookmarks) ? parsed.bookmarks : null);

    if(!incoming) { alert("导入失败：未找到 bookmarks 数组"); return; }

    const mapByCanon = new Map();
    for(const b of state.bookmarks)
      if(b.urlCanonical) mapByCanon.set(b.urlCanonical, b);

    let added = 0;
    let updated = 0;

    for(const raw of incoming) {
      const title = utils.safeText(raw.title);
      const urlRes = utils.normalizeUrl(raw.url);
      if(!title || !urlRes.ok) continue;

      const canonical = urlRes.canonical;
      const stableId = utils.idFromCanonical(canonical);

      const next = {
        id: stableId,
        title,
        url: urlRes.url,
        urlCanonical: canonical,
        desc: utils.safeText(raw.desc),
        tags: Array.isArray(raw.tags) ? raw.tags.map(utils.safeText).filter(Boolean) : utils.splitTags(raw.tags),
        folder: utils.safeText(raw.folder),
        pinned: !!raw.pinned,
        createdAt: Number(raw.createdAt) || utils.now(),
        updatedAt: Number(raw.updatedAt) || utils.now()
      };

      const exist = mapByCanon.get(canonical);
      if(exist) {
        Object.assign(exist, next);
        updated++;
      } else {
        state.bookmarks.push(next);
        mapByCanon.set(canonical, next);
        added++;
      }
    }

    persist();
    view.render();
    alert(`导入完成：新增 ${added}，更新 ${updated}（无效条目已跳过）`);
  }
};

/* =========================
   submit
========================= */
actions.onSubmit = function onSubmit() {
  const title = utils.safeText(el.title.value);
  const urlRaw = utils.safeText(el.url.value);
  const desc = utils.safeText(el.desc.value);
  const tags = utils.splitTags(el.tags.value);
  const folder = utils.safeText(el.folder.value);
  const pinned = !!el.pinned.checked;
  const editingId = utils.safeText(el.editingId.value);

  const errors = {};
  if(!title) errors.title = "标题不能为空";

  const urlRes = utils.normalizeUrl(urlRaw);
  if(!urlRes.ok) errors.url = urlRes.reason;

  view.setFormErrors(errors);
  if(errors.title || errors.url) return;

  const canonical = urlRes.canonical;
  const stableId = utils.idFromCanonical(canonical);

  const existOther = state.bookmarks.find(b => b.urlCanonical === canonical && b.id !== editingId);
  if(existOther) {
    const goEdit = confirm("这个 URL 已存在。要去编辑已有条目吗？");
    if(goEdit) {
      modal.close();
      actions.openEdit(existOther.id);
    }
    return;
  }

  if(editingId) {
    const b = state.bookmarks.find(x => x.id === editingId);
    if(!b) return;

    const oldId = b.id;
    b.title = title;
    b.url = urlRes.url;
    b.urlCanonical = canonical;
    b.desc = desc;
    b.tags = tags;
    b.folder = folder;
    b.pinned = pinned;
    b.updatedAt = utils.now();

    if(stableId !== oldId) {
      b.id = stableId;
      if(state.selectedIds.has(oldId)) {
        state.selectedIds.delete(oldId);
        state.selectedIds.add(stableId);
      }
    }
  } else {
    const now = utils.now();
    state.bookmarks.push({
      id: stableId,
      title,
      url: urlRes.url,
      urlCanonical: canonical,
      desc,
      tags,
      folder,
      pinned,
      createdAt: now,
      updatedAt: now
    });
  }

  persist();
  view.render();
  modal.close();
};

/* =========================
   events
   keydown 捕获：Esc 关闭；Tab 焦点陷阱动态获取
   focusin：iOS 键盘遮挡时 scrollIntoView({block:"center"})
========================= */
function bindEvents() {
  el.btnBatchToggle.addEventListener("click", () => actions.toggleBatchFromTopbar());

  el.btnSelectAll.addEventListener("click", () => actions.selectAllVisibleToggle());
  el.btnBatchAddTagMain.addEventListener("click", () => actions.batchAddTag());
  el.btnBatchDeleteMain.addEventListener("click", () => actions.batchDelete());

  el.btnOpenDrawer.addEventListener("click", () => drawer.open(el.btnOpenDrawer));
  el.btnDrawerClose.addEventListener("click", () => drawer.close());
  el.drawerBackdrop.addEventListener("click", () => drawer.close());

  el.fabAdd.addEventListener("click", () => actions.openNew());
  el.btnClose.addEventListener("click", () => modal.close());
  el.btnCancel.addEventListener("click", () => modal.close());
  el.backdrop.addEventListener("click", () => modal.close());

  el.q.addEventListener("input", () => view.render());
  el.sort.addEventListener("change", () => view.render());
  el.filterFolder.addEventListener("change", () => view.render());
  el.filterTag.addEventListener("change", () => view.render());

  el.btnExport.addEventListener("click", () => actions.exportJson());
  el.fileImport.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if(!file) return;
    await actions.importJson(file);
  });

  /* 标签选择：追加到输入框（去重） */
  el.tagPicker.addEventListener("change", () => {
    const pick = utils.safeText(el.tagPicker.value);
    el.tagPicker.value = "";
    if(!pick) return;

    const cur = utils.splitTags(el.tags.value);
    const seen = new Set(cur.map(t => t.toLowerCase()));
    if(!seen.has(pick.toLowerCase())) cur.push(pick);
    el.tags.value = cur.join(", ");
  });

  /* 文件夹选择：覆盖输入框 */
  el.folderPicker.addEventListener("change", () => {
    const pick = utils.safeText(el.folderPicker.value);
    el.folderPicker.value = "";
    if(!pick) return;
    el.folder.value = pick;
  });

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    actions.onSubmit();
  });

  document.addEventListener("keydown", (e) => {
    if(!state.modalOpen && !state.drawerOpen) return;

    if(e.key === "Escape") {
      e.preventDefault();
      if(state.modalOpen) modal.close();
      else drawer.close();
      return;
    }

    if(e.key === "Tab") {
      const root = state.modalOpen ? el.modal : el.drawer;
      const focusables = utils.getFocusables(root);

      if(!focusables.length) {
        e.preventDefault();
        root.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if(e.shiftKey) {
        if(active === first || active === root) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if(active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }, true);

  document.addEventListener("focusin", (e) => {
    if(!state.modalOpen && !state.drawerOpen) return;
    const t = e.target;
    if(!(t instanceof HTMLElement)) return;

    const container = state.modalOpen ? el.modalContent : el.drawerContent;
    if(!container.contains(t)) return;

    const tag = t.tagName.toLowerCase();
    if(tag === "input" || tag === "textarea" || tag === "select") {
      try { t.scrollIntoView({ block: "center" }); } catch { t.scrollIntoView(); }
    }
  });
}

/* =========================
   init
========================= */
function persist() {
  storage.save(state.bookmarks);
}

function hydrate() {
  const loaded = storage.load();
  const next = [];

  for(const raw of loaded) {
    const title = utils.safeText(raw.title);
    const urlRes = utils.normalizeUrl(raw.url);
    if(!title || !urlRes.ok) continue;

    const canonical = urlRes.canonical;
    const stableId = utils.idFromCanonical(canonical);

    next.push({
      id: raw.id ? utils.safeText(raw.id) : stableId,
      title,
      url: urlRes.url,
      urlCanonical: canonical,
      desc: utils.safeText(raw.desc),
      tags: Array.isArray(raw.tags) ? raw.tags.map(utils.safeText).filter(Boolean) : utils.splitTags(raw.tags),
      folder: utils.safeText(raw.folder),
      pinned: !!raw.pinned,
      createdAt: Number(raw.createdAt) || utils.now(),
      updatedAt: Number(raw.updatedAt) || utils.now()
    });
  }

  state.bookmarks = next;
}

function init() {
  hydrate();
  bindEvents();
  view.render();
}

init();