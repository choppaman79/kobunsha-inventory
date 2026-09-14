// ===================== 設定 =====================
const MEMBERS = ["仙波","山崎","田中","落合","川野","迫","佐藤","二神","森重","小鷹","山根","熊澤"];
const CATEGORIES = ["神具","仏具","神向き用品","防災用品","その他"];
const COLLECTION = "inventory_products"; // 予定管理アプリのコレクションとは別名にして衝突を防止
const MOVEMENTS_COLLECTION = "inventory_movements"; // Phase2: 入出庫履歴

const auth = firebase.auth();
const db = firebase.firestore();
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

let allProducts = [];
let allMovements = [];
let allSlips = [];
let activeCategory = "すべて";
let editingId = null;
let movingProductId = null;
let currentStaffName = "";
let qrProductId = null;
let currentSlipItems = []; // 伝票作成中の品目リスト
let openSlipId = null;     // 現在開いている伝票詳細のID
const SLIPS_COLLECTION = "inventory_slips"; // Phase2追加: 出荷/入荷伝票

// ===================== 初期化 =====================
function init() {
  const loginSelect = document.getElementById("loginName");
  MEMBERS.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    loginSelect.appendChild(opt);
  });

  [document.getElementById("regCategory"), document.getElementById("editCategory")].forEach(sel => {
    CATEGORIES.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      sel.appendChild(opt);
    });
  });

  renderCategoryChips();

  document.getElementById("loginBtn").addEventListener("click", handleLogin);
  document.getElementById("logoutBtn").addEventListener("click", () => auth.signOut());
  document.getElementById("searchBox").addEventListener("input", renderProductList);
  document.getElementById("openAddBtn").addEventListener("click", () => switchTab("register"));
  document.getElementById("regSubmitBtn").addEventListener("click", handleRegisterSubmit);

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("editCancelBtn").addEventListener("click", closeEditModal);
  document.getElementById("editSaveBtn").addEventListener("click", handleEditSave);
  document.getElementById("editDeleteBtn").addEventListener("click", handleEditDelete);
  document.getElementById("editOverlay").addEventListener("click", (e) => {
    if (e.target.id === "editOverlay") closeEditModal();
  });

  // ---- Phase2: 入出庫モーダル ----
  document.getElementById("moveCancelBtn").addEventListener("click", closeMoveModal);
  document.getElementById("moveSaveBtn").addEventListener("click", handleMoveSave);
  document.getElementById("moveOverlay").addEventListener("click", (e) => {
    if (e.target.id === "moveOverlay") closeMoveModal();
  });
  document.querySelectorAll(".move-type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".move-type-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("moveType").value = btn.dataset.type;
    });
  });

  // ---- Phase2: 入出庫履歴タブ ----
  document.getElementById("historySearchBox").addEventListener("input", renderHistoryList);

  // ---- Phase2: QRモーダル ----
  document.getElementById("qrCloseBtn").addEventListener("click", closeQrModal);
  document.getElementById("qrPrintBtn").addEventListener("click", () => window.print());
  document.getElementById("qrOverlay").addEventListener("click", (e) => {
    if (e.target.id === "qrOverlay") closeQrModal();
  });
  document.getElementById("qrBulkPrintBtn").addEventListener("click", openQrBulkPrint);
  document.getElementById("qrBulkCloseBtn").addEventListener("click", () => {
    document.getElementById("qrBulkOverlay").classList.remove("show");
  });
  document.getElementById("qrBulkPrintOkBtn").addEventListener("click", () => window.print());
  document.getElementById("qrBulkOverlay").addEventListener("click", (e) => {
    if (e.target.id === "qrBulkOverlay") document.getElementById("qrBulkOverlay").classList.remove("show");
  });

  // ---- Phase2: エクセル一括登録 ----
  document.getElementById("excelFileInput").addEventListener("change", handleExcelFile);
  document.getElementById("excelImportBtn").addEventListener("click", handleExcelImport);

  // ---- Phase2: 伝票（出荷/入荷）----
  document.getElementById("slipCreateBtn").addEventListener("click", () => openSlipCreateModal("out"));
  document.querySelectorAll(".slip-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".slip-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderSlipList(btn.dataset.filter);
    });
  });
  document.getElementById("slipCreateCancelBtn").addEventListener("click", closeSlipCreateModal);
  document.getElementById("slipCreateSaveBtn").addEventListener("click", handleSlipCreateSave);
  document.getElementById("slipCreateOverlay").addEventListener("click", (e) => {
    if (e.target.id === "slipCreateOverlay") closeSlipCreateModal();
  });
  document.querySelectorAll(".slip-type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".slip-type-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("slipCreateType").value = btn.dataset.type;
    });
  });
  document.getElementById("slipItemAddBtn").addEventListener("click", handleSlipItemAdd);
  document.getElementById("slipItemProduct").addEventListener("change", handleSlipItemProductChange);

  document.getElementById("slipDetailCloseBtn").addEventListener("click", closeSlipDetailModal);
  document.getElementById("slipDetailPrintBtn").addEventListener("click", () => window.print());
  document.getElementById("slipDetailCompleteBtn").addEventListener("click", handleSlipComplete);
  document.getElementById("slipDetailOverlay").addEventListener("click", (e) => {
    if (e.target.id === "slipDetailOverlay") closeSlipDetailModal();
  });

  auth.onAuthStateChanged(user => {
    if (user) {
      showApp(user);
    } else {
      showLogin();
    }
  });
}

// ===================== ログイン =====================
function handleLogin() {
  const name = document.getElementById("loginName").value;
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  errorEl.textContent = "";

  if (!name || !password) {
    errorEl.textContent = "名前とパスワードを入力してください";
    return;
  }

  const email = `${name}@koubunsha.com`;
  auth.signInWithEmailAndPassword(email, password)
    .catch(err => {
      errorEl.textContent = "ログインできませんでした。パスワードをご確認ください。";
      console.error(err);
    });
}

function showLogin() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("appScreen").style.display = "none";
}

function showApp(user) {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("appScreen").style.display = "block";
  const name = user.email.split("@")[0];
  currentStaffName = name;
  document.getElementById("whoAmI").textContent = `${name} さん`;
  subscribeProducts();
  subscribeMovements();
  subscribeSlips();
}

// ===================== タブ切り替え =====================
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("tabList").style.display = tab === "list" ? "block" : "none";
  document.getElementById("tabRegister").style.display = tab === "register" ? "block" : "none";
  document.getElementById("tabHistory").style.display = tab === "history" ? "block" : "none";
  document.getElementById("tabSlips").style.display = tab === "slips" ? "block" : "none";
  if (tab === "history") renderHistoryList();
  if (tab === "slips") renderSlipList("all");
}

// ===================== 商品データ購読 =====================
function subscribeProducts() {
  db.collection(COLLECTION).orderBy("name").onSnapshot(snapshot => {
    allProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderSummary();
    renderProductList();
  }, err => {
    console.error(err);
    showToast("データの取得に失敗しました");
  });
}

// ===================== カテゴリチップ =====================
function renderCategoryChips() {
  const wrap = document.getElementById("categoryChips");
  wrap.innerHTML = "";
  ["すべて", ...CATEGORIES].forEach(cat => {
    const chip = document.createElement("button");
    chip.className = "chip" + (cat === activeCategory ? " active" : "");
    chip.textContent = cat;
    chip.addEventListener("click", () => {
      activeCategory = cat;
      renderCategoryChips();
      renderProductList();
    });
    wrap.appendChild(chip);
  });
}

// ===================== サマリー =====================
function renderSummary() {
  const total = allProducts.length;
  const lowCount = allProducts.filter(p => Number(p.currentStock) <= Number(p.minStock)).length;
  const wrap = document.getElementById("summaryRow");
  wrap.innerHTML = `
    <div class="summary-card">
      <div class="num">${total}</div>
      <div class="lbl">登録商品数</div>
    </div>
    <div class="summary-card ${lowCount > 0 ? "warn" : ""}">
      <div class="num">${lowCount}</div>
      <div class="lbl">在庫僅少</div>
    </div>
  `;
}

// ===================== 商品一覧 =====================
function renderProductList() {
  const keyword = document.getElementById("searchBox").value.trim().toLowerCase();
  const listEl = document.getElementById("productList");
  const emptyEl = document.getElementById("emptyState");

  let items = allProducts.filter(p => {
    const matchCat = activeCategory === "すべて" || p.category === activeCategory;
    const matchKeyword = !keyword || (p.name || "").toLowerCase().includes(keyword);
    return matchCat && matchKeyword;
  });

  listEl.innerHTML = "";
  emptyEl.style.display = items.length === 0 ? "block" : "none";

  items.forEach(p => {
    const isLow = Number(p.currentStock) <= Number(p.minStock);
    const row = document.createElement("div");
    row.className = "product-row" + (isLow ? " low" : "");
    row.innerHTML = `
      <div class="product-main">
        <div class="product-name">
          <span class="cat-tag">${p.category || "未分類"}</span>${escapeHtml(p.name || "")}
        </div>
        <div class="product-meta">${p.code ? "商品コード：" + escapeHtml(p.code) + "　/　" : ""}単位：${escapeHtml(p.unit || "-")}　/　僅少ライン：${p.minStock ?? 0}${p.price ? "　/　売価：¥" + Number(p.price).toLocaleString() : ""}${p.note ? "　/　" + escapeHtml(p.note) : ""}</div>
      </div>
      <div class="stock-control">
        <div class="stock-num ${isLow ? "low" : ""}">${p.currentStock ?? 0}</div>
        <span style="font-size:11px;color:#8a8272;">${escapeHtml(p.unit || "")}</span>
      </div>
      <button class="btn-move" data-action="move" data-id="${p.id}">入出庫</button>
      <button class="btn-qr" data-id="${p.id}">QR</button>
      <a class="edit-link" data-id="${p.id}">編集</a>
    `;
    listEl.appendChild(row);
  });

  listEl.querySelectorAll(".btn-move").forEach(btn => {
    btn.addEventListener("click", () => openMoveModal(btn.dataset.id));
  });
  listEl.querySelectorAll(".btn-qr").forEach(btn => {
    btn.addEventListener("click", () => openQrModal(btn.dataset.id));
  });
  listEl.querySelectorAll(".edit-link").forEach(link => {
    link.addEventListener("click", () => openEditModal(link.dataset.id));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===================== Phase2: 入出庫記録 =====================
function openMoveModal(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  movingProductId = id;
  document.getElementById("moveProductName").textContent = p.name || "";
  document.getElementById("moveCurrentStock").textContent = `現在庫：${p.currentStock ?? 0} ${p.unit || ""}`;
  document.getElementById("moveQty").value = 1;
  document.getElementById("moveNote").value = "";
  document.getElementById("moveType").value = "in";
  document.querySelectorAll(".move-type-btn").forEach(b => b.classList.toggle("active", b.dataset.type === "in"));
  document.getElementById("moveError").textContent = "";
  document.getElementById("moveOverlay").classList.add("show");
}

function closeMoveModal() {
  movingProductId = null;
  document.getElementById("moveOverlay").classList.remove("show");
}

function handleMoveSave() {
  if (!movingProductId) return;
  const product = allProducts.find(p => p.id === movingProductId);
  if (!product) return;

  const type = document.getElementById("moveType").value; // "in" or "out"
  const qty = Number(document.getElementById("moveQty").value);
  const note = document.getElementById("moveNote").value.trim();
  const errorEl = document.getElementById("moveError");
  errorEl.textContent = "";

  if (!qty || qty <= 0) {
    errorEl.textContent = "数量は1以上を入力してください";
    return;
  }

  const delta = type === "in" ? qty : -qty;
  const newStock = Number(product.currentStock || 0) + delta;

  if (newStock < 0) {
    errorEl.textContent = "現在庫数を超える出庫はできません";
    return;
  }

  const productRef = db.collection(COLLECTION).doc(movingProductId);
  const movementRef = db.collection(MOVEMENTS_COLLECTION).doc();

  db.runTransaction(tx => {
    return tx.get(productRef).then(doc => {
      if (!doc.exists) throw new Error("商品が見つかりません");
      const latestStock = Number(doc.data().currentStock || 0);
      const latestNewStock = type === "in" ? latestStock + qty : latestStock - qty;
      if (latestNewStock < 0) throw new Error("在庫不足");
      tx.update(productRef, { currentStock: latestNewStock });
      tx.set(movementRef, {
        productId: movingProductId,
        productName: product.name || "",
        category: product.category || "",
        unit: product.unit || "",
        type,
        qty,
        note,
        staff: currentStaffName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  }).then(() => {
    showToast(type === "in" ? "入庫を記録しました" : "出庫を記録しました");
    closeMoveModal();
  }).catch(err => {
    console.error(err);
    if (err.message === "在庫不足") {
      errorEl.textContent = "現在庫数を超える出庫はできません";
    } else {
      errorEl.textContent = "";
      showToast("記録に失敗しました");
    }
  });
}

// ===================== Phase2: 入出庫履歴 =====================
function subscribeMovements() {
  db.collection(MOVEMENTS_COLLECTION).orderBy("createdAt", "desc").limit(200).onSnapshot(snapshot => {
    allMovements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (document.getElementById("tabHistory").style.display !== "none") {
      renderHistoryList();
    }
  }, err => {
    console.error(err);
  });
}

function renderHistoryList() {
  const keyword = document.getElementById("historySearchBox").value.trim().toLowerCase();
  const listEl = document.getElementById("historyList");
  const emptyEl = document.getElementById("historyEmptyState");

  const items = allMovements.filter(m => !keyword || (m.productName || "").toLowerCase().includes(keyword));

  listEl.innerHTML = "";
  emptyEl.style.display = items.length === 0 ? "block" : "none";

  items.forEach(m => {
    const row = document.createElement("div");
    row.className = "history-row";
    const dt = m.createdAt && m.createdAt.toDate ? formatDateTime(m.createdAt.toDate()) : "―";
    const sign = m.type === "in" ? "+" : "−";
    const typeLabel = m.type === "in" ? "入庫" : "出庫";
    row.innerHTML = `
      <div class="history-main">
        <div class="history-top">
          <span class="history-type ${m.type}">${typeLabel}</span>
          <span class="history-name">${escapeHtml(m.productName || "")}</span>
        </div>
        <div class="history-meta">${dt}　/　${escapeHtml(m.staff || "-")}さん${m.note ? "　/　" + escapeHtml(m.note) : ""}</div>
      </div>
      <div class="history-qty ${m.type}">${sign}${m.qty ?? 0}${escapeHtml(m.unit || "")}</div>
    `;
    listEl.appendChild(row);
  });
}

function formatDateTime(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ===================== Phase2: QRコード =====================
function openQrModal(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  qrProductId = id;
  document.getElementById("qrProductName").textContent = p.name || "";
  document.getElementById("qrProductCode").textContent = p.code ? `商品コード：${p.code}` : "";
  const box = document.getElementById("qrCanvasBox");
  box.innerHTML = "";
  // QRコードにはドキュメントIDを埋め込む（バーコード読取時にそのままproductIdとして検索できるように）
  new QRCode(box, {
    text: id,
    width: 180,
    height: 180,
    correctLevel: QRCode.CorrectLevel.M
  });
  document.getElementById("qrOverlay").classList.add("show");
}

function closeQrModal() {
  qrProductId = null;
  document.getElementById("qrOverlay").classList.remove("show");
}

function openQrBulkPrint() {
  const keyword = document.getElementById("searchBox").value.trim().toLowerCase();
  const items = allProducts.filter(p => {
    const matchCat = activeCategory === "すべて" || p.category === activeCategory;
    const matchKeyword = !keyword || (p.name || "").toLowerCase().includes(keyword);
    return matchCat && matchKeyword;
  });
  if (items.length === 0) {
    showToast("印刷対象の商品がありません");
    return;
  }
  const grid = document.getElementById("qrBulkGrid");
  grid.innerHTML = "";
  items.forEach(p => {
    const cell = document.createElement("div");
    cell.className = "qr-label";
    const qrBox = document.createElement("div");
    cell.appendChild(qrBox);
    const label = document.createElement("div");
    label.className = "qr-label-text";
    label.innerHTML = `${escapeHtml(p.name || "")}${p.code ? "<br>" + escapeHtml(p.code) : ""}`;
    cell.appendChild(label);
    grid.appendChild(cell);
    new QRCode(qrBox, { text: p.id, width: 110, height: 110, correctLevel: QRCode.CorrectLevel.M });
  });
  document.getElementById("qrBulkOverlay").classList.add("show");
}

// ===================== Phase2: エクセル一括登録 =====================
let excelParsedRows = [];

function handleExcelFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = new Uint8Array(ev.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
      excelParsedRows = rows.map(mapExcelRow).filter(r => r.name);
      renderExcelPreview();
    } catch (err) {
      console.error(err);
      showToast("ファイルの読み込みに失敗しました");
    }
  };
  reader.readAsArrayBuffer(file);
}

function mapExcelRow(row) {
  // 列名の表記ゆれを吸収（商品コード/コード/品番、商品名/名称、売価/価格/単価 など）
  const get = (keys) => {
    for (const k of Object.keys(row)) {
      const norm = k.replace(/\s/g, "");
      if (keys.includes(norm)) return row[k];
    }
    return "";
  };
  return {
    code: String(get(["商品コード", "コード", "品番", "code"]) || "").trim(),
    name: String(get(["商品名", "名称", "品名", "name"]) || "").trim(),
    category: String(get(["分類", "カテゴリ", "category"]) || "").trim(),
    unit: String(get(["単位", "unit"]) || "個").trim(),
    price: Number(get(["売価", "価格", "単価", "price"])) || 0,
    minStock: Number(get(["在庫僅少ライン", "僅少ライン", "minStock"])) || 3,
    stock: Number(get(["現在庫数", "在庫数", "stock"])) || 0,
    note: String(get(["備考", "note"]) || "").trim()
  };
}

function renderExcelPreview() {
  const wrap = document.getElementById("excelPreviewWrap");
  const tbody = document.getElementById("excelPreviewBody");
  tbody.innerHTML = "";
  if (excelParsedRows.length === 0) {
    wrap.style.display = "none";
    return;
  }
  excelParsedRows.slice(0, 500).forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.code)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.category)}</td>
      <td>${escapeHtml(r.unit)}</td>
      <td>${r.price}</td>
      <td>${r.stock}</td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById("excelPreviewCount").textContent = `${excelParsedRows.length}件を読み込みました`;
  wrap.style.display = "block";
}

function handleExcelImport() {
  if (excelParsedRows.length === 0) {
    showToast("先にエクセル/CSVファイルを選択してください");
    return;
  }
  const btn = document.getElementById("excelImportBtn");
  btn.disabled = true;
  btn.textContent = "登録中...";

  // Firestoreのバッチ書き込みは1回500件まで
  const chunks = [];
  for (let i = 0; i < excelParsedRows.length; i += 400) {
    chunks.push(excelParsedRows.slice(i, i + 400));
  }

  const runChunk = (idx) => {
    if (idx >= chunks.length) {
      showToast(`${excelParsedRows.length}件の商品を登録しました`);
      excelParsedRows = [];
      document.getElementById("excelFileInput").value = "";
      renderExcelPreview();
      btn.disabled = false;
      btn.textContent = "この内容で一括登録する";
      switchTab("list");
      return;
    }
    const batch = db.batch();
    chunks[idx].forEach(r => {
      const ref = db.collection(COLLECTION).doc();
      batch.set(ref, {
        name: r.name,
        code: r.code,
        category: r.category || CATEGORIES[0],
        unit: r.unit || "個",
        price: r.price || 0,
        currentStock: r.stock || 0,
        minStock: r.minStock || 3,
        note: r.note || "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    batch.commit().then(() => runChunk(idx + 1)).catch(err => {
      console.error(err);
      showToast("登録中にエラーが発生しました");
      btn.disabled = false;
      btn.textContent = "この内容で一括登録する";
    });
  };
  runChunk(0);
}

// ===================== Phase2: 伝票（出荷/入荷）・検品 =====================
function subscribeSlips() {
  db.collection(SLIPS_COLLECTION).orderBy("createdAt", "desc").limit(200).onSnapshot(snapshot => {
    allSlips = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (document.getElementById("tabSlips").style.display !== "none") {
      renderSlipList(getActiveSlipFilter());
    }
  }, err => console.error(err));
}

function getActiveSlipFilter() {
  const active = document.querySelector(".slip-filter-btn.active");
  return active ? active.dataset.filter : "all";
}

function renderSlipList(filter) {
  const listEl = document.getElementById("slipList");
  const emptyEl = document.getElementById("slipEmptyState");
  let items = allSlips;
  if (filter === "out") items = items.filter(s => s.type === "out");
  if (filter === "in") items = items.filter(s => s.type === "in");
  if (filter === "draft") items = items.filter(s => s.status !== "done");
  if (filter === "done") items = items.filter(s => s.status === "done");

  listEl.innerHTML = "";
  emptyEl.style.display = items.length === 0 ? "block" : "none";

  items.forEach(s => {
    const row = document.createElement("div");
    row.className = "slip-row";
    const dt = s.createdAt && s.createdAt.toDate ? formatDateTime(s.createdAt.toDate()) : "―";
    const typeLabel = s.type === "in" ? "入荷" : "出荷";
    const statusLabel = s.status === "done" ? "検品完了" : "未検品";
    row.innerHTML = `
      <div class="slip-main">
        <div class="slip-top">
          <span class="history-type ${s.type === "in" ? "in" : "out"}">${typeLabel}</span>
          <span class="slip-number">${escapeHtml(s.slipNumber || "")}</span>
          <span class="slip-status ${s.status === "done" ? "done" : ""}">${statusLabel}</span>
        </div>
        <div class="history-meta">${escapeHtml(s.partner || "取引先未設定")}　/　${dt}　/　品目数：${(s.items || []).length}</div>
      </div>
    `;
    row.addEventListener("click", () => openSlipDetailModal(s.id));
    listEl.appendChild(row);
  });
}

// ---- 伝票の新規作成 ----
function openSlipCreateModal(type) {
  currentSlipItems = [];
  document.getElementById("slipCreateType").value = type;
  document.querySelectorAll(".slip-type-btn").forEach(b => b.classList.toggle("active", b.dataset.type === type));
  document.getElementById("slipPartner").value = "";
  document.getElementById("slipMemo").value = "";
  const productSelect = document.getElementById("slipItemProduct");
  productSelect.innerHTML = `<option value="">商品を選択...</option>` +
    allProducts.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.code ? "（" + escapeHtml(p.code) + "）" : ""}</option>`).join("");
  document.getElementById("slipItemQty").value = 1;
  renderSlipItemsEditor();
  document.getElementById("slipCreateOverlay").classList.add("show");
}

function closeSlipCreateModal() {
  document.getElementById("slipCreateOverlay").classList.remove("show");
}

function handleSlipItemProductChange() {
  const id = document.getElementById("slipItemProduct").value;
  const p = allProducts.find(x => x.id === id);
  document.getElementById("slipItemStockHint").textContent = p ? `現在庫：${p.currentStock ?? 0}${p.unit || ""}` : "";
}

function handleSlipItemAdd() {
  const productId = document.getElementById("slipItemProduct").value;
  const qty = Number(document.getElementById("slipItemQty").value);
  const p = allProducts.find(x => x.id === productId);
  if (!p) { showToast("商品を選択してください"); return; }
  if (!qty || qty <= 0) { showToast("数量は1以上を入力してください"); return; }

  const existing = currentSlipItems.find(i => i.productId === productId);
  if (existing) {
    existing.plannedQty += qty;
  } else {
    currentSlipItems.push({
      productId, productName: p.name, code: p.code || "", unit: p.unit || "",
      plannedQty: qty, checkedQty: 0, checked: false
    });
  }
  document.getElementById("slipItemQty").value = 1;
  renderSlipItemsEditor();
}

function renderSlipItemsEditor() {
  const wrap = document.getElementById("slipItemsEditor");
  wrap.innerHTML = "";
  if (currentSlipItems.length === 0) {
    wrap.innerHTML = `<p style="font-size:12px;color:#8a8272;">まだ品目がありません</p>`;
    return;
  }
  currentSlipItems.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "slip-item-row";
    row.innerHTML = `
      <div class="slip-item-name">${escapeHtml(item.productName)}${item.code ? "（" + escapeHtml(item.code) + "）" : ""}</div>
      <div class="slip-item-qty">${item.plannedQty}${escapeHtml(item.unit)}</div>
      <button type="button" class="slip-item-remove" data-idx="${idx}">×</button>
    `;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll(".slip-item-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      currentSlipItems.splice(Number(btn.dataset.idx), 1);
      renderSlipItemsEditor();
    });
  });
}

function generateSlipNumber(type) {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const prefix = type === "in" ? "NYU" : "SYK";
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `${prefix}-${dateStr}-${rand}`;
}

function handleSlipCreateSave() {
  if (currentSlipItems.length === 0) {
    showToast("品目を1件以上追加してください");
    return;
  }
  const type = document.getElementById("slipCreateType").value;
  const partner = document.getElementById("slipPartner").value.trim();
  const memo = document.getElementById("slipMemo").value.trim();

  db.collection(SLIPS_COLLECTION).add({
    type,
    slipNumber: generateSlipNumber(type),
    partner,
    memo,
    status: "draft",
    items: currentSlipItems,
    staff: currentStaffName,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    showToast("伝票を作成しました");
    closeSlipCreateModal();
  }).catch(err => {
    console.error(err);
    showToast("伝票の作成に失敗しました");
  });
}

// ---- 伝票の詳細・検品・印刷 ----
function openSlipDetailModal(id) {
  const s = allSlips.find(x => x.id === id);
  if (!s) return;
  openSlipId = id;
  const typeLabel = s.type === "in" ? "入荷伝票" : "出荷伝票";
  document.getElementById("slipDetailTitle").textContent = typeLabel;
  document.getElementById("slipDetailNumber").textContent = s.slipNumber || "";
  document.getElementById("slipDetailPartner").textContent = s.partner || "取引先未設定";
  document.getElementById("slipDetailDate").textContent = s.createdAt && s.createdAt.toDate ? formatDateTime(s.createdAt.toDate()) : "";
  document.getElementById("slipDetailStaff").textContent = s.staff ? `作成：${s.staff}さん` : "";
  document.getElementById("slipDetailMemo").textContent = s.memo || "";

  const tbody = document.getElementById("slipDetailBody");
  tbody.innerHTML = "";
  const isDone = s.status === "done";
  (s.items || []).forEach((item, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.productName)}</td>
      <td>${escapeHtml(item.code || "")}</td>
      <td>${item.plannedQty}${escapeHtml(item.unit || "")}</td>
      <td class="no-print">
        <input type="number" class="slip-check-qty" data-idx="${idx}" min="0" value="${item.checkedQty ?? item.plannedQty}" ${isDone ? "disabled" : ""}>
      </td>
      <td class="print-only">${item.checkedQty ?? ""}${escapeHtml(item.unit || "")}</td>
      <td class="no-print">
        <input type="checkbox" class="slip-check-box" data-idx="${idx}" ${item.checked ? "checked" : ""} ${isDone ? "disabled" : ""}>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("slipDetailCompleteBtn").style.display = isDone ? "none" : "block";
  document.getElementById("slipDetailDoneNote").style.display = isDone ? "block" : "none";
  document.getElementById("slipDetailOverlay").classList.add("show");
}

function closeSlipDetailModal() {
  openSlipId = null;
  document.getElementById("slipDetailOverlay").classList.remove("show");
}

function handleSlipComplete() {
  const s = allSlips.find(x => x.id === openSlipId);
  if (!s) return;
  if (!confirm("検品を完了し、在庫に反映します。よろしいですか？")) return;

  // 画面上の確認数・チェック状態を取得
  const items = (s.items || []).map((item, idx) => {
    const qtyInput = document.querySelector(`.slip-check-qty[data-idx="${idx}"]`);
    const checkBox = document.querySelector(`.slip-check-box[data-idx="${idx}"]`);
    return {
      ...item,
      checkedQty: qtyInput ? Number(qtyInput.value) || 0 : item.plannedQty,
      checked: checkBox ? checkBox.checked : false
    };
  });

  const slipRef = db.collection(SLIPS_COLLECTION).doc(openSlipId);
  const btn = document.getElementById("slipDetailCompleteBtn");
  btn.disabled = true;
  btn.textContent = "反映中...";

  db.runTransaction(tx => {
    return Promise.all(items.map(item => {
      const productRef = db.collection(COLLECTION).doc(item.productId);
      return tx.get(productRef).then(doc => ({ doc, item, productRef }));
    })).then(results => {
      results.forEach(({ doc, item, productRef }) => {
        if (!doc.exists) return;
        const latestStock = Number(doc.data().currentStock || 0);
        const delta = s.type === "in" ? item.checkedQty : -item.checkedQty;
        const newStock = Math.max(0, latestStock + delta);
        tx.update(productRef, { currentStock: newStock });
        const movementRef = db.collection(MOVEMENTS_COLLECTION).doc();
        tx.set(movementRef, {
          productId: item.productId,
          productName: item.productName,
          unit: item.unit || "",
          type: s.type,
          qty: item.checkedQty,
          note: `伝票 ${s.slipNumber} による検品反映`,
          staff: currentStaffName,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      tx.update(slipRef, {
        items,
        status: "done",
        completedAt: firebase.firestore.FieldValue.serverTimestamp(),
        completedBy: currentStaffName
      });
    });
  }).then(() => {
    showToast("検品を完了し、在庫に反映しました");
    closeSlipDetailModal();
  }).catch(err => {
    console.error(err);
    showToast("反映に失敗しました");
  }).finally(() => {
    btn.disabled = false;
    btn.textContent = "検品完了として記録する";
  });
}

// ===================== 商品登録 =====================
function handleRegisterSubmit() {
  const name = document.getElementById("regName").value.trim();
  const code = document.getElementById("regCode").value.trim();
  const category = document.getElementById("regCategory").value;
  const unit = document.getElementById("regUnit").value.trim() || "個";
  const price = Number(document.getElementById("regPrice").value) || 0;
  const stock = Number(document.getElementById("regStock").value) || 0;
  const minStock = Number(document.getElementById("regMinStock").value) || 0;
  const note = document.getElementById("regNote").value.trim();

  if (!name) {
    showToast("商品名を入力してください");
    return;
  }

  db.collection(COLLECTION).add({
    name, code, category, unit,
    price,
    currentStock: stock,
    minStock: minStock,
    note,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    showToast("商品を登録しました");
    document.getElementById("regName").value = "";
    document.getElementById("regCode").value = "";
    document.getElementById("regUnit").value = "個";
    document.getElementById("regPrice").value = "";
    document.getElementById("regStock").value = 0;
    document.getElementById("regMinStock").value = 3;
    document.getElementById("regNote").value = "";
    switchTab("list");
  }).catch(err => {
    console.error(err);
    showToast("登録に失敗しました");
  });
}

// ===================== 商品編集 =====================
function openEditModal(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById("editName").value = p.name || "";
  document.getElementById("editCode").value = p.code || "";
  document.getElementById("editCategory").value = p.category || CATEGORIES[0];
  document.getElementById("editUnit").value = p.unit || "";
  document.getElementById("editPrice").value = p.price ?? "";
  document.getElementById("editStock").value = p.currentStock ?? 0;
  document.getElementById("editMinStock").value = p.minStock ?? 0;
  document.getElementById("editNote").value = p.note || "";
  document.getElementById("editOverlay").classList.add("show");
}

function closeEditModal() {
  editingId = null;
  document.getElementById("editOverlay").classList.remove("show");
}

function handleEditSave() {
  if (!editingId) return;
  const data = {
    name: document.getElementById("editName").value.trim(),
    code: document.getElementById("editCode").value.trim(),
    category: document.getElementById("editCategory").value,
    unit: document.getElementById("editUnit").value.trim(),
    price: Number(document.getElementById("editPrice").value) || 0,
    currentStock: Number(document.getElementById("editStock").value) || 0,
    minStock: Number(document.getElementById("editMinStock").value) || 0,
    note: document.getElementById("editNote").value.trim()
  };
  db.collection(COLLECTION).doc(editingId).update(data)
    .then(() => { showToast("保存しました"); closeEditModal(); })
    .catch(err => { console.error(err); showToast("保存に失敗しました"); });
}

function handleEditDelete() {
  if (!editingId) return;
  if (!confirm("この商品を削除しますか？")) return;
  db.collection(COLLECTION).doc(editingId).delete()
    .then(() => { showToast("削除しました"); closeEditModal(); })
    .catch(err => { console.error(err); showToast("削除に失敗しました"); });
}

// ===================== トースト =====================
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

init();
