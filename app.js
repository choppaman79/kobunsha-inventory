// ===================== 設定 =====================
const MEMBERS = ["仙波","山崎","田中","落合","川野","迫","佐藤","二神","森重","小鷹","山根","熊澤"];
const CATEGORIES = ["神具","仏具","神向き用品","チェーン","非常用品","その他"];
const COLLECTION = "inventory_products"; // 予定管理アプリのコレクションとは別名にして衝突を防止
const MOVEMENTS_COLLECTION = "inventory_movements"; // Phase2: 入出庫履歴

const auth = firebase.auth();
const db = firebase.firestore();
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

let allProducts = [];
let bulkMode = false;
const bulkSelected = new Set();
const historySelected = new Set();
const slipSelected = new Set();
const STOCKTAKES = "inventory_stocktakes";
const FESTIVALS = "inventory_festival_plans";
const DISASTER_PRODUCTS = "inventory_disaster_products";
const DISASTER_MOVEMENTS = "inventory_disaster_movements";
let stocktakeRecord = null, festivalRecord = null, disasterProducts = [], disasterMovements = [];
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

// ---- Phase4: 発注管理・在庫僅少の自動通知 ----
const ORDERS_COLLECTION = "inventory_orders";
let allOrders = [];
let currentOrderItems = []; // 発注作成中の品目リスト
let openOrderId = null;
let previousLowStockIds = null; // 直近の「発注が必要な在庫僅少商品」ID集合（差分検知用。nullは未計算＝初回）
let browserNotifyEnabled = false;

// ---- Phase3: カメラスキャン関連 ----
let scanStream = null;
let scanRAF = null;
let scanMode = "global"; // "global" または "slip-item"
let pendingHashHandled = false;
let pendingSlipScanCode = null; // 検品シール照合：1回目にスキャンしたコードを一時保持
let slipScannerActive = false;
let slipScannerIdleTimer = null;

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
  initWorkModules();

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
  document.getElementById("qrPrintBtn").addEventListener("click", () => printProductQrLabel(qrProductId));
  document.getElementById("qrOverlay").addEventListener("click", (e) => {
    if (e.target.id === "qrOverlay") closeQrModal();
  });
  document.getElementById("qrBulkPrintBtn").addEventListener("click", openQrBulkPrint);
  document.getElementById("qrBulkCloseBtn").addEventListener("click", () => {
    document.getElementById("qrBulkOverlay").classList.remove("show");
  });
  document.getElementById("qrBulkPrintOkBtn").addEventListener("click", () => {
    document.body.classList.add("label-print");
    document.body.classList.remove("slip-print", "work-print");
    setTimeout(() => window.print(), 30);
  });
  document.getElementById("qrBulkOverlay").addEventListener("click", (e) => {
    if (e.target.id === "qrBulkOverlay") document.getElementById("qrBulkOverlay").classList.remove("show");
  });

  // ---- Phase2: エクセル一括登録 ----
  document.getElementById("excelFileInput").addEventListener("change", handleExcelFile);
  document.getElementById("excelImportBtn").addEventListener("click", handleExcelImport);

  // ---- Phase2: 伝票（出荷/入荷）----
  document.getElementById("slipCreateOutBtn").addEventListener("click", () => openSlipCreateModal("out"));
  document.getElementById("slipCreateInBtn").addEventListener("click", () => openSlipCreateModal("in"));
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
  document.getElementById("slipItemAddBtn").addEventListener("click", handleSlipItemAdd);
  document.getElementById("slipItemProduct").addEventListener("change", handleSlipItemProductChange);
  document.getElementById("slipItemCodeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSlipItemCodeLookup();
    }
  });
  document.getElementById("slipItemQty").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSlipItemAdd();
    }
  });
  document.getElementById("slipItemQty").addEventListener("input", updateSlipItemAmountPreview);
  document.getElementById("slipItemPrice").addEventListener("input", updateSlipItemAmountPreview);

  document.getElementById("slipDetailCloseBtn").addEventListener("click", closeSlipDetailModal);
  document.getElementById("slipDetailPrintCheckBtn").addEventListener("click", () => printSlipSheet("check"));
  document.getElementById("slipDetailPrintDeliveryBtn").addEventListener("click", () => printSlipSheet("delivery"));
  document.getElementById("slipDetailCompleteBtn").addEventListener("click", handleSlipComplete);
  document.getElementById("slipDetailOverlay").addEventListener("click", (e) => {
    if (e.target.id === "slipDetailOverlay") closeSlipDetailModal();
  });
  document.getElementById("slipDetailScanBtn").addEventListener("click", () => openScanModal("slip-item"));
  document.getElementById("slipBluetoothModeBtn").addEventListener("click", () => setSlipScannerMode(!slipScannerActive));
  document.getElementById("slipScanFocusBtn").addEventListener("click", () => {
    if (!slipScannerActive) setSlipScannerMode(true);
    document.getElementById("slipItemScannerInput").focus();
  });
  document.getElementById("slipReceivingLabelBtn").addEventListener("click", () => printSlipReceivingLabels(openSlipId));
  document.getElementById("slipPickLabelBtn").addEventListener("click", () => printSlipPickLabels(openSlipId));

  // ---- Phase4: 発注管理 ----
  document.getElementById("lowStockCreateOrderBtn").addEventListener("click", handleCreateOrderFromLowStock);
  document.getElementById("orderNotifyBtn").addEventListener("click", handleEnableBrowserNotify);
  document.querySelectorAll(".order-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".order-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderOrderList(btn.dataset.filter);
    });
  });
  document.getElementById("orderCreateBtn").addEventListener("click", openSupplierOrder);
  document.getElementById("orderSupplierSelect").addEventListener("change", () => renderOrderList(getActiveOrderFilter()));
  document.getElementById("createSupplierOrderBtn").addEventListener("click", openSupplierOrder);
  document.getElementById("orderAddSupplierItemsBtn").addEventListener("click", addSupplierOrderItems);
  document.getElementById("orderCreateCancelBtn").addEventListener("click", closeOrderCreateModal);
  document.getElementById("orderCreateSaveBtn").addEventListener("click", handleOrderCreateSave);
  document.getElementById("orderCreateOverlay").addEventListener("click", (e) => {
    if (e.target.id === "orderCreateOverlay") closeOrderCreateModal();
  });
  document.getElementById("orderItemAddBtn").addEventListener("click", handleOrderItemAdd);
  document.getElementById("orderItemProduct").addEventListener("change", handleOrderItemProductChange);
  document.getElementById("orderItemCodeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleOrderItemCodeLookup(); }
  });
  document.getElementById("orderItemQty").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleOrderItemAdd(); }
  });
  document.getElementById("orderDetailCloseBtn").addEventListener("click", closeOrderDetailModal);
  document.getElementById("orderDetailPrintBtn").addEventListener("click", () => { document.body.classList.add("order-print"); window.print(); });
  document.getElementById("orderMarkOrderedBtn").addEventListener("click", handleOrderMarkOrdered);
  document.getElementById("orderMarkReceivedBtn").addEventListener("click", handleOrderMarkReceived);
  document.getElementById("orderCancelBtn").addEventListener("click", handleOrderCancel);
  document.getElementById("orderDetailOverlay").addEventListener("click", (e) => {
    if (e.target.id === "orderDetailOverlay") closeOrderDetailModal();
  });

  // ---- Phase3: カメラスキャン ----
  document.getElementById("scanGlobalBtn").addEventListener("click", () => openScanModal("global"));
  document.getElementById("scanGlobalBtn2").addEventListener("click", () => openScanModal("global"));
  document.getElementById("scanCloseBtn").addEventListener("click", closeScanModal);
  document.getElementById("scanOverlay").addEventListener("click", (e) => {
    if (e.target.id === "scanOverlay") closeScanModal();
  });

  // ---- Phase3.5: ハンディスキャナー（キーボード入力）----
  ["scannerInput", "scannerInputSlips"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleScannerWedgeInput(e.target, "global");
      }
    });
  });
  document.getElementById("slipItemScannerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      clearTimeout(slipScannerIdleTimer);
      handleScannerWedgeInput(e.target, "slip-item");
    }
  });
  document.getElementById("slipItemScannerInput").addEventListener("input", e => {
    clearTimeout(slipScannerIdleTimer);
    slipScannerIdleTimer = setTimeout(() => {
      if (slipScannerActive && resolveScannedProductId(e.target.value.trim())) handleScannerWedgeInput(e.target,"slip-item");
    }, 450);
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
  subscribeOrders();
  subscribeDisaster();
  browserNotifyEnabled = (typeof Notification !== "undefined" && Notification.permission === "granted");
  updateNotifyBtnLabel();
}

// ===================== タブ切り替え =====================
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("tabList").style.display = tab === "list" ? "block" : "none";
  document.getElementById("tabRegister").style.display = tab === "register" ? "block" : "none";
  document.getElementById("tabHistory").style.display = tab === "history" ? "block" : "none";
  document.getElementById("tabSlips").style.display = tab === "slips" ? "block" : "none";
  document.getElementById("tabOrders").style.display = tab === "orders" ? "block" : "none";
  ["stocktake","festival","disaster"].forEach(t => { const panel = document.getElementById("tab" + t[0].toUpperCase() + t.slice(1)); if (panel) panel.style.display = tab === t ? "block" : "none"; });
  document.querySelectorAll("main > section").forEach(el => el.classList.toggle("print-target", el.style.display !== "none"));
  if (tab === "stocktake" && $w("stocktakeDate")) loadStocktake();
  if (tab === "festival" && $w("festivalMonth")) loadFestival();
  if (tab === "history") renderHistoryList();
  if (tab === "slips") renderSlipList("all");
  if (tab === "orders") { renderLowStockAlert(); renderOrderList(getActiveOrderFilter()); }
  // ハンディスキャナーがすぐ使えるよう、該当タブの入力欄に自動でフォーカス
  if (tab === "list") setTimeout(() => document.getElementById("scannerInput").focus(), 50);
  if (tab === "slips") setTimeout(() => document.getElementById("scannerInputSlips").focus(), 50);
}

// ===================== 商品データ購読 =====================
function subscribeProducts() {
  db.collection(COLLECTION).orderBy("name").onSnapshot(snapshot => {
    allProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderCategoryChips();
    refreshOrderSupplierOptions();
    renderSummary();
    renderProductList();
    renderStocktake(); renderFestival();
    checkLowStockAutoNotify();
    if (document.getElementById("tabOrders").style.display !== "none") renderLowStockAlert();
    handlePendingHash();
  }, err => {
    console.error(err);
    showToast("データの取得に失敗しました");
  });
}

// ===================== カテゴリチップ =====================
function renderCategoryChips() {
  const wrap = document.getElementById("categoryChips");
  wrap.innerHTML = "";
  const categories = [...new Set([...CATEGORIES, ...allProducts.map(p => p.category).filter(Boolean)])];
  ["すべて", ...categories].forEach(cat => {
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
    const matchKeyword = !keyword || [p.name, p.code, p.supplier].some(value => String(value || "").toLowerCase().includes(keyword));
    return matchCat && matchKeyword;
  });

  listEl.innerHTML = "";
  emptyEl.style.display = items.length === 0 ? "block" : "none";

  items.forEach(p => {
    const isLow = Number(p.currentStock) <= Number(p.minStock);
    const row = document.createElement("div");
    row.className = "product-row" + (isLow ? " low" : "");
    row.innerHTML = `
      ${bulkMode ? `<input type="checkbox" class="bulk-check" data-id="${p.id}" ${bulkSelected.has(p.id) ? "checked" : ""} aria-label="${escapeHtml(p.name)}を選択" style="width:20px;flex-shrink:0;">` : ""}
      <div class="product-fields">
        <div class="product-field"><span class="field-label">商品名</span>${escapeHtml(p.name || "")}</div>
        <div class="product-field"><span class="field-label">商品コード</span>${escapeHtml(p.code || "―")}</div>
        <div class="product-field"><span class="field-label">仕入れ先</span>${escapeHtml(p.supplier || "―")}</div>
        <div class="product-field"><span class="field-label">単価</span>¥${Number(p.price || 0).toLocaleString()}</div>
        <div class="product-field"><span class="field-label">ロット</span>${escapeHtml(p.lot || "―")}</div>
        <div class="product-field"><span class="field-label">分類</span>${escapeHtml(p.category || "未分類")}</div>
        <div class="product-field"><span class="field-label">備考</span>${escapeHtml(p.note || "―")}</div>
      </div>
      <div class="product-actions"><div class="stock-control" title="現在庫数（僅少ライン：${Number(p.minStock || 0)}）">
        <div class="stock-num ${isLow ? "low" : ""}">${p.currentStock ?? 0}</div>
        <span style="font-size:11px;color:#8a8272;">${escapeHtml(p.unit || "")}</span>
      </div>
      <button class="btn-move" data-action="move" data-id="${p.id}">入出庫</button>
      <button class="btn-qr" data-id="${p.id}">QR</button>
      <a class="edit-link" data-id="${p.id}">編集</a>
      </div>
    `;
    listEl.appendChild(row);
  });

  listEl.querySelectorAll(".bulk-check").forEach(box => box.addEventListener("change", () => { if (box.checked) bulkSelected.add(box.dataset.id); else bulkSelected.delete(box.dataset.id); updateBulkButton(); }));
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

function labelTableCells(tbody) {
  if (!tbody) return;
  const headings = [...tbody.closest("table").querySelectorAll("thead th")].map(th => th.textContent.trim());
  tbody.querySelectorAll("tr").forEach(row => {
    [...row.children].forEach((cell, index) => { cell.dataset.label = headings[index] || ""; });
  });
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
      if (latestNewStock < Number(doc.data().reservedStock||0)) throw new Error("在庫不足");
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
  db.collection(MOVEMENTS_COLLECTION).orderBy("createdAt", "desc").onSnapshot(snapshot => {
    allMovements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    [...historySelected].forEach(id => { if (!allMovements.some(m => m.id === id)) historySelected.delete(id); });
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
      <input type="checkbox" class="history-check" data-id="${m.id}" ${historySelected.has(m.id) ? "checked" : ""} aria-label="履歴を選択" style="width:20px;flex-shrink:0;">
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
  listEl.querySelectorAll(".history-check").forEach(box => box.addEventListener("change", () => {
    if (box.checked) historySelected.add(box.dataset.id); else historySelected.delete(box.dataset.id);
    updateSelectionButtons();
  }));
  updateSelectionButtons();
}

function formatDateTime(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateOnly(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function todayDateInputValue() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatPostingDate(str) {
  return str ? str.replace(/-/g, "/") : "";
}

// ===================== Phase3: QR用URL生成・ハッシュルーティング =====================
function buildProductUrl(id) {
  return `${location.origin}${location.pathname}#product=${encodeURIComponent(id)}`;
}
function buildSlipUrl(id) {
  return `${location.origin}${location.pathname}#slip=${encodeURIComponent(id)}`;
}

function handlePendingHash() {
  if (pendingHashHandled) return;
  const hash = location.hash;
  if (!hash) return;
  const pm = hash.match(/#product=([^&]+)/);
  const sm = hash.match(/#slip=([^&]+)/);
  if (pm) {
    const id = decodeURIComponent(pm[1]);
    const p = allProducts.find(x => x.id === id);
    if (p) {
      pendingHashHandled = true;
      history.replaceState(null, "", location.pathname);
      openMoveModal(p.id);
    }
  } else if (sm) {
    const id = decodeURIComponent(sm[1]);
    const s = allSlips.find(x => x.id === id);
    if (s) {
      pendingHashHandled = true;
      history.replaceState(null, "", location.pathname);
      switchTab("slips");
      openSlipDetailModal(s.id);
    }
  }
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
  // QRコードにはこの商品を直接開くURLを埋め込む（スマホの標準カメラからもアプリを開けるように）
  new QRCode(box, {
    text: buildProductUrl(id),
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

// QL-800: DK-1221 (23×23mm) と DK-1209 (62×29mm) に1枚ずつ印刷する。
function showBrotherLabelPreview(kind, title, count) {
  const area = document.getElementById("qrBulkPrintArea");
  area.classList.remove("brother-qr-mode", "brother-pick-mode");
  area.classList.add(kind === "pick" ? "brother-pick-mode" : "brother-qr-mode");
  document.getElementById("qrBulkTitle").textContent = title;
  document.getElementById("qrBulkHint").textContent = `${count}枚／Brother QL-800・${kind === "pick" ? "DK-1209（62×29mm）" : "DK-1221（23×23mm）"}。PCでQL-800を選び、用紙サイズを合わせて倍率100%・余白なしで印刷してください。`;
  document.getElementById("qrBulkOverlay").classList.add("show");
}

function appendBrotherQr(grid, productId, productName) {
  const cell = document.createElement("div");
  cell.className = "brother-qr-label";
  const qrBox = document.createElement("div");
  qrBox.className = "brother-qr-image";
  cell.appendChild(qrBox);
  const name = document.createElement("div");
  name.className = "brother-qr-name";
  name.textContent = productName || allProducts.find(p => p.id === productId)?.name || "商品名未登録";
  name.title = name.textContent;
  cell.appendChild(name);
  grid.appendChild(cell);
  new QRCode(qrBox, { text: buildProductUrl(productId), width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
}

function finishBrotherLabels(grid, kind, title, count) {
  const last = grid.querySelector(kind === "pick" ? ".brother-pick-label:last-child" : ".brother-qr-label:last-child");
  if (!last) return showToast("印刷対象のラベルがありません");
  last.classList.add("last-label");
  showBrotherLabelPreview(kind, title, count);
}

function printProductQrLabel(id) {
  if (!allProducts.some(p => p.id === id)) return;
  const grid = document.getElementById("qrBulkGrid");
  grid.className = "brother-label-list";
  grid.replaceChildren();
  appendBrotherQr(grid, id);
  document.getElementById("qrOverlay").classList.remove("show");
  finishBrotherLabels(grid, "qr", "商品QRラベル（23×23mm）", 1);
}

function openQrBulkPrint() {
  const keyword = document.getElementById("searchBox").value.trim().normalize("NFKC").toLowerCase();
  const items = allProducts.filter(p =>
    (activeCategory === "すべて" || p.category === activeCategory) &&
    (!keyword || `${p.name || ""} ${p.code || ""}`.normalize("NFKC").toLowerCase().includes(keyword))
  );
  if (!items.length) return showToast("印刷対象の商品がありません");
  const grid = document.getElementById("qrBulkGrid");
  grid.className = "brother-label-list";
  grid.replaceChildren();
  items.forEach(p => appendBrotherQr(grid, p.id));
  finishBrotherLabels(grid, "qr", "商品QRラベル一括印刷（23×23mm）", items.length);
}

// 入荷のラベルに商品QRと商品名を印刷する。品目の区切りはプレビューに表示する。
function printSlipReceivingLabels(slipId) {
  const s = allSlips.find(x => x.id === slipId);
  if (!s || s.type !== "in") return showToast("入荷伝票を開いてください");
  const groups = new Map();
  try {
  (s.items || []).forEach((item, idx) => {
    const input = s.status !== "done" && openSlipId === slipId
      ? document.querySelector(`.slip-check-qty[data-idx="${idx}"]`) : null;
    const value = s.status === "done" ? item.checkedQty : input ? input.value : item.checkedQty ?? item.plannedQty;
    const qty = inventoryQuantity(value, (item.productName || "商品") + "の入荷数");
    if (!item.productId) throw Error("印刷対象の商品を確認してください");
    if (qty === 0) return;
    const p = allProducts.find(x => x.id === item.productId);
    const group = groups.get(item.productId) || { qty: 0, name: item.productName || p?.name || "商品", code: p?.code || "" };
    group.qty += qty;
    groups.set(item.productId, group);
  });
  } catch (err) { showToast(err.message); return; }
  if (!groups.size) return showToast("入荷数量が0のため、印刷するQRシールはありません");
  const grid = document.getElementById("qrBulkGrid");
  grid.className = "brother-label-list";
  grid.replaceChildren();
  let total = 0;
  [...groups].forEach(([productId, group], index) => {
    const heading = document.createElement("div");
    heading.className = "brother-group-title";
    heading.textContent = `${index + 1}/${groups.size}　${group.name}${group.code ? `（${group.code}）` : ""}　${group.qty}枚`;
    grid.appendChild(heading);
    for (let i = 0; i < group.qty; i++) appendBrotherQr(grid, productId, group.name);
    total += group.qty;
  });
  finishBrotherLabels(grid, "qr", "入荷：QR＋商品名シール（23×23mm）", total);
}

// 検品シールのQRは現品QRと同じ商品URL。1商品1点につき1枚印刷する。
function printSlipPickLabels(slipId) {
  const s = allSlips.find(x => x.id === slipId);
  if (!s) return;
  if (s.type === "in") return printSlipReceivingLabels(slipId);
  const grid = document.getElementById("qrBulkGrid");
  grid.className = "brother-label-list";
  grid.replaceChildren();
  const issueDate = s.createdAt?.toDate ? formatDateOnly(s.createdAt.toDate()) : "";
  const shipTo = s.shipTo || s.partner || "";
  let total = 0;
  (s.items || []).forEach(item => {
    const qty = Number(item.plannedQty);
    if (!item.productId || !Number.isInteger(qty) || qty <= 0) return;
    const price = Number(item.unitPrice || 0);
    for (let i = 1; i <= qty; i++) {
      const cell = document.createElement("div");
      cell.className = "brother-pick-label";
      cell.innerHTML = `<div class="brother-pick-qr"></div><div class="brother-pick-info">
        <div class="brother-pick-name">${escapeHtml(item.productName || "")}</div>
        <div>伝票 ${escapeHtml(s.slipNumber || "")}${qty > 1 ? `　${i}/${qty}` : ""}</div>
        <div class="brother-pick-price">¥${price.toLocaleString()}</div>
        <div class="brother-pick-meta">${escapeHtml(shipTo)}${issueDate ? ` / ${escapeHtml(issueDate)}` : ""}</div>
      </div>`;
      grid.appendChild(cell);
      new QRCode(cell.querySelector(".brother-pick-qr"), { text: buildProductUrl(item.productId), width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
      total++;
    }
  });
  finishBrotherLabels(grid, "pick", "検品シール（62×29mm）", total);
}

// ===================== Phase2: エクセル一括登録 =====================
let excelParsedRows = [];

function handleExcelFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  excelParsedRows = [];
  renderExcelPreview();
  if (typeof XLSX === "undefined") { showToast("Excel読み込み機能を読み込めませんでした。再読み込みしてください"); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = new Uint8Array(ev.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false });
      excelParsedRows = rows.map(mapExcelRow).filter(isValidExcelRow);
      renderExcelPreview();
    } catch (err) {
      console.error(err);
      showToast("ファイルの読み込みに失敗しました");
    }
  };
  reader.readAsArrayBuffer(file);
}

// 分類名の表記ゆれを、アプリで使う分類名に寄せる（該当なしは「その他」に）
const CATEGORY_ALIASES = {
  "非常用品": "非常用品",
  "光ミュージアム前売り券": "その他",
  "レジ袋": "その他"
};

function normalizeHeader(k) {
  return String(k).normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

function mapExcelRow(row) {
  // 列名の表記ゆれを吸収（商品ｺｰﾄﾞ/商品コード/コード/品番、商品名/名称、種別/分類、売上単価/売価/単価 など）
  const get = (keys) => {
    const columns = Object.keys(row);
    for (const key of keys) {
      const found = columns.find(k => normalizeHeader(k) === normalizeHeader(key));
      if (found) return row[found];
    }
    for (const key of keys) {
      const found = columns.find(k => normalizeHeader(k).includes(normalizeHeader(key)));
      if (found) return row[found];
    }
    return "";
  };
  const number = value => Number(String(value ?? "").normalize("NFKC").replace(/[¥￥,\s]/g, "")) || 0;

  let code = String(get(["商品コード", "コード", "品番", "code"]) || "").trim();
  if (code === "-" || code === "―" || code === "ー") code = "";

  let rawCategory = String(get(["分類", "カテゴリ", "種別", "category"]) || "").trim();
  let category = rawCategory;
  let note = String(get(["備考", "note"]) || "").trim();
  if (!rawCategory) {
    category = "その他";
  } else if (CATEGORY_ALIASES[rawCategory]) {
    category = CATEGORY_ALIASES[rawCategory];
    // エイリアスで丸めた場合、元の分類名が消えないよう備考に残す
    if (category !== rawCategory) {
      note = note ? `${note}（元の分類：${rawCategory}）` : `元の分類：${rawCategory}`;
    }
  }

  return {
    code,
    name: String(get(["商品名", "名称", "品名", "name"]) || "").trim(),
    supplier: String(get(["仕入れ先", "仕入先", "仕入れ元", "仕入元", "supplier"]) || "").trim(),
    lot: String(get(["ロット", "ロット番号", "lot"]) || "").trim(),
    category,
    unit: String(get(["単位", "unit"]) || "個").trim(),
    price: number(get(["売上単価", "売価", "単価", "価格", "price"])),
    minStock: get(["在庫僅少ライン", "僅少ライン", "minStock"]) === "" ? 3 : number(get(["在庫僅少ライン", "僅少ライン", "minStock"])),
    stock: number(get(["現在庫数", "在庫数", "stock"])),
    note
  };
}

function isValidExcelRow(r) {
  if (!r.name) return false;
  // ヘッダー行がデータとして紛れ込んでいる場合（表を複数貼り付けた際など）を除外
  if (r.name === "商品名") return false;
  if (normalizeHeader(r.code || "").includes("商品コード")) return false;
  return true;
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
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.code)}</td>
      <td>${escapeHtml(r.supplier)}</td>
      <td>¥${r.price.toLocaleString()}</td>
      <td>${escapeHtml(r.lot)}</td>
      <td>${escapeHtml(r.category)}</td>
      <td>${escapeHtml(r.note)}</td>
      <td>${r.stock}</td>
    `;
    tbody.appendChild(tr);
  });
  labelTableCells(tbody);
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
        supplier: r.supplier || "",
        lot: r.lot || "",
        category: r.category || CATEGORIES[0],
        unit: r.unit || "個",
        price: r.price || 0,
        currentStock: r.stock || 0,
        minStock: r.minStock ?? 3,
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
  db.collection(SLIPS_COLLECTION).orderBy("createdAt", "desc").onSnapshot(snapshot => {
    allSlips = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    [...slipSelected].forEach(id => { if (!allSlips.some(s => s.id === id)) slipSelected.delete(id); });
    if (document.getElementById("tabSlips").style.display !== "none") {
      renderSlipList(getActiveSlipFilter());
    }
    handlePendingHash();
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
      <input type="checkbox" class="slip-check-select" data-id="${s.id}" ${slipSelected.has(s.id) ? "checked" : ""} aria-label="伝票を選択" style="width:20px;flex-shrink:0;">
      <div class="slip-main">
        <div class="slip-top">
          <span class="history-type ${s.type === "in" ? "in" : "out"}">${typeLabel}</span>
          <span class="slip-number">${escapeHtml(s.slipNumber || "")}</span>
          <span class="slip-status ${s.status === "done" ? "done" : ""}">${statusLabel}</span>
        </div>
        <div class="history-meta">${escapeHtml(s.partner || "取引先未設定")}　/　${dt}　/　品目数：${(s.items || []).length}</div>
      </div>
    `;
    row.addEventListener("click", e => { if (!e.target.closest(".slip-check-select")) openSlipDetailModal(s.id); });
    listEl.appendChild(row);
  });
  listEl.querySelectorAll(".slip-check-select").forEach(box => box.addEventListener("change", () => {
    if (box.checked) slipSelected.add(box.dataset.id); else slipSelected.delete(box.dataset.id);
    updateSelectionButtons();
  }));
  updateSelectionButtons();
}

// ---- 伝票の新規作成 ----
function openSlipCreateModal(type) {
  currentSlipItems = [];
  document.getElementById("slipCreateType").value = type;
  document.getElementById("slipCreateTitle").textContent = type === "in" ? "入荷伝票を作成" : "出荷伝票を作成";
  const badge = document.getElementById("slipCreateTypeBadge");
  badge.textContent = type === "in" ? "入荷伝票" : "出荷伝票";
  badge.className = "slip-type-badge " + type;
  document.getElementById("slipPartnerLabel").textContent = type === "in" ? "仕入先（任意）" : "取引先／納品先（任意）";
  document.getElementById("slipShipToLabel").textContent = type === "in" ? "入荷元（任意）" : "出荷先（任意）";
  document.getElementById("slipPartner").value = "";
  document.getElementById("slipPartnerAddress").value = "";
  document.getElementById("slipPartnerTel").value = "";
  document.getElementById("slipShipTo").value = "";
  document.getElementById("slipPostingDate").value = todayDateInputValue();
  document.getElementById("slipTransactionType").value = "";
  document.getElementById("slipWarehouse").value = "";
  document.getElementById("slipOrderNo").value = "";
  document.getElementById("slipMemo").value = "";
  document.getElementById("slipItemCodeInput").value = "";
  document.getElementById("slipItemCodeError").textContent = "";
  const productSelect = document.getElementById("slipItemProduct");
  productSelect.innerHTML = `<option value="">商品を選択...</option>` +
    allProducts.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.code ? "（" + escapeHtml(p.code) + "）" : ""}</option>`).join("");
  document.getElementById("slipItemQty").value = 1;
  document.getElementById("slipItemPrice").value = "";
  document.getElementById("slipItemRemark").value = "";
  clearSelectedProductCard();
  updateSlipItemAmountPreview();
  renderSlipItemsEditor();
  document.getElementById("slipCreateOverlay").classList.add("show");
  setTimeout(() => document.getElementById("slipItemCodeInput").focus(), 50);
}

function closeSlipCreateModal() {
  document.getElementById("slipCreateOverlay").classList.remove("show");
}

function showSelectedProductCard(p) {
  const card = document.getElementById("slipItemSelectedCard");
  if (!p) { clearSelectedProductCard(); return; }
  document.getElementById("slipSelectedName").textContent = p.name || "";
  document.getElementById("slipSelectedMeta").textContent =
    `${p.code ? "コード：" + p.code + "　/　" : ""}現在庫：${p.currentStock ?? 0}${p.unit || ""}${p.price ? "　/　売価：¥" + Number(p.price).toLocaleString() : ""}`;
  card.style.display = "block";
  document.getElementById("slipItemPrice").value = p.price != null ? p.price : "";
  updateSlipItemAmountPreview();
}

function clearSelectedProductCard() {
  document.getElementById("slipItemSelectedCard").style.display = "none";
  updateSlipItemAmountPreview();
}

function updateSlipItemAmountPreview() {
  const qty = Number(document.getElementById("slipItemQty").value) || 0;
  const price = Number(document.getElementById("slipItemPrice").value) || 0;
  const preview = document.getElementById("slipItemAmountPreview");
  preview.textContent = (qty && price) ? `金額：¥${(qty * price).toLocaleString()}` : "";
}

function handleSlipItemProductChange() {
  const id = document.getElementById("slipItemProduct").value;
  const p = allProducts.find(x => x.id === id);
  document.getElementById("slipItemCodeError").textContent = "";
  showSelectedProductCard(p);
}

function handleSlipItemCodeLookup() {
  const input = document.getElementById("slipItemCodeInput");
  const code = input.value.trim();
  const errorEl = document.getElementById("slipItemCodeError");
  errorEl.textContent = "";
  if (!code) return;

  const p = allProducts.find(x => (x.code || "").trim().toLowerCase() === code.toLowerCase());
  if (!p) {
    errorEl.textContent = `商品コード「${code}」に該当する商品が見つかりません`;
    clearSelectedProductCard();
    document.getElementById("slipItemProduct").value = "";
    return;
  }
  document.getElementById("slipItemProduct").value = p.id;
  showSelectedProductCard(p);
  document.getElementById("slipItemQty").focus();
  document.getElementById("slipItemQty").select();
}

function handleSlipItemAdd() {
  const productId = document.getElementById("slipItemProduct").value;
  const qty = Number(document.getElementById("slipItemQty").value);
  const unitPrice = Number(document.getElementById("slipItemPrice").value) || 0;
  const remark = document.getElementById("slipItemRemark").value.trim();
  const p = allProducts.find(x => x.id === productId);
  if (!p) { showToast("商品コードを入力するか、商品名から選択してください"); return; }
  if (!qty || qty <= 0) { showToast("数量は1以上を入力してください"); return; }

  const existing = currentSlipItems.find(i => i.productId === productId);
  if (existing) {
    existing.plannedQty += qty;
    existing.unitPrice = unitPrice || existing.unitPrice;
    if (remark) existing.remark = remark;
  } else {
    currentSlipItems.push({
      productId, productName: p.name, code: p.code || "", unit: p.unit || "",
      plannedQty: qty, checkedQty: 0, checked: false, unitPrice, remark
    });
  }
  showToast(`${p.name} を追加しました`);
  // 次の品目をすぐ入力できるようリセットしてコード欄にフォーカスを戻す
  document.getElementById("slipItemQty").value = 1;
  document.getElementById("slipItemPrice").value = "";
  document.getElementById("slipItemRemark").value = "";
  document.getElementById("slipItemCodeInput").value = "";
  document.getElementById("slipItemProduct").value = "";
  clearSelectedProductCard();
  updateSlipItemAmountPreview();
  renderSlipItemsEditor();
  document.getElementById("slipItemCodeInput").focus();
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
    const amount = (item.unitPrice || 0) * item.plannedQty;
    row.innerHTML = `
      <div style="flex:1;">
        <div class="slip-item-name">${escapeHtml(item.productName)}${item.code ? "（" + escapeHtml(item.code) + "）" : ""}</div>
        <div class="slip-item-price">数量：${item.plannedQty}${escapeHtml(item.unit)}　単価：¥${Number(item.unitPrice || 0).toLocaleString()}　金額：¥${amount.toLocaleString()}</div>
        ${item.remark ? `<div class="slip-item-remark">摘要：${escapeHtml(item.remark)}</div>` : ""}
      </div>
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
  const partnerAddress = document.getElementById("slipPartnerAddress").value.trim();
  const partnerTel = document.getElementById("slipPartnerTel").value.trim();
  const shipTo = document.getElementById("slipShipTo").value.trim();
  const postingDate = document.getElementById("slipPostingDate").value;
  const transactionType = document.getElementById("slipTransactionType").value.trim();
  const warehouse = document.getElementById("slipWarehouse").value.trim();
  const orderNo = document.getElementById("slipOrderNo").value.trim();
  const memo = document.getElementById("slipMemo").value.trim();

  db.collection(SLIPS_COLLECTION).add({
    type,
    slipNumber: generateSlipNumber(type),
    partner,
    partnerAddress,
    partnerTel,
    shipTo,
    postingDate,
    transactionType,
    warehouse,
    orderNo,
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
  pendingSlipScanCode = null;
  const typeLabel = s.type === "in" ? "入荷伝票" : "出荷伝票";
  document.getElementById("slipDetailTitle").textContent = typeLabel;
  document.getElementById("slipDetailNumber").textContent = s.slipNumber || "";
  document.getElementById("slipDetailPartner").textContent = s.partner || "取引先未設定";
  document.getElementById("slipDetailPartnerAddress").textContent = s.partnerAddress || "";
  document.getElementById("slipDetailPartnerTel").textContent = s.partnerTel || "";
  document.getElementById("slipDetailShipToLabel").textContent = s.type === "in" ? "入荷元" : "出荷先";
  document.getElementById("slipDetailShipTo").textContent = s.shipTo || s.partner || "";
  document.getElementById("slipDetailIssueDate").textContent = s.createdAt && s.createdAt.toDate ? formatDateOnly(s.createdAt.toDate()) : "";
  document.getElementById("slipDetailPostingDate").textContent = formatPostingDate(s.postingDate);
  document.getElementById("slipDetailTransactionType").textContent = s.transactionType || "";
  document.getElementById("slipDetailWarehouse").textContent = s.warehouse || "";
  document.getElementById("slipDetailOrderNo").textContent = s.orderNo || "";
  document.getElementById("slipDetailStaff").textContent = s.staff ? `作成：${s.staff}` : "";
  document.getElementById("slipDetailMemo").textContent = s.memo || "";

  const qrBox = document.getElementById("slipQrBox");
  qrBox.innerHTML = "";
  new QRCode(qrBox, { text: buildSlipUrl(id), width: 64, height: 64, correctLevel: QRCode.CorrectLevel.M });
  const qrLabel = document.createElement("div");
  qrLabel.style.cssText = "font-size:clamp(9px,2.4vw,10.5px);color:#8a8272;margin-top:2px;";
  qrLabel.textContent = s.slipNumber || "";
  qrBox.appendChild(qrLabel);

  const tbody = document.getElementById("slipDetailBody");
  tbody.innerHTML = "";
  const isDone = s.status === "done";
  let totalAmount = 0;
  (s.items || []).forEach((item, idx) => {
    const unitPrice = Number(item.unitPrice || 0);
    const amount = unitPrice * item.plannedQty;
    totalAmount += amount;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.code || "")}</td>
      <td>${escapeHtml(item.productName)}</td>
      <td>¥${unitPrice.toLocaleString()}</td>
      <td>${item.plannedQty}${escapeHtml(item.unit || "")}</td>
      <td>¥${amount.toLocaleString()}</td>
      <td>${escapeHtml(item.remark || "")}</td>
      <td class="no-print">
        <input type="number" class="slip-check-qty" data-idx="${idx}" min="0" value="${item.checkedQty ?? item.plannedQty}" ${isDone ? "disabled" : ""}>
      </td>
      <td class="no-print">
        <input type="checkbox" class="slip-check-box" data-idx="${idx}" ${item.checked ? "checked" : ""} ${isDone ? "disabled" : ""}>
      </td>
    `;
    tbody.appendChild(tr);
  });
  labelTableCells(tbody);
  document.getElementById("slipDetailTotal").textContent = `¥${totalAmount.toLocaleString()}`;

  document.getElementById("slipDetailCompleteBtn").style.display = isDone ? "none" : "block";
  document.getElementById("slipDetailDoneNote").style.display = isDone ? "block" : "none";

  const labelWrap = document.getElementById("slipReceivingLabelWrap");
  labelWrap.style.display = s.type === "in" ? "block" : "none";
  document.getElementById("slipPickLabelWrap").style.display = s.type === "out" ? "flex" : "none";

  document.getElementById("slipDetailOverlay").classList.add("show");
  document.getElementById("slipBluetoothModeBtn").disabled = isDone;
  document.getElementById("slipScanFocusBtn").disabled = isDone;
  setSlipScannerMode(!isDone);
}

function closeSlipDetailModal() {
  setSlipScannerMode(false);
  openSlipId = null;
  pendingSlipScanCode = null;
  document.getElementById("slipDetailOverlay").classList.remove("show");
}

function setSlipScannerMode(active) {
  slipScannerActive = !!active && !!openSlipId && allSlips.find(s => s.id === openSlipId)?.status !== "done";
  pendingSlipScanCode = null;
  clearTimeout(slipScannerIdleTimer);
  const input = document.getElementById("slipItemScannerInput");
  input.value = "";
  input.disabled = !slipScannerActive;
  document.getElementById("slipBluetoothModeBtn").textContent = slipScannerActive ? "Bluetooth検品を一時停止" : "Bluetooth検品を開始";
  const status = document.getElementById("slipScanStatus");
  status.className = slipScannerActive ? "scan-ready" : "";
  status.textContent = slipScannerActive
    ? "iPadで接続したスキャナーで現品QR、検品シールQRの順に読み取ってください（同じ商品で1件確認）。"
    : "Bluetooth検品を開始すると読み取りを受け付けます。";
  if (slipScannerActive) setTimeout(() => {
    if (slipScannerActive && document.getElementById("slipDetailOverlay").classList.contains("show")) input.focus();
  }, 50);
}

// ---- 伝票の印刷（ピック表／検品表／納品書） ----
function companyLetterheadHtml() {
  return `
    <div class="slip-formal-companybox">
      <div>住所　東京都府中市八幡町1-4-3</div>
      <div>電話　042(334)1660番(代)</div>
      <div>FAX　042(334)1665番</div>
      <div class="slip-formal-companyname">株式会社　弘文社</div>
    </div>
  `;
}

function printSlipSheet(mode) {
  const s = allSlips.find(x => x.id === openSlipId);
  if (!s) return;
  const sheet = document.getElementById("slipPrintSheet");
  if (mode === "check") sheet.innerHTML = buildCheckSheetHtml(s);
  else sheet.innerHTML = buildDeliverySheetHtml(s);

  const qrHost = document.getElementById("printSheetQr");
  if (qrHost) {
    new QRCode(qrHost, { text: buildSlipUrl(s.id), width: 64, height: 64, correctLevel: QRCode.CorrectLevel.M });
  }
  document.body.classList.add("slip-print");
  document.body.classList.remove("label-print", "work-print");
  setTimeout(() => window.print(), 30);
}

function buildCheckSheetHtml(s) {
  const typeLabel = s.type === "in" ? "入荷" : "出荷";
  const shipToLabel = s.type === "in" ? "入荷元" : "出荷先";
  const issueDate = s.createdAt && s.createdAt.toDate ? formatDateOnly(s.createdAt.toDate()) : "";
  const rows = (s.items || []).map(item => `
    <tr>
      <td>${escapeHtml(item.code || "")}</td>
      <td>${escapeHtml(item.productName)}</td>
      <td>${item.plannedQty}${escapeHtml(item.unit || "")}</td>
      <td><span class="fill-blank"></span></td>
      <td class="checkbox-glyph">☐</td>
    </tr>
  `).join("");
  return `
    <div class="slip-formal-header">
      <h2 style="margin:0;">検品表（${typeLabel}）</h2>
      <div class="slip-formal-header-qr">
        <div id="printSheetQr"></div>
        <span class="slip-formal-header-qr-label">${escapeHtml(s.slipNumber || "")}</span>
      </div>
      ${companyLetterheadHtml()}
    </div>
    <table class="slip-formal-table">
      <tr><th>伝票番号</th><td>${escapeHtml(s.slipNumber || "")}</td><th>${shipToLabel}</th><td>${escapeHtml(s.shipTo || s.partner || "")}</td></tr>
      <tr><th>倉庫</th><td>${escapeHtml(s.warehouse || "")}</td><th>作成日</th><td>${issueDate}</td></tr>
    </table>
    <table class="slip-detail-table">
      <thead><tr><th>商品コード</th><th>商品名</th><th>数量（予定）</th><th>確認数</th><th>検品済</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildDeliverySheetHtml(s) {
  const typeLabel = s.type === "in" ? "入荷伝票" : "出荷伝票";
  const shipToLabel = s.type === "in" ? "入荷元" : "出荷先";
  const issueDate = s.createdAt && s.createdAt.toDate ? formatDateOnly(s.createdAt.toDate()) : "";
  let total = 0;
  const rows = (s.items || []).map(item => {
    const unitPrice = Number(item.unitPrice || 0);
    const amount = unitPrice * item.plannedQty;
    total += amount;
    return `
      <tr>
        <td>${escapeHtml(item.code || "")}</td>
        <td>${escapeHtml(item.productName)}</td>
        <td>¥${unitPrice.toLocaleString()}</td>
        <td>${item.plannedQty}${escapeHtml(item.unit || "")}</td>
        <td>¥${amount.toLocaleString()}</td>
        <td>${escapeHtml(item.remark || "")}</td>
      </tr>
    `;
  }).join("");
  return `
    <div class="slip-formal-header">
      <h2 style="margin:0;">${typeLabel}</h2>
      <div class="slip-formal-header-qr">
        <div id="printSheetQr"></div>
        <span class="slip-formal-header-qr-label">${escapeHtml(s.slipNumber || "")}</span>
      </div>
      ${companyLetterheadHtml()}
    </div>
    <table class="slip-formal-table">
      <tr>
        <th>発行日</th><td>${issueDate}</td>
        <th>計上日</th><td>${formatPostingDate(s.postingDate)}</td>
      </tr>
      <tr>
        <th>伝票番号</th><td>${escapeHtml(s.slipNumber || "")}</td>
        <th>${shipToLabel}</th><td>${escapeHtml(s.shipTo || s.partner || "")}</td>
      </tr>
      <tr>
        <th>取引先</th>
        <td colspan="3">
          名称：${escapeHtml(s.partner || "")}　
          住所：${escapeHtml(s.partnerAddress || "")}　
          TEL：${escapeHtml(s.partnerTel || "")}
        </td>
      </tr>
      <tr>
        <th>取引区分</th><td>${escapeHtml(s.transactionType || "")}</td>
        <th>倉庫</th><td>${escapeHtml(s.warehouse || "")}</td>
      </tr>
      <tr>
        <th>発注№</th><td colspan="3">${escapeHtml(s.orderNo || "")}</td>
      </tr>
    </table>
    <table class="slip-detail-table">
      <thead><tr><th>商品コード</th><th>商品名</th><th>単価</th><th>数量</th><th>金額</th><th>摘要</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" style="text-align:right;font-weight:700;">合計金額</td>
          <td colspan="2" style="font-weight:700;">¥${total.toLocaleString()}</td>
        </tr>
      </tfoot>
    </table>
    <p style="font-size:13px;margin-top:12px;">備考：${escapeHtml(s.memo || "")}</p>
  `;
}

// ===================== Phase4: 在庫僅少の自動通知 =====================
// 「発注が必要な商品」＝在庫僅少ライン以下 かつ 未発注/発注済みの発注にまだ含まれていない商品
function getOpenOrderProductIds() {
  const ids = new Set();
  allOrders.forEach(o => {
    if (o.status === "draft" || o.status === "ordered") {
      (o.items || []).forEach(item => ids.add(item.productId));
    }
  });
  return ids;
}

function getLowStockNeedingOrder() {
  const openIds = getOpenOrderProductIds();
  return allProducts.filter(p => Number(p.currentStock) <= Number(p.minStock) && !openIds.has(p.id));
}

function checkLowStockAutoNotify() {
  const current = getLowStockNeedingOrder();
  const currentIds = new Set(current.map(p => p.id));
  updateOrdersTabBadge(currentIds.size);

  if (previousLowStockIds === null) {
    // 初回のみ：既にある分もまとめて1回お知らせする
    if (currentIds.size > 0) {
      showToast(`⚠️ 在庫僅少で発注が必要な商品が${currentIds.size}件あります`);
    }
  } else {
    const newlyLow = current.filter(p => !previousLowStockIds.has(p.id));
    if (newlyLow.length > 0) {
      const names = newlyLow.slice(0, 3).map(p => p.name).join("、");
      showToast(`⚠️ 在庫僅少：${names}${newlyLow.length > 3 ? ` 他${newlyLow.length - 3}件` : ""}`);
      if (browserNotifyEnabled && typeof Notification !== "undefined") {
        try {
          new Notification("在庫僅少のお知らせ", {
            body: `${names}${newlyLow.length > 3 ? ` 他${newlyLow.length - 3}件` : ""} が在庫僅少です。発注管理タブをご確認ください。`
          });
        } catch (e) { console.error(e); }
      }
    }
  }
  previousLowStockIds = currentIds;
}

function updateOrdersTabBadge(count) {
  const badge = document.getElementById("orderLowBadge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

function handleEnableBrowserNotify() {
  if (typeof Notification === "undefined") {
    showToast("この端末・ブラウザは通知に対応していません");
    return;
  }
  Notification.requestPermission().then(perm => {
    browserNotifyEnabled = (perm === "granted");
    updateNotifyBtnLabel();
    showToast(browserNotifyEnabled ? "ブラウザ通知を有効にしました" : "通知が許可されませんでした");
  });
}

function updateNotifyBtnLabel() {
  const btn = document.getElementById("orderNotifyBtn");
  if (!btn) return;
  btn.textContent = browserNotifyEnabled ? "🔔 ブラウザ通知：有効" : "🔕 ブラウザ通知を有効にする";
}

// ===================== Phase4: 発注が必要な商品（アラート表示） =====================
function renderLowStockAlert() {
  const box = document.getElementById("lowStockAlertBox");
  const listEl = document.getElementById("lowStockAlertList");
  const needing = getLowStockNeedingOrder();
  if (needing.length === 0) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  document.getElementById("lowStockAlertCount").textContent = needing.length;
  listEl.innerHTML = "";
  needing.forEach(p => {
    const row = document.createElement("div");
    row.className = "low-stock-alert-row";
    row.innerHTML = `
      <span>${escapeHtml(p.name)}（現在庫：${p.currentStock ?? 0}${escapeHtml(p.unit || "")}／僅少ライン：${p.minStock ?? 0}）</span>
    `;
    listEl.appendChild(row);
  });
}

function handleCreateOrderFromLowStock() {
  const supplier = document.getElementById("orderSupplierSelect").value;
  if (!supplier) { showToast("先に仕入れ先を選択してください"); return; }
  const needing = getLowStockNeedingOrder().filter(p => (p.supplier || "").trim() === supplier);
  if (needing.length === 0) {
    showToast("この仕入れ先に発注が必要な商品はありません");
    return;
  }
  const prefill = needing.map(p => ({
    productId: p.id,
    productName: p.name,
    code: p.code || "",
    unit: p.unit || "",
    qty: Math.max(1, (Number(p.minStock) || 0) * 2 - Number(p.currentStock || 0))
  }));
  openOrderCreateModal(prefill, supplier);
}

function refreshOrderSupplierOptions() {
  const select = document.getElementById("orderSupplierSelect");
  if (!select) return;
  const previous = select.value;
  const suppliers = [...new Set(allProducts.map(p => String(p.supplier || "").trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,"ja"));
  select.replaceChildren(new Option("仕入れ先を選択...", ""), ...suppliers.map(name => new Option(name,name)));
  select.value = suppliers.includes(previous) ? previous : "";
}

function openSupplierOrder() {
  const supplier = document.getElementById("orderSupplierSelect").value;
  if (!supplier) { showToast("仕入れ先を選択してください。未登録の場合は商品編集で入力できます"); return; }
  openOrderCreateModal([], supplier);
}

// ===================== Phase4: 発注（購入発注）管理 =====================
function subscribeOrders() {
  db.collection(ORDERS_COLLECTION).orderBy("createdAt", "desc").limit(200).onSnapshot(snapshot => {
    allOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (document.getElementById("tabOrders").style.display !== "none") {
      renderLowStockAlert();
      renderOrderList(getActiveOrderFilter());
    }
    updateOrdersTabBadge(getLowStockNeedingOrder().length);
    handlePendingHash();
  }, err => console.error(err));
}

function getActiveOrderFilter() {
  const active = document.querySelector(".order-filter-btn.active");
  return active ? active.dataset.filter : "all";
}

const ORDER_STATUS_LABEL = { draft: "未発注", ordered: "発注済み", received: "入荷済み", cancelled: "キャンセル" };

function renderOrderList(filter) {
  const listEl = document.getElementById("orderList");
  const emptyEl = document.getElementById("orderEmptyState");
  let items = allOrders;
  if (filter && filter !== "all") items = items.filter(o => o.status === filter);
  const supplier = document.getElementById("orderSupplierSelect").value;
  if (supplier) items = items.filter(o => o.partner === supplier);

  listEl.innerHTML = "";
  emptyEl.style.display = items.length === 0 ? "block" : "none";

  items.forEach(o => {
    const row = document.createElement("div");
    row.className = "slip-row";
    const dt = o.createdAt && o.createdAt.toDate ? formatDateTime(o.createdAt.toDate()) : "―";
    const statusClass = o.status === "received" ? "done" : (o.status === "cancelled" ? "cancelled" : "");
    row.innerHTML = `
      <div class="slip-main">
        <div class="slip-top">
          <span class="slip-number">${escapeHtml(o.orderNumber || "")}</span>
          <span class="slip-status ${statusClass}">${ORDER_STATUS_LABEL[o.status] || o.status}</span>
        </div>
        <div class="history-meta">${escapeHtml(o.partner || "仕入先未設定")}　/　${dt}　/　品目数：${(o.items || []).length}</div>
      </div>
    `;
    row.addEventListener("click", () => openOrderDetailModal(o.id));
    listEl.appendChild(row);
  });
}

// ---- 発注の新規作成 ----
function openOrderCreateModal(prefillItems, supplier) {
  currentOrderItems = Array.isArray(prefillItems) ? prefillItems.map(i => ({ ...i })) : [];
  document.getElementById("orderPartner").value = supplier || "";
  document.getElementById("orderMemo").value = "";
  document.getElementById("orderItemCodeInput").value = "";
  document.getElementById("orderItemCodeError").textContent = "";
  const productSelect = document.getElementById("orderItemProduct");
  productSelect.innerHTML = `<option value="">商品を選択...</option>` +
    allProducts.filter(p => (p.supplier || "").trim() === supplier).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.code ? "（" + escapeHtml(p.code) + "）" : ""}</option>`).join("");
  renderSupplierOrderPicker(supplier);
  document.getElementById("orderItemQty").value = 1;
  clearOrderSelectedProductCard();
  renderOrderItemsEditor();
  document.getElementById("orderCreateOverlay").classList.add("show");
  setTimeout(() => document.getElementById("orderItemCodeInput").focus(), 50);
}

function renderSupplierOrderPicker(supplier) {
  const wrap = document.getElementById("orderSupplierPicker");
  const products = allProducts.filter(p => (p.supplier || "").trim() === supplier);
  wrap.innerHTML = products.length ? products.map(p => `
    <div class="supplier-picker-row">
      <div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.code || "コードなし")} ／ ${escapeHtml(p.lot || "ロットなし")}</small></div>
      <div class="supplier-stock">在庫 ${Number(p.currentStock || 0)}${escapeHtml(p.unit || "")}</div>
      <label>発注数<input type="number" class="supplier-order-qty" data-id="${escapeHtml(p.id)}" min="0" step="1" value="0"></label>
    </div>`).join("") : "<p>この仕入れ先の商品がありません</p>";
}

function addSupplierOrderItems() {
  const inputs = [...document.querySelectorAll("#orderSupplierPicker .supplier-order-qty")];
  const chosen = inputs.filter(input => input.value !== "" && Number(input.value) !== 0);
  if (!chosen.length) { showToast("発注する商品の数量を入力してください"); return false; }
  if (chosen.some(input => !Number.isSafeInteger(Number(input.value)) || Number(input.value) < 0)) {
    showToast("発注数は0以上の整数で入力してください"); return false;
  }
  const supplier = document.getElementById("orderPartner").value;
  chosen.forEach(input => {
    const p = allProducts.find(product => product.id === input.dataset.id && (product.supplier || "").trim() === supplier);
    if (!p) return;
    const qty = Number(input.value), existing = currentOrderItems.find(item => item.productId === p.id);
    if (existing) existing.qty += qty;
    else currentOrderItems.push({ productId:p.id, productName:p.name, code:p.code || "", unit:p.unit || "", qty });
    input.value = "0";
  });
  renderOrderItemsEditor();
  showToast("発注表に追加しました");
  return true;
}

function closeOrderCreateModal() {
  document.getElementById("orderCreateOverlay").classList.remove("show");
}

function showOrderSelectedProductCard(p) {
  const card = document.getElementById("orderItemSelectedCard");
  if (!p) { clearOrderSelectedProductCard(); return; }
  document.getElementById("orderSelectedName").textContent = p.name || "";
  document.getElementById("orderSelectedMeta").textContent =
    `${p.code ? "コード：" + p.code + "　/　" : ""}現在庫：${p.currentStock ?? 0}${p.unit || ""}　/　僅少ライン：${p.minStock ?? 0}`;
  card.style.display = "block";
}

function clearOrderSelectedProductCard() {
  document.getElementById("orderItemSelectedCard").style.display = "none";
}

function handleOrderItemProductChange() {
  const id = document.getElementById("orderItemProduct").value;
  const p = allProducts.find(x => x.id === id);
  document.getElementById("orderItemCodeError").textContent = "";
  showOrderSelectedProductCard(p);
}

function handleOrderItemCodeLookup() {
  const input = document.getElementById("orderItemCodeInput");
  const code = input.value.trim();
  const errorEl = document.getElementById("orderItemCodeError");
  errorEl.textContent = "";
  if (!code) return;

  const supplier = document.getElementById("orderPartner").value;
  const p = allProducts.find(x => (x.supplier || "").trim() === supplier && (x.code || "").trim().toLowerCase() === code.toLowerCase());
  if (!p) {
    errorEl.textContent = `商品コード「${code}」に該当する商品が見つかりません`;
    clearOrderSelectedProductCard();
    document.getElementById("orderItemProduct").value = "";
    return;
  }
  document.getElementById("orderItemProduct").value = p.id;
  showOrderSelectedProductCard(p);
  document.getElementById("orderItemQty").focus();
  document.getElementById("orderItemQty").select();
}

function handleOrderItemAdd() {
  const productId = document.getElementById("orderItemProduct").value;
  const qty = Number(document.getElementById("orderItemQty").value);
  const p = allProducts.find(x => x.id === productId);
  if (!p) { showToast("商品コードを入力するか、商品名から選択してください"); return; }
  if ((p.supplier || "").trim() !== document.getElementById("orderPartner").value) { showToast("この仕入れ先の商品を選択してください"); return; }
  if (!Number.isSafeInteger(qty) || qty <= 0) { showToast("数量は1以上の整数で入力してください"); return; }

  const existing = currentOrderItems.find(i => i.productId === productId);
  if (existing) {
    existing.qty += qty;
  } else {
    currentOrderItems.push({ productId, productName: p.name, code: p.code || "", unit: p.unit || "", qty });
  }
  showToast(`${p.name} を追加しました`);
  document.getElementById("orderItemQty").value = 1;
  document.getElementById("orderItemCodeInput").value = "";
  document.getElementById("orderItemProduct").value = "";
  clearOrderSelectedProductCard();
  renderOrderItemsEditor();
  document.getElementById("orderItemCodeInput").focus();
}

function renderOrderItemsEditor() {
  const wrap = document.getElementById("orderItemsEditor");
  wrap.innerHTML = "";
  if (currentOrderItems.length === 0) {
    wrap.innerHTML = `<p style="font-size:12px;color:#8a8272;">まだ品目がありません</p>`;
    return;
  }
  currentOrderItems.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "slip-item-row";
    row.innerHTML = `
      <div class="slip-item-name">${escapeHtml(item.productName)}${item.code ? "（" + escapeHtml(item.code) + "）" : ""}</div>
      <label class="order-edit-qty">発注数<input type="number" class="order-editor-qty" data-idx="${idx}" min="1" step="1" value="${Number(item.qty)}"></label>
      <span>${escapeHtml(item.unit || "")}</span>
      <button type="button" class="slip-item-remove" data-idx="${idx}">×</button>
    `;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll(".slip-item-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      currentOrderItems.splice(Number(btn.dataset.idx), 1);
      renderOrderItemsEditor();
    });
  });
  wrap.querySelectorAll(".order-editor-qty").forEach(input => {
    input.addEventListener("change", () => {
      const qty = Number(input.value);
      if (!Number.isSafeInteger(qty) || qty < 1) { showToast("発注数は1以上の整数で入力してください"); input.value = currentOrderItems[Number(input.dataset.idx)].qty; return; }
      currentOrderItems[Number(input.dataset.idx)].qty = qty;
    });
  });
}

function generateOrderNumber() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `HCH-${dateStr}-${rand}`;
}

function handleOrderCreateSave() {
  const pending = [...document.querySelectorAll("#orderSupplierPicker .supplier-order-qty")].some(input => input.value !== "" && Number(input.value) !== 0);
  if (pending && !addSupplierOrderItems()) return;
  if (currentOrderItems.length === 0) {
    showToast("品目を1件以上追加してください");
    return;
  }
  const partner = document.getElementById("orderPartner").value.trim();
  const editorInputs = [...document.querySelectorAll("#orderItemsEditor .order-editor-qty")];
  if (editorInputs.some(input => !Number.isSafeInteger(Number(input.value)) || Number(input.value) < 1)) {
    showToast("発注数は1以上の整数で入力してください"); return;
  }
  editorInputs.forEach(input => { currentOrderItems[Number(input.dataset.idx)].qty = Number(input.value); });
  if (!partner || currentOrderItems.some(item => !allProducts.some(p => p.id === item.productId && (p.supplier || "").trim() === partner))) {
    showToast("発注表の仕入れ先と商品を確認してください"); return;
  }
  const memo = document.getElementById("orderMemo").value.trim();
  const btn = document.getElementById("orderCreateSaveBtn");
  btn.disabled = true;
  db.collection(ORDERS_COLLECTION).add({
    orderNumber: generateOrderNumber(),
    partner,
    memo,
    status: "draft",
    items: currentOrderItems.map(item => ({ ...item })),
    staff: currentStaffName,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    showToast("発注案を作成しました");
    closeOrderCreateModal();
  }).catch(err => {
    console.error(err);
    showToast("発注案の作成に失敗しました");
  }).finally(() => { btn.disabled = false; });
}

// ---- 発注の詳細・ステータス管理 ----
function openOrderDetailModal(id) {
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  openOrderId = id;
  document.getElementById("orderDetailNumber").textContent = o.orderNumber || "";
  document.getElementById("orderDetailStatus").textContent = ORDER_STATUS_LABEL[o.status] || o.status;
  document.getElementById("orderDetailStatus").className =
    "slip-status" + (o.status === "received" ? " done" : (o.status === "cancelled" ? " cancelled" : ""));
  document.getElementById("orderDetailPartner").textContent = o.partner || "仕入先未設定";
  document.getElementById("orderDetailDate").textContent = o.createdAt && o.createdAt.toDate ? formatDateTime(o.createdAt.toDate()) : "";
  document.getElementById("orderDetailStaff").textContent = o.staff ? `作成：${o.staff}さん` : "";
  document.getElementById("orderDetailMemo").textContent = o.memo || "";

  const isOrdered = o.status === "ordered";
  const isReceived = o.status === "received";
  const isCancelled = o.status === "cancelled";

  const tbody = document.getElementById("orderDetailBody");
  tbody.innerHTML = "";
  (o.items || []).forEach((item, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.productName)}</td>
      <td>${escapeHtml(item.code || "")}</td>
      <td>${item.qty}${escapeHtml(item.unit || "")}</td>
      <td>
        ${isOrdered
          ? `<input type="number" class="order-received-qty" data-idx="${idx}" min="0" value="${item.receivedQty ?? item.qty}">`
          : `${item.receivedQty ?? (isReceived ? item.qty : "―")}${item.receivedQty != null || isReceived ? escapeHtml(item.unit || "") : ""}`}
      </td>
    `;
    tbody.appendChild(tr);
  });
  labelTableCells(tbody);

  document.getElementById("orderMarkOrderedBtn").style.display = (o.status === "draft") ? "block" : "none";
  document.getElementById("orderMarkReceivedBtn").style.display = isOrdered ? "block" : "none";
  document.getElementById("orderCancelBtn").style.display = (o.status === "draft" || o.status === "ordered") ? "block" : "none";
  document.getElementById("orderDetailDoneNote").style.display = isReceived ? "block" : "none";
  document.getElementById("orderDetailCancelledNote").style.display = isCancelled ? "block" : "none";
  document.getElementById("orderReceivedQtyHint").style.display = isOrdered ? "block" : "none";

  document.getElementById("orderDetailOverlay").classList.add("show");
}

function closeOrderDetailModal() {
  openOrderId = null;
  document.getElementById("orderDetailOverlay").classList.remove("show");
}

// 発注の状態変更もトランザクションで保護し、入荷済みの状態を戻さない。
async function changeOrderStatus(ref, allowed, changes) {
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists || !allowed.includes(doc.data().status)) {
      throw Error("発注の状態が変わりました。開き直してください");
    }
    tx.update(ref, changes);
  });
}

function handleOrderMarkOrdered() {
  if (!openOrderId) return;
  changeOrderStatus(db.collection(ORDERS_COLLECTION).doc(openOrderId), ["draft"], {
    status: "ordered",
    orderedAt: firebase.firestore.FieldValue.serverTimestamp(),
    orderedBy: currentStaffName
  }).then(() => {
    showToast("発注済みにしました");
    closeOrderDetailModal();
  }).catch(err => {
    console.error(err);
    showToast(err.message || "更新に失敗しました");
  });
}

function handleOrderCancel() {
  if (!openOrderId) return;
  if (!confirm("この発注をキャンセルします。よろしいですか？")) return;
  changeOrderStatus(db.collection(ORDERS_COLLECTION).doc(openOrderId), ["draft", "ordered"], {
    status: "cancelled",
    cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
    cancelledBy: currentStaffName
  }).then(() => {
    showToast("発注をキャンセルしました");
    closeOrderDetailModal();
  }).catch(err => {
    console.error(err);
    showToast(err.message || "更新に失敗しました");
  });
}

function inventoryQuantity(value, label) {
  if (value == null || typeof value === "boolean" ||
      (typeof value === "string" && !value.trim()) ||
      !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
    throw Error(label + "は0以上の整数で入力してください");
  }
  return Number(value);
}

// Firestoreのマップのキー順に依存せず、品目と予定数量を比較する。
function inventoryItemsSignature(items) {
  return JSON.stringify((items || []).map(item => [
    item.productId, item.qty ?? null, item.plannedQty ?? null
  ]));
}

// 伝票/発注、商品在庫、履歴をまとめて確定する。読み取りは書き込みより先。
async function completeInventoryRecord(ref, displayed, enteredItems, isOrder, staff) {
  const quantityField = isOrder ? "receivedQty" : "checkedQty";
  const quantities = enteredItems.map(item =>
    inventoryQuantity(item[quantityField], item.productName + "の数量"));
  await db.runTransaction(async tx => {
    const recordDoc = await tx.get(ref);
    if (!recordDoc.exists) throw Error("伝票・発注が削除されています");
    const record = recordDoc.data();
    const requiredStatus = isOrder ? "ordered" : "draft";
    if (record.status !== requiredStatus) {
      throw Error("既に処理済みか、状態が変わりました。開き直してください");
    }
    if ((!isOrder && record.type !== displayed.type) ||
        inventoryItemsSignature(record.items) !== inventoryItemsSignature(displayed.items)) {
      throw Error("品目が変更されています。開き直して数量を確認してください");
    }
    if (!Array.isArray(record.items) || !record.items.length ||
        record.items.length !== quantities.length) throw Error("品目を確認してください");
    const type = isOrder ? "in" : record.type;
    if (!["in", "out"].includes(type)) throw Error("入出庫区分を確認してください");
    const items = record.items.map((item, idx) => ({
      ...item,
      [quantityField]: quantities[idx],
      ...(isOrder ? {} : { checked: !!enteredItems[idx].checked })
    }));
    const totals = new Map();
    items.forEach(item => {
      if (typeof item.productId !== "string" || !item.productId || item.productId.includes("/")) {
        throw Error("商品を確認してください");
      }
      const total = (totals.get(item.productId) || 0) + item[quantityField];
      inventoryQuantity(total, item.productName + "の合計数量");
      totals.set(item.productId, total);
    });
    if (items.length + totals.size + 1 > 500) throw Error("品目数が多すぎます。分けて登録してください");
    const products = await Promise.all([...totals].map(async ([id, qty]) => {
      const productRef = db.collection(COLLECTION).doc(id);
      const doc = await tx.get(productRef);
      if (!doc.exists) throw Error("商品が削除されています：" + id);
      const product = doc.data();
      const stock = inventoryQuantity(product.currentStock ?? 0, product.name + "の在庫");
      const reserved = inventoryQuantity(product.reservedStock ?? 0, product.name + "の準備分");
      const next = stock + (type === "in" ? qty : -qty);
      if (next < reserved) throw Error("準備分を除く在庫が不足しています：" + product.name);
      inventoryQuantity(next, product.name + "の反映後在庫");
      return { productRef, next };
    }));
    products.forEach(({ productRef, next }) => tx.update(productRef, { currentStock: next }));
    items.forEach(item => tx.set(db.collection(MOVEMENTS_COLLECTION).doc(), {
      productId: item.productId,
      productName: item.productName,
      unit: item.unit || "",
      type,
      qty: item[quantityField],
      note: isOrder ? `発注 ${record.orderNumber} の入荷反映` : `伝票 ${record.slipNumber} による検品反映`,
      staff,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }));
    tx.update(ref, isOrder ? {
      items, status: "received",
      receivedAt: firebase.firestore.FieldValue.serverTimestamp(), receivedBy: staff
    } : {
      items, status: "done",
      completedAt: firebase.firestore.FieldValue.serverTimestamp(), completedBy: staff
    });
  });
}

function handleOrderMarkReceived() {
  const o = allOrders.find(x => x.id === openOrderId);
  const btn = document.getElementById("orderMarkReceivedBtn");
  if (!o || btn.disabled) return;
  let items;
  try {
    items = (o.items || []).map((item, idx) => {
      const input = document.querySelector(`.order-received-qty[data-idx="${idx}"]`);
      if (!input) throw Error("発注表を開き直して数量を確認してください");
      return { ...item, receivedQty: inventoryQuantity(input.value, item.productName + "の入荷数") };
    });
  } catch (err) { showToast(err.message); return; }
  const orderRef = db.collection(ORDERS_COLLECTION).doc(o.id);
  btn.disabled = true;
  btn.textContent = "反映中...";
  completeInventoryRecord(orderRef, o, items, true, currentStaffName).then(() => {
    showToast("入荷を記録し、在庫に反映しました");
    closeOrderDetailModal();
  }).catch(err => {
    console.error(err);
    showToast(err.message || "反映に失敗しました");
  }).finally(() => {
    btn.disabled = false;
    btn.textContent = "入荷完了として記録する（在庫に反映）";
  });
}

// ===================== Phase3: カメラでのQRスキャン =====================
function openScanModal(mode) {
  scanMode = mode;
  if (mode === "slip-item") pendingSlipScanCode = null;
  document.getElementById("scanModalTitle").textContent =
    mode === "slip-item" ? "商品QRをスキャン（検品）" : "QRコードをスキャン";
  document.getElementById("scanHint").textContent =
    mode === "slip-item" ? "現品のQRと検品シールのQRを順に1回ずつスキャンしてください（2回で1件確認）" : "商品または伝票のQRコードにカメラを向けてください";
  const stepStatus = document.getElementById("scanStepStatus");
  if (mode === "slip-item") {
    stepStatus.style.display = "block";
    stepStatus.style.color = "#8a8272";
    stepStatus.textContent = "① 現品または検品シールのどちらか一方をスキャンしてください";
  } else {
    stepStatus.style.display = "none";
  }
  document.getElementById("scanError").textContent = "";
  document.getElementById("scanOverlay").classList.add("show");
  startScanCamera();
}

function closeScanModal() {
  stopScanCamera();
  document.getElementById("scanOverlay").classList.remove("show");
  if (slipScannerActive && document.getElementById("slipDetailOverlay").classList.contains("show")) {
    document.getElementById("slipItemScannerInput").focus();
  }
}

function startScanCamera() {
  const video = document.getElementById("scanVideo");
  if (typeof jsQR === "undefined") {
    document.getElementById("scanError").textContent = "QR読み取りライブラリの読み込みに失敗しました。通信環境をご確認の上、再読み込みしてください。";
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById("scanError").textContent = "このブラウザはカメラ読み取りに対応していません";
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(stream => {
      scanStream = stream;
      video.srcObject = stream;
      video.play();
      scanRAF = requestAnimationFrame(scanTick);
    })
    .catch(err => {
      console.error(err);
      document.getElementById("scanError").textContent = "カメラを起動できませんでした（ブラウザのカメラ権限をご確認ください）";
    });
}

function stopScanCamera() {
  if (scanRAF) cancelAnimationFrame(scanRAF);
  scanRAF = null;
  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  const video = document.getElementById("scanVideo");
  if (video) video.srcObject = null;
}

function scanTick() {
  const video = document.getElementById("scanVideo");
  const canvas = document.getElementById("scanCanvas");
  if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
    if (code && code.data) {
      handleScanResult(code.data);
      return;
    }
  }
  scanRAF = requestAnimationFrame(scanTick);
}

function extractScannedId(text) {
  const pm = text.match(/#product=([^&]+)/);
  if (pm) return { type: "product", id: decodeURIComponent(pm[1]) };
  const sm = text.match(/#slip=([^&]+)/);
  if (sm) return { type: "slip", id: decodeURIComponent(sm[1]) };
  return { type: "unknown", id: text.trim() };
}

function handleScanResult(text) {
  const parsed = extractScannedId(text);

  if (scanMode === "slip-item") {
    handleSlipItemVerifyScan(resolveScannedProductId(text));
    // 検品モードは閉じずに継続スキャン。連続検知を防ぐため少し間を空けて再開
    setTimeout(() => {
      if (document.getElementById("scanOverlay").classList.contains("show")) {
        scanRAF = requestAnimationFrame(scanTick);
      }
    }, 1200);
    return;
  }

  let { type, id } = parsed;
  if (type === "unknown") {
    if (allProducts.find(p => p.id === id)) type = "product";
    else if (allSlips.find(s => s.id === id)) type = "slip";
  }

  if (type === "product") {
    const p = allProducts.find(x => x.id === id);
    stopScanCamera();
    closeScanModal();
    if (p) openMoveModal(p.id); else showToast("該当する商品が見つかりません");
  } else if (type === "slip") {
    const s = allSlips.find(x => x.id === id);
    stopScanCamera();
    closeScanModal();
    if (s) { switchTab("slips"); openSlipDetailModal(s.id); } else showToast("該当する伝票が見つかりません");
  } else {
    document.getElementById("scanError").textContent = "認識できませんでした。もう一度お試しください。";
    scanRAF = requestAnimationFrame(scanTick);
  }
}

// ===================== Phase3.5: 警告音・バイブレーション =====================
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

// ページ内の最初のタップ／クリックでAudioContextの再生許可を得ておく
// （こうしておかないと、スキャン時にresume()が間に合わず音が出ないことがある）
function unlockAudioCtx() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  document.removeEventListener("click", unlockAudioCtx);
  document.removeEventListener("touchend", unlockAudioCtx);
  document.removeEventListener("keydown", unlockAudioCtx);
}
document.addEventListener("click", unlockAudioCtx);
document.addEventListener("touchend", unlockAudioCtx);
document.addEventListener("keydown", unlockAudioCtx);

function playTone(freq, durationMs, type) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const fire = () => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch (e) { console.error(e); }
  };
  // resume()の完了を待ってから鳴らす（サスペンド中に鳴らそうとすると無音になるため）
  if (ctx.state === "suspended") {
    ctx.resume().then(fire).catch(() => {});
  } else {
    fire();
  }
}

function playSuccessBeep() {
  playTone(880, 100, "sine");
  if (navigator.vibrate) navigator.vibrate(40);
}

function playWarningAlert() {
  playTone(220, 180, "square");
  setTimeout(() => playTone(220, 180, "square"), 220);
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

// ===================== Phase2: 入出庫（検品スキャン処理） =====================
// 検品シール方式：現品のQRと検品シールのQRを順にスキャンし、2回とも同じ商品であれば1件確認とする
function setSlipScanStatus(message, warning) {
  const status = document.getElementById("slipScanStatus");
  if (status) {
    status.textContent = message;
    status.className = warning ? "scan-warning" : "scan-ready";
  }
}

function handleSlipItemVerifyScan(productId) {
  const stepStatus = document.getElementById("scanStepStatus");
  const slip = allSlips.find(s => s.id === openSlipId);
  if (!slip || slip.status === "done") {
    showToast("この伝票は検品完了済みです");
    return;
  }
  const item = slip?.items?.find(i => i.productId === productId);
  if (!item) {
    pendingSlipScanCode = null;
    playWarningAlert();
    showToast("⚠️ この伝票に含まれない商品です");
    setSlipScanStatus("⚠️ 対象外の商品です。現品から読み直してください。", true);
    if (stepStatus) stepStatus.textContent = "⚠️ 対象外の商品です。現品から読み直してください。";
    return;
  }
  const pname = item.productName || allProducts.find(x => x.id === productId)?.name || "商品";

  if (pendingSlipScanCode === null) {
    pendingSlipScanCode = productId;
    playTone(660, 60, "sine");
    showToast("1回目OK。もう一方のQR（現品／検品シール）をスキャンしてください");
    setSlipScanStatus(`① ${pname} を確認しました → ② 検品シールを読み取ってください`, false);
    if (stepStatus) {
      stepStatus.style.color = "var(--indigo-deep)";
      stepStatus.textContent = `① ${pname} を確認しました → ② もう一方のQRをスキャンしてください`;
    }
    return;
  }
  const firstCode = pendingSlipScanCode;
  pendingSlipScanCode = null;
  if (firstCode !== productId) {
    playWarningAlert();
    showToast("⚠️ 現品と検品シールの商品が一致しません");
    setSlipScanStatus("⚠️ 商品が一致しません。現品から読み直してください。", true);
    if (stepStatus) {
      stepStatus.style.color = "var(--warn-text, #a3392b)";
      stepStatus.textContent = "⚠️ 一致しませんでした。もう一度、現品→検品シールの順にスキャンしてください";
    }
    return;
  }
  if (handleSlipItemScan(productId)) {
    setSlipScanStatus(`✅ ${pname} を確認しました。次の現品を読み取ってください。`, false);
    if (stepStatus) {
      stepStatus.style.color = "var(--ok-text, #0f6e56)";
      stepStatus.textContent = `✅ ${pname} を確認しました。次の商品をスキャンしてください`;
    }
  } else {
    setSlipScanStatus(`⚠️ ${pname} は予定数に達しています。次の現品を読み取ってください。`, true);
  }
}

function resolveScannedProductId(text) {
  const parsed = extractScannedId(text);
  if (parsed.type === "slip") return null;
  const byId = allProducts.find(p => p.id === parsed.id);
  if (byId) return byId.id;
  const code = parsed.id.normalize("NFKC").toLowerCase();
  const matches = allProducts.filter(p => String(p.code || "").trim().normalize("NFKC").toLowerCase() === code);
  return matches.length === 1 ? matches[0].id : null;
}

function handleSlipItemScan(productId) {
  const s = allSlips.find(x => x.id === openSlipId);
  if (!s || s.status === "done") { showToast("伝票が開かれていないか、検品完了済みです"); return false; }
  const idx = (s.items || []).findIndex(it => it.productId === productId);

  if (idx === -1) {
    playWarningAlert();
    showToast("⚠️ この伝票に含まれない商品です");
    return false;
  }

  const qtyInput = document.querySelector(`.slip-check-qty[data-idx="${idx}"]`);
  const checkBox = document.querySelector(`.slip-check-box[data-idx="${idx}"]`);
  const planned = s.items[idx].plannedQty;
  const name = s.items[idx].productName;
  const unit = s.items[idx].unit || "";
  if (!qtyInput) return false;

  const current = Number(qtyInput.value) || 0;

  if (current >= planned) {
    // 数量超過（規定数に達しているのにさらにスキャンされた）
    playWarningAlert();
    showToast(`⚠️ 数量超過：${name} は既に${planned}${unit}に達しています`);
    return false;
  }

  const next = current + 1;
  qtyInput.value = next;
  if (checkBox) checkBox.checked = next >= planned;
  playSuccessBeep();
  showToast(`${name}：${next}/${planned}${unit} 確認`);
  return true;
}

// ===================== Phase3.5: ハンディスキャナー（キーボード入力）対応 =====================
function handleScannerWedgeInput(inputEl, mode) {
  const text = inputEl.value.trim();
  inputEl.value = "";
  if (!text) return;

  const parsed = extractScannedId(text);

  if (mode === "slip-item") {
    if (!slipScannerActive) return;
    const productId = resolveScannedProductId(text);
    handleSlipItemVerifyScan(productId);
    inputEl.focus();
    return;
  }

  let { type, id } = parsed;
  if (type === "unknown") {
    if (allProducts.find(p => p.id === id)) type = "product";
    else if (allSlips.find(s => s.id === id)) type = "slip";
  }

  if (type === "product") {
    const p = allProducts.find(x => x.id === id);
    if (p) openMoveModal(p.id); else showToast("該当する商品が見つかりません");
  } else if (type === "slip") {
    const s = allSlips.find(x => x.id === id);
    if (s) { switchTab("slips"); openSlipDetailModal(s.id); } else showToast("該当する伝票が見つかりません");
  } else {
    showToast("認識できませんでした");
  }
  inputEl.focus();
}

function handleSlipComplete() {
  const s = allSlips.find(x => x.id === openSlipId);
  const btn = document.getElementById("slipDetailCompleteBtn");
  if (!s || btn.disabled) return;
  let items;
  try {
    items = (s.items || []).map((item, idx) => {
      const input = document.querySelector(`.slip-check-qty[data-idx="${idx}"]`);
      const checkBox = document.querySelector(`.slip-check-box[data-idx="${idx}"]`);
      if (!input) throw Error("伝票を開き直して数量を確認してください");
      return {
        ...item,
        checkedQty: inventoryQuantity(input.value, item.productName + "の確認数"),
        checked: !!checkBox?.checked
      };
    });
  } catch (err) { showToast(err.message); return; }
  if (!confirm("検品を完了し、在庫に反映します。よろしいですか？")) return;
  const slipRef = db.collection(SLIPS_COLLECTION).doc(s.id);
  btn.disabled = true;
  btn.textContent = "反映中...";
  completeInventoryRecord(slipRef, s, items, false, currentStaffName).then(() => {
    showToast("検品を完了し、在庫に反映しました");
    closeSlipDetailModal();
  }).catch(err => {
    console.error(err);
    showToast(err.message || "反映に失敗しました");
  }).finally(() => {
    btn.disabled = false;
    btn.textContent = "検品完了として記録する";
  });
}

// ===================== 商品登録 =====================
function handleRegisterSubmit() {
  const name = document.getElementById("regName").value.trim();
  const code = document.getElementById("regCode").value.trim();
  const supplier = document.getElementById("regSupplier").value.trim();
  const lot = document.getElementById("regLot").value.trim();
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
    name, code, supplier, lot, category, unit,
    price,
    currentStock: stock,
    minStock: minStock,
    note,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    showToast("商品を登録しました");
    document.getElementById("regName").value = "";
    document.getElementById("regCode").value = "";
    document.getElementById("regSupplier").value = "";
    document.getElementById("regLot").value = "";
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
  document.getElementById("editSupplier").value = p.supplier || "";
  document.getElementById("editLot").value = p.lot || "";
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
    supplier: document.getElementById("editSupplier").value.trim(),
    lot: document.getElementById("editLot").value.trim(),
    category: document.getElementById("editCategory").value,
    unit: document.getElementById("editUnit").value.trim(),
    price: Number(document.getElementById("editPrice").value) || 0,
    currentStock: Number(document.getElementById("editStock").value) || 0,
    minStock: Number(document.getElementById("editMinStock").value) || 0,
    note: document.getElementById("editNote").value.trim()
  };
  const existing = allProducts.find(p => p.id === editingId);
  if (data.currentStock < Number(existing?.reservedStock || 0)) {
    showToast("月始祭準備分を下回る在庫数にはできません");
    return;
  }
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

// ===================== 試作運用：棚卸し・月始祭・防災用品 =====================
const $w = id => document.getElementById(id);
const integer = value => Number.isInteger(Number(value)) && Number(value) >= 0;
const safe = value => escapeHtml(String(value ?? ""));
const stamp = () => firebase.firestore.FieldValue.serverTimestamp();
const dateLabel = value => value && value.toDate ? formatDateTime(value.toDate()) : "―";
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}`; };
function initWorkModules() {
  // HTML がまだ旧版でも、ログインボタンの登録を止めない。
  if (!$w("stocktakeDate")) return;
  $w("stocktakeDate").value = todayDateInputValue();
  $w("festivalMonth").value = currentMonth();
  $w("bulkModeBtn").onclick = () => { bulkMode = !bulkMode; bulkSelected.clear(); updateBulkButton(); renderProductList(); };
  $w("bulkDeleteBtn").onclick = bulkDeleteProducts;
  $w("bulkSelectAllBtn").onclick = () => toggleVisibleSelection("#productList .bulk-check", bulkSelected);
  $w("historySelectAllBtn").onclick = () => toggleVisibleSelection("#historyList .history-check", historySelected);
  $w("historyDeleteBtn").onclick = () => deleteSelectedRecords(MOVEMENTS_COLLECTION, historySelected, allMovements, "入出庫履歴");
  $w("slipSelectAllBtn").onclick = () => toggleVisibleSelection("#slipList .slip-check-select", slipSelected);
  $w("slipDeleteBtn").onclick = () => deleteSelectedRecords(SLIPS_COLLECTION, slipSelected, allSlips, "伝票・検品");
  $w("stocktakeLoadBtn").onclick = loadStocktake;
  $w("stocktakeDate").onchange = () => { stocktakeRecord=null; stocktakeFestival=null; renderStocktake(); loadStocktake(); };
  $w("stocktakeSaveBtn").onclick = saveStocktake;
  $w("stocktakeApplyBtn").onclick = applyStocktake;
  $w("stocktakePrintBtn").onclick = () => printWork("stocktake");
  $w("festivalLoadBtn").onclick = loadFestival;
  $w("festivalMonth").onchange = () => { festivalRecord=null; renderFestival(); loadFestival(); };
  $w("festivalSaveBtn").onclick = saveFestival;
  $w("festivalCommitBtn").onclick = () => changeFestival(true);
  $w("festivalReturnBtn").onclick = () => changeFestival(false);
  $w("festivalPrintBtn").onclick = () => printWork("festival");
  if ($w("festivalPreparedPrintBtn")) $w("festivalPreparedPrintBtn").onclick = () => printWork("festival", true);
  $w("festivalSettleBtn").onclick = settleFestival;
  $w("disasterAddBtn").onclick = addDisasterProduct;
  $w("disasterMoveBtn").onclick = recordDisasterMovement;
  ["stocktake", "festival"].forEach(type => {
    const category = $w(`${type}Category`), search = $w(`${type}Search`), sort = $w(`${type}Sort`);
    if (category && search && sort) {
      category.onchange = search.oninput = sort.onchange = () => applyWorkTableView(type);
    }
  });
}
function applyWorkTableView(type) {
  const body=$w(`${type}Rows`), category=$w(`${type}Category`), search=$w(`${type}Search`), sort=$w(`${type}Sort`);
  if(!body||!category||!search||!sort)return;
  const rows=[...body.querySelectorAll("tr")];
  const selected=category.value;
  const genres=[...new Set(rows.map(row=>row.dataset.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ja"));
  category.replaceChildren(category.options[0],...genres.map(genre=>new Option(genre,genre)));
  category.value=genres.includes(selected)?selected:"";
  const term=search.value.trim().normalize("NFKC").toLowerCase();
  const compare=(a,b)=>a.localeCompare(b,"ja",{numeric:true,sensitivity:"base"});
  rows.sort((a,b)=>{
    if(sort.value==="stock-desc")return Number(b.dataset.stock)-Number(a.dataset.stock)||compare(a.dataset.name,b.dataset.name);
    if(sort.value==="category")return compare(a.dataset.category,b.dataset.category)||compare(a.dataset.name,b.dataset.name);
    if(sort.value==="code")return compare(a.dataset.code||"\uffff",b.dataset.code||"\uffff")||compare(a.dataset.name,b.dataset.name);
    return compare(a.dataset.name,b.dataset.name);
  });
  let visible=0;
  rows.forEach(row=>{
    body.appendChild(row);
    const matchesCategory=!category.value||row.dataset.category===category.value;
    const matchesText=!term||`${row.dataset.name} ${row.dataset.code}`.normalize("NFKC").toLowerCase().includes(term);
    row.style.display=matchesCategory&&matchesText?"":"none";
    if(matchesCategory&&matchesText)visible++;
  });
  $w(`${type}FilterCount`).textContent=`${visible} / ${rows.length}件を表示`;
  if(type==="festival") renderFestivalPrepared();
}
function updateBulkButton() {
  $w("bulkModeBtn").textContent = bulkMode ? "選択を終了" : "商品を選んで一括削除";
  $w("bulkDeleteBtn").style.display = bulkMode ? "inline-block" : "none";
  $w("bulkDeleteBtn").textContent = `選択した商品を削除（${bulkSelected.size}件）`;
  if ($w("bulkSelectAllBtn")) $w("bulkSelectAllBtn").style.display = bulkMode ? "inline-block" : "none";
}
function updateSelectionButtons() {
  if ($w("historyDeleteBtn")) $w("historyDeleteBtn").textContent = `選択した履歴を削除（${historySelected.size}件）`;
  if ($w("slipDeleteBtn")) $w("slipDeleteBtn").textContent = `選択した伝票を削除（${slipSelected.size}件）`;
}
function toggleVisibleSelection(selector, selected) {
  const boxes = [...document.querySelectorAll(selector)];
  if (!boxes.length) return showToast("表示中の項目がありません");
  const allChecked = boxes.every(box => selected.has(box.dataset.id));
  boxes.forEach(box => {
    box.checked = !allChecked;
    if (allChecked) selected.delete(box.dataset.id); else selected.add(box.dataset.id);
  });
  updateBulkButton(); updateSelectionButtons();
  showToast(allChecked ? `${boxes.length}件の選択を解除しました` : `${boxes.length}件を選択しました`);
}
async function deleteSelectedRecords(collection, selected, records, label) {
  const ids = [...selected].filter(id => records.some(record => record.id === id));
  if (!ids.length) return showToast("削除する項目を選択してください");
  const typed = prompt(`${label}を${ids.length}件削除します。履歴・伝票の削除では現在庫数は変更されません。確認のため件数「${ids.length}」を入力してください。`);
  if (typed !== String(ids.length)) return;
  try {
    for (let i=0; i<ids.length; i+=400) {
      const batch=db.batch(), chunk=ids.slice(i,i+400);
      chunk.forEach(id => batch.delete(db.collection(collection).doc(id)));
      await batch.commit(); chunk.forEach(id => selected.delete(id));
    }
    updateSelectionButtons(); showToast(`${ids.length}件を削除しました`);
  } catch(err) { console.error(err); showToast("削除が途中で止まりました。選択状態を確認してください"); }
}
async function bulkDeleteProducts() {
  const ids = [...bulkSelected].filter(id => allProducts.some(p => p.id === id));
  if (!ids.length) return showToast("商品を選択してください");
  const typed = prompt(`${ids.length}件の商品詳細を削除します。伝票・入出庫の履歴は残ります。確認のため件数「${ids.length}」を入力してください。`);
  if (typed !== String(ids.length)) return;
  const btn = $w("bulkDeleteBtn"); btn.disabled = true;
  try {
    // Firestore のバッチ上限を考慮。途中失敗時は残りを選択状態で保持する。
    for (let i=0; i<ids.length; i+=400) {
      const batch = db.batch();
      ids.slice(i,i+400).forEach(id => batch.delete(db.collection(COLLECTION).doc(id)));
      await batch.commit();
      ids.slice(i,i+400).forEach(id => bulkSelected.delete(id));
    }
    showToast(`${ids.length}件を削除しました`);
  } catch (err) { console.error(err); showToast("削除が途中で止まりました。残りの選択を確認してください"); }
  finally { btn.disabled = false; updateBulkButton(); renderProductList(); }
}
function printWork(tab, preparedOnly=false) {
  const panel=$w("tab"+tab[0].toUpperCase()+tab.slice(1));
  if(panel?.style.display==="none") switchTab(tab);
  if(preparedOnly) renderFestivalPrepared();
  document.body.classList.toggle("prepared-print", preparedOnly);
  document.body.classList.add("work-print");
  setTimeout(() => window.print(), 150);
}
window.addEventListener("afterprint", () => document.body.classList.remove("work-print", "prepared-print", "label-print", "slip-print", "order-print"));
// ===================== 棚卸し：倉庫＋翌月の月始祭準備分 =====================
const stocktakeKey = () => $w("stocktakeDate").value;
const festivalKey = () => $w("festivalMonth").value;
function nextFestivalMonth(date) {
  const [year,month]=date.split("-").map(Number);
  if (!year || !month) return "";
  return month===12 ? `${year+1}-01` : `${year}-${String(month+1).padStart(2,"0")}`;
}
function stagedForStocktake() {
  if (stocktakeFestival?.status!=="prepared") return new Map();
  return new Map((stocktakeFestival.items||[]).map(i=>[i.productId,Number(i.qty||0)]));
}
let stocktakeFestival=null;
function renderStocktake() {
  const body=$w("stocktakeRows"); if(!body) return;
  const saved=new Map((stocktakeRecord?.items||[]).map(i=>[i.productId,i]));
  const staged=stagedForStocktake();
  const applied=stocktakeRecord?.status==="applied";
  const applying=stocktakeRecord?.status==="applying";
  const rows=applied||applying ? stocktakeRecord.items : allProducts.map(p=>{
    const old=saved.get(p.id), prepared=old ? Number(old.stagedQty||0) : (staged.get(p.id)||0);
    const legacy=old ? !!old.legacyDeducted : stocktakeFestival?.status==="prepared" && stocktakeFestival.stockMode!=="included" && prepared>0;
    const total=old ? Number(old.bookQty) : Number(p.currentStock||0)+(legacy?prepared:0);
    return {productId:p.id,name:p.name,code:p.code,category:p.category,unit:p.unit,bookQty:total,
      stagedQty:prepared,legacyDeducted:legacy, warehouseActual:old?.warehouseActual??null,
      stagedActual:old?.stagedActual??(prepared?null:0),note:old?.note||""};
  });
  body.innerHTML=rows.map(i=>{
    const prepared=Number(i.stagedQty||0), book=Number(i.bookQty||0);
    const actual=i.stagedActual!=null && i.warehouseActual!=null ? Number(i.stagedActual)+Number(i.warehouseActual) : null;
    return `<tr data-id="${safe(i.productId)}" data-category="${safe(i.category||"未分類")}" data-name="${safe(i.name)}" data-code="${safe(i.code)}" data-stock="${book}"><td>${safe(i.code)}</td><td>${safe(i.name)}</td><td>${safe(i.category)}</td><td>${prepared}</td><td>${book-prepared}</td><td>${book}</td><td><input class="staged-actual" type="number" min="0" step="1" value="${i.stagedActual??""}" ${applied||applying?"disabled":""}></td><td><input class="warehouse-actual" type="number" min="0" step="1" value="${i.warehouseActual??""}" ${applied||applying?"disabled":""}></td><td class="actual-total">${actual??"―"}</td><td class="difference">${actual===null?"―":actual-book}</td><td><input class="note" type="text" value="${safe(i.note)}" ${applied||applying?"disabled":""}></td></tr>`;
  }).join("");
  labelTableCells(body);
  body.querySelectorAll(".staged-actual,.warehouse-actual").forEach(input=>input.oninput=()=>{
    const row=input.closest("tr"), stage=row.querySelector(".staged-actual").value, warehouse=row.querySelector(".warehouse-actual").value;
    const actual=stage!=="" && warehouse!=="" && integer(stage) && integer(warehouse) ? Number(stage)+Number(warehouse):null;
    row.querySelector(".actual-total").textContent=actual??"―";
    row.querySelector(".difference").textContent=actual===null?"―":actual-Number(row.children[5].textContent);
  });
  $w("stocktakeStatus").textContent=`${stocktakeKey()} 棚卸し／翌月準備：${nextFestivalMonth(stocktakeKey())}　${applied?"確定済み":applying?`反映中 ${stocktakeRecord.appliedCount||0}/${stocktakeRecord.items.length}件`:stocktakeRecord?"入力保存済み":"新規"}`;
  $w("stocktakeSaveBtn").disabled=applied||applying;
  $w("stocktakeApplyBtn").disabled=applied;
  $w("stocktakeApplyBtn").textContent=applying?"反映を再開":"差異を在庫に反映";
  applyWorkTableView("stocktake");
}
async function loadStocktake() {
  const key=stocktakeKey(); if(!key) return showToast("棚卸日を選択してください");
  const target=nextFestivalMonth(key);
  try {
    const [record,plan]=await Promise.all([db.collection(STOCKTAKES).doc(key).get(),db.collection(FESTIVALS).doc(target).get()]);
    if(stocktakeKey()!==key) return;
    stocktakeRecord=record.exists?record.data():null;
    stocktakeFestival=plan.exists?plan.data():null;
    renderStocktake();
  } catch(err) { console.error(err); showToast("棚卸し表を開けませんでした"); }
}
function collectStocktake() {
  const previous=new Map((stocktakeRecord?.items||[]).map(i=>[i.productId,i]));
  const stage=stagedForStocktake();
  return [...$w("stocktakeRows").querySelectorAll("tr")].map(row=>{
    const id=row.dataset.id,p=allProducts.find(x=>x.id===id),old=previous.get(id);
    const warehouse=row.querySelector(".warehouse-actual").value, prepared=row.querySelector(".staged-actual").value;
    if(warehouse!==""&&!integer(warehouse) || prepared!==""&&!integer(prepared)) throw Error("実数は0以上の整数で入力してください");
    const stagedQty=old?Number(old.stagedQty||0):(stage.get(id)||0);
    const legacyDeducted=old?!!old.legacyDeducted:stocktakeFestival?.status==="prepared" && stocktakeFestival.stockMode!=="included" && stagedQty>0;
    return {productId:id,name:p?.name||old?.name||"",code:p?.code||old?.code||"",category:p?.category||old?.category||"",unit:p?.unit||old?.unit||"",
      bookQty:old?Number(old.bookQty):Number(p.currentStock||0)+(legacyDeducted?stagedQty:0),stagedQty,legacyDeducted,
      warehouseActual:warehouse===""?null:Number(warehouse),stagedActual:prepared===""?null:Number(prepared),note:row.querySelector(".note").value.trim()};
  });
}
async function saveStocktake() {
  if(!stocktakeKey()||stocktakeRecord?.status==="applied") return;
  try {
    const items=collectStocktake();
    await db.collection(STOCKTAKES).doc(stocktakeKey()).set({date:stocktakeKey(),festivalMonth:nextFestivalMonth(stocktakeKey()),items,status:"draft",updatedBy:currentStaffName,updatedAt:stamp()});
    stocktakeRecord={items,status:"draft"};renderStocktake();showToast("棚卸し表を保存しました");
  } catch(err) {console.error(err);showToast(err.message||"保存に失敗しました");}
}
async function applyStocktake() {
  const key=stocktakeKey();if(!key||stocktakeRecord?.status==="applied")return;
  const resuming=stocktakeRecord?.status==="applying";
  let items;
  try{items=resuming?stocktakeRecord.items:collectStocktake();}catch(err){return showToast(err.message);}
  if(!items.length||items.some(i=>i.warehouseActual===null||i.stagedActual===null))return showToast("倉庫と準備分の実数をすべて入力してください");
  if(!confirm(resuming?"途中から棚卸し反映を再開しますか？":`${items.length}件の棚卸しを在庫に反映します。確定後は編集できません。よろしいですか？`))return;
  const ref=db.collection(STOCKTAKES).doc(key),btn=$w("stocktakeApplyBtn");btn.disabled=true;
  try {
    if(!resuming){
      await db.runTransaction(async tx=>{
        const prior=await tx.get(ref);if(prior.exists&&["applying","applied"].includes(prior.data().status))throw Error("既に反映が始まっています。表を開き直してください");
        tx.set(ref,{date:key,festivalMonth:nextFestivalMonth(key),items,status:"applying",appliedCount:0,startedBy:currentStaffName,startedAt:stamp()});
      });
      stocktakeRecord={items,status:"applying",appliedCount:0};renderStocktake();
    }
    let position=Number(stocktakeRecord.appliedCount||0);
    while(position<items.length){
      const expected=position,chunk=items.slice(position,position+100);
      await db.runTransaction(async tx=>{
        const state=await tx.get(ref);
        if(!state.exists||state.data().status!=="applying"||state.data().appliedCount!==expected)throw Error("進捗が変わりました。表を開き直してください");
        const planDoc=await tx.get(db.collection(FESTIVALS).doc(nextFestivalMonth(key)));
        const plan=planDoc.exists&&planDoc.data().status==="prepared"?planDoc.data():null;
        const stage=new Map((plan?.items||[]).map(i=>[i.productId,Number(i.qty||0)]));
        if(chunk.some(i=>i.stagedQty!==(stage.get(i.productId)||0)||i.legacyDeducted!==(!!plan&&plan.stockMode!=="included"&&i.stagedQty>0)))throw Error("月始祭の準備状態が変わりました。確認してください");
        const docs=await Promise.all(chunk.map(i=>tx.get(db.collection(COLLECTION).doc(i.productId))));
        docs.forEach((doc,n)=>{const i=chunk[n],adjusted=i.warehouseActual+i.stagedActual-(i.legacyDeducted?i.stagedQty:0);
          if(!doc.exists||Number(doc.data().currentStock||0)!==i.bookQty-(i.legacyDeducted?i.stagedQty:0)||adjusted<Number(doc.data().reservedStock||0))throw Error(`在庫または準備分を確認してください：${i.name}`);
        });
        chunk.forEach((i,n)=>{const total=i.warehouseActual+i.stagedActual,diff=total-i.bookQty;if(!diff)return;
          tx.update(docs[n].ref,{currentStock:total-(i.legacyDeducted?i.stagedQty:0)});
          tx.set(db.collection(MOVEMENTS_COLLECTION).doc(),{productId:i.productId,productName:i.name,unit:i.unit,type:diff>0?"in":"out",qty:Math.abs(diff),note:`棚卸し ${key}：${i.note||"差異調整"}`,staff:currentStaffName,createdAt:stamp()});
        });
        tx.update(ref,{appliedCount:expected+chunk.length,updatedAt:stamp()});
      });
      position+=chunk.length;stocktakeRecord.appliedCount=position;
      $w("stocktakeStatus").textContent=`在庫反映中：${position}/${items.length}件`;
    }
    await db.runTransaction(async tx=>{const state=await tx.get(ref);if(!state.exists||state.data().status!=="applying"||state.data().appliedCount!==items.length)throw Error("進捗が変わりました");tx.update(ref,{status:"applied",appliedBy:currentStaffName,appliedAt:stamp()});});
    stocktakeRecord={items,status:"applied",appliedCount:items.length};renderStocktake();showToast("棚卸しの合計実数を在庫に反映しました");
  }catch(err){console.error(err);showToast(`${err.message||"反映に失敗しました"}。途中の場合は再開できます`);}
  finally{btn.disabled=stocktakeRecord?.status==="applied";}
}
// ===================== 月始祭：準備は総在庫に含め、頒布後に精算 =====================
const festivalFields=["extraQty","directQty","returnedQty","damagedQty","sampleQty"];
function festivalNumbers(i) {
  const qty=Number(i.qty||0),extra=Number(i.extraQty||0),direct=Number(i.directQty||0),returned=Number(i.returnedQty||0),damaged=Number(i.damagedQty||0),sample=Number(i.sampleQty||0);
  return {qty,extra,direct,returned,damaged,sample,sold:qty+extra+direct-returned-damaged-sample,consumed:qty+extra-returned};
}
function renderFestivalPrepared() {
  const target=$w("festivalPreparedRows"), source=$w("festivalRows");
  if(!target||!source)return;
  const prepared=[...source.querySelectorAll("tr")].filter(row=>row.style.display!=="none"&&Number(row.querySelector(".qty")?.value)>0);
  target.innerHTML=prepared.map(row=>{
    const product=allProducts.find(p=>p.id===row.dataset.id);
    const recorded=(festivalRecord?.items||[]).find(i=>i.productId===row.dataset.id);
    return `<tr><td>${safe(row.dataset.code||"")}</td><td>${safe(row.dataset.name||"")}</td><td>${safe(row.dataset.category||"未分類")}</td><td>${safe(row.querySelector(".qty").value)}</td><td>${safe(product?.unit||recorded?.unit||"個")}</td></tr>`;
  }).join("");
  $w("festivalPreparedCount").textContent=`準備数のある商品：${prepared.length}件（上のジャンル・検索条件を反映）`;
  $w("festivalPreparedPrintBtn").disabled=prepared.length===0;
}
function renderFestival() {
  const body=$w("festivalRows");if(!body)return;
  const saved=new Map((festivalRecord?.items||[]).map(i=>[i.productId,i]));
  const status=festivalRecord?.status||"draft", locked=status==="prepared"||status==="settled";
  const rows=locked?festivalRecord.items:allProducts.map(p=>({productId:p.id,name:p.name,code:p.code,unit:p.unit,price:Number(p.price||0),...saved.get(p.id)}));
  body.innerHTML=rows.map(i=>{
    const p=allProducts.find(x=>x.id===i.productId),n=festivalNumbers(i),price=Number(i.price??p?.price??0),disabled=status==="settled"?"disabled":"";
    const field=(cls,v,lock=false)=>`<input type="number" class="${cls}" min="0" step="1" value="${v}" ${disabled||lock&&locked?"disabled":""}>`;
    const total=Number(p?.currentStock||0)+(status==="prepared"&&festivalRecord?.stockMode!=="included"?n.qty:0);
    return `<tr data-id="${safe(i.productId)}" data-category="${safe(p?.category||i.category||"未分類")}" data-name="${safe(i.name)}" data-code="${safe(i.code)}" data-stock="${total}"><td>${safe(i.code)}</td><td>${safe(i.name)}</td><td>${p?total:"―"}</td><td>${field("qty",n.qty,true)}</td><td>${field("extraQty",n.extra)}</td><td>${field("directQty",n.direct)}</td><td>${field("returnedQty",n.returned)}</td><td>${field("damagedQty",n.damaged)}</td><td>${field("sampleQty",n.sample)}</td><td class="soldQty">${n.sold}</td><td><input class="price" type="number" min="0" value="${price}" ${disabled}></td><td class="salesAmount">${(n.sold*price).toLocaleString()}</td></tr>`;
  }).join("");
  labelTableCells(body);
  body.querySelectorAll("input").forEach(input=>input.oninput=()=>{const r=input.closest("tr"),i={qty:r.querySelector(".qty").value};festivalFields.forEach(f=>i[f]=r.querySelector(`.${f}`).value);const n=festivalNumbers(i);r.querySelector(".soldQty").textContent=n.sold;r.querySelector(".salesAmount").textContent=(n.sold*Number(r.querySelector(".price").value||0)).toLocaleString();renderFestivalPrepared();});
  $w("festivalStatus").textContent=festivalRecord?.status==="settled"?"頒布精算済み（在庫反映済み）":status==="prepared"?"準備済み：総在庫に準備分を含む":"準備リスト入力中";
  $w("festivalCommitBtn").disabled=status!=="draft";
  $w("festivalReturnBtn").disabled=status!=="prepared";
  $w("festivalSettleBtn").disabled=status!=="prepared";
  $w("festivalSaveBtn").disabled=status==="settled";
  applyWorkTableView("festival");
}
async function loadFestival() {
  const key=festivalKey();if(!/^\d{4}-\d{2}$/.test(key))return showToast("対象月を選択してください");
  try{const doc=await db.collection(FESTIVALS).doc(key).get();if(festivalKey()!==key)return;festivalRecord=doc.exists?doc.data():null;renderFestival();}
  catch(err){console.error(err);showToast("準備リストを開けませんでした");}
}
function collectFestival() {
  const prior=new Map((festivalRecord?.items||[]).map(i=>[i.productId,i]));
  return [...$w("festivalRows").querySelectorAll("tr")].map(row=>{
    const id=row.dataset.id,p=allProducts.find(x=>x.id===id),old=prior.get(id),read=cls=>row.querySelector(`.${cls}`).value;
    const qty=festivalRecord?.status==="prepared"?Number(old?.qty||0):Number(read("qty"));
    const item={productId:id,name:p?.name||old?.name||"",code:p?.code||old?.code||"",category:p?.category||old?.category||"",unit:p?.unit||old?.unit||"",qty,price:Number(read("price"))};
    festivalFields.forEach(f=>item[f]=Number(read(f)));
    for(const cls of ["qty",...festivalFields,"price"]){if(!integer(read(cls)))throw Error("数量と単価は0以上の整数で入力してください");}
    const n=festivalNumbers(item);
    if(n.sold<0||n.returned>n.qty+n.extra)throw Error(`${item.name}：戻り・乱丁・見本の数量を確認してください`);
    return item;
  }).filter(i=>i.qty||festivalFields.some(f=>i[f]));
}
async function saveFestival() {
  const month=festivalKey();if(!month||festivalRecord?.status==="settled")return;
  try{
    const items=collectFestival(),ref=db.collection(FESTIVALS).doc(month);
    await db.runTransaction(async tx=>{const doc=await tx.get(ref),status=doc.exists?doc.data().status:"draft";
      if(status==="settled"||status==="prepared"&&festivalRecord?.status!=="prepared")throw Error("準備状態が変わりました。開き直してください");
      tx.set(ref,{month,items,status,stockMode:doc.exists?doc.data().stockMode||"deducted":"included",updatedBy:currentStaffName,updatedAt:stamp()});
    });
    festivalRecord={month,items,status:festivalRecord?.status||"draft",stockMode:festivalRecord?.stockMode||"included"};renderFestival();showToast("月始祭の入力を保存しました");
  }catch(err){console.error(err);showToast(err.message||"保存に失敗しました");}
}
async function changeFestival(prepare) {
  const month=festivalKey();if(!month)return;
  let items;try{items=prepare?collectFestival():festivalRecord?.items;}catch(err){return showToast(err.message);}
  if(!items?.some(i=>i.qty))return showToast("準備数量を入力してください");
  if(items.length>245)return showToast("一度に確定できる商品は245件までです");
  if(!confirm(prepare?`${month}の準備分を確定します。総在庫は減りません。よろしいですか？`:`${month}の準備を取り消します。よろしいですか？`))return;
  const ref=db.collection(FESTIVALS).doc(month),btn=prepare?$w("festivalCommitBtn"):$w("festivalReturnBtn");btn.disabled=true;
  try{
    let mode="included";
    await db.runTransaction(async tx=>{
      const plan=await tx.get(ref),status=plan.exists?plan.data().status:"draft";
      if(prepare&&status!=="draft"||!prepare&&status!=="prepared")throw Error("準備状態が変わりました。開き直してください");
      mode=prepare?"included":plan.data().stockMode||"deducted";
      const actual=prepare?items:plan.data().items;
      const docs=await Promise.all(actual.map(i=>tx.get(db.collection(COLLECTION).doc(i.productId))));
      docs.forEach((doc,n)=>{if(!doc.exists||prepare&&Number(doc.data().currentStock||0)-Number(doc.data().reservedStock||0)<actual[n].qty)throw Error(`準備可能数が不足：${actual[n].name}`);});
      if(prepare)actual.forEach((i,n)=>tx.update(docs[n].ref,{reservedStock:Number(docs[n].data().reservedStock||0)+i.qty}));
      if(!prepare&&mode==="included")actual.forEach((i,n)=>tx.update(docs[n].ref,{reservedStock:Math.max(0,Number(docs[n].data().reservedStock||0)-i.qty)}));
      if(!prepare&&mode==="deducted")actual.forEach((i,n)=>{tx.update(docs[n].ref,{currentStock:Number(docs[n].data().currentStock||0)+i.qty});tx.set(db.collection(MOVEMENTS_COLLECTION).doc(),{productId:i.productId,productName:i.name,unit:i.unit,type:"in",qty:i.qty,note:`月始祭 ${month} 旧準備取消`,staff:currentStaffName,createdAt:stamp()});});
      tx.set(ref,{month,items:actual,status:prepare?"prepared":"draft",stockMode:"included",updatedBy:currentStaffName,updatedAt:stamp()});items=actual;
    });
    festivalRecord={month,items,status:prepare?"prepared":"draft",stockMode:"included"};renderFestival();showToast(prepare?"準備分を総在庫に含めて確定しました":"準備を取り消しました");
  }catch(err){console.error(err);showToast(err.message||"更新に失敗しました");}finally{btn.disabled=false;renderFestival();}
}
async function settleFestival() {
  const month=festivalKey();if(!month||festivalRecord?.status!=="prepared")return;
  let items;try{items=collectFestival();}catch(err){return showToast(err.message);}
  if(items.length>245)return showToast("一度に精算できる商品は245件までです");
  const sold=items.reduce((n,i)=>n+festivalNumbers(i).sold,0);
  if(!confirm(`${month}の売上数 合計${sold}点を精算します。戻り・乱丁・見本を確認しましたか？`))return;
  const ref=db.collection(FESTIVALS).doc(month),btn=$w("festivalSettleBtn");btn.disabled=true;
  try{
    await db.runTransaction(async tx=>{
      const plan=await tx.get(ref);if(!plan.exists||plan.data().status!=="prepared")throw Error("準備状態が変わりました");
      const mode=plan.data().stockMode||"deducted",planned=new Map(plan.data().items.map(i=>[i.productId,i]));
      if(items.length!==planned.size||items.some(i=>!planned.has(i.productId)||i.qty!==Number(planned.get(i.productId).qty||0)))throw Error("準備数量が変わりました。開き直してください");
      const docs=await Promise.all(items.map(i=>tx.get(db.collection(COLLECTION).doc(i.productId))));
      docs.forEach((doc,n)=>{const i=items[n],delta=mode==="included"?-festivalNumbers(i).consumed:i.returnedQty-i.extraQty;
        const remainingReserved=Math.max(0,Number(doc.data()?.reservedStock||0)-(mode==="included"?i.qty:0));
        if(!doc.exists||Number(doc.data().currentStock||0)+delta<remainingReserved)throw Error(`在庫不足または商品削除：${i.name}`);
      });
      items.forEach((i,n)=>{const delta=mode==="included"?-festivalNumbers(i).consumed:i.returnedQty-i.extraQty;
        const update={currentStock:Number(docs[n].data().currentStock||0)+delta};
        if(mode==="included")update.reservedStock=Math.max(0,Number(docs[n].data().reservedStock||0)-i.qty);
        tx.update(docs[n].ref,update);
        if(delta)tx.set(db.collection(MOVEMENTS_COLLECTION).doc(),{productId:i.productId,productName:i.name,unit:i.unit,type:delta>0?"in":"out",qty:Math.abs(delta),note:`月始祭 ${month} 頒布精算（直送は在庫外）`,staff:currentStaffName,createdAt:stamp()});
      });
      tx.set(ref,{month,items,status:"settled",stockMode:mode,settledBy:currentStaffName,settledAt:stamp()});
    });
    festivalRecord={month,items,status:"settled",stockMode:festivalRecord.stockMode};renderFestival();showToast("頒布を精算し在庫に反映しました");
  }catch(err){console.error(err);showToast(err.message||"精算に失敗しました");}finally{btn.disabled=false;renderFestival();}
}
function subscribeDisaster() {
  db.collection(DISASTER_PRODUCTS).orderBy("name").onSnapshot(s=>{disasterProducts=s.docs.map(d=>({id:d.id,...d.data()}));renderDisaster();},err=>{console.error(err);showToast("防災用品を取得できませんでした");});
  db.collection(DISASTER_MOVEMENTS).orderBy("createdAt","desc").limit(200).onSnapshot(s=>{disasterMovements=s.docs.map(d=>({id:d.id,...d.data()}));renderDisaster();},err=>{console.error(err);showToast("防災履歴を取得できませんでした");});
}
function renderDisaster() {
  if (!$w("disasterProduct")) return;
  const selected=$w("disasterProduct").value;
  $w("disasterProduct").innerHTML='<option value="">用品を選択</option>'+disasterProducts.map(p=>`<option value="${safe(p.id)}">${safe(p.name)}</option>`).join("");
  $w("disasterProduct").value=selected;
  $w("disasterProducts").innerHTML=disasterProducts.map(p=>`<tr><td>${safe(p.code)}</td><td>${safe(p.name)}</td><td>${safe(p.currentStock)} ${safe(p.unit)}</td></tr>`).join("");
  $w("disasterHistory").innerHTML=disasterMovements.map(m=>`<tr><td>${safe(dateLabel(m.createdAt))}</td><td>${safe(m.productName)}</td><td>${m.type==="in"?"入庫":"出荷"}</td><td>${safe(m.qty)}</td><td>${safe(m.destination)}</td><td>${m.type==="out" ? m.shippedAt ? `発送済 ${safe(dateLabel(m.shippedAt))}` : `<button class="btn-secondary-inline shipped-btn" data-id="${safe(m.id)}">発送済みにする</button>` : "―"}</td></tr>`).join("");
  labelTableCells($w("disasterProducts"));
  labelTableCells($w("disasterHistory"));
  $w("disasterHistory").querySelectorAll(".shipped-btn").forEach(b=>b.onclick=()=>markDisasterShipped(b.dataset.id));
}
async function addDisasterProduct() {
  const name=$w("disasterName").value.trim(), code=$w("disasterCode").value.trim(), unit=$w("disasterUnit").value.trim()||"個", initial=$w("disasterInitial").value;
  if (!name || !integer(initial)) return showToast("用品名と0以上の初期在庫を入力してください");
  try { await db.collection(DISASTER_PRODUCTS).add({name,code,unit,currentStock:Number(initial),createdAt:stamp()}); $w("disasterName").value=$w("disasterCode").value=""; $w("disasterInitial").value="0"; showToast("防災用品を登録しました"); }
  catch(err) { console.error(err); showToast("登録に失敗しました"); }
}
async function recordDisasterMovement() {
  const id=$w("disasterProduct").value, type=$w("disasterType").value, qty=Number($w("disasterQty").value), destination=$w("disasterDestination").value.trim();
  if (!id || !Number.isInteger(qty) || qty<1) return showToast("用品と1以上の数量を指定してください");
  if (type==="out" && !destination) return showToast("出荷先を入力してください");
  const ref=db.collection(DISASTER_PRODUCTS).doc(id), move=db.collection(DISASTER_MOVEMENTS).doc();
  try { await db.runTransaction(async tx=>{ const doc=await tx.get(ref); if (!doc.exists) throw Error("用品が見つかりません"); const n=Number(doc.data().currentStock||0)+(type==="in"?qty:-qty); if(n<0) throw Error("在庫が不足しています"); tx.update(ref,{currentStock:n}); tx.set(move,{productId:id,productName:doc.data().name,type,qty,destination,staff:currentStaffName,createdAt:stamp(),shipmentStatus:type==="out"?"pending":null}); });
    $w("disasterQty").value="1"; $w("disasterDestination").value=""; showToast("入出荷を記録しました");
  } catch(err) { console.error(err); showToast(err.message||"記録に失敗しました"); }
}
async function markDisasterShipped(id) {
  if (!confirm("この出荷を発送済みにしますか？")) return;
  const ref=db.collection(DISASTER_MOVEMENTS).doc(id);
  try { await db.runTransaction(async tx=>{ const doc=await tx.get(ref); if(!doc.exists||doc.data().type!=="out"||doc.data().shippedAt) throw Error("既に処理されています"); tx.update(ref,{shipmentStatus:"shipped",shippedAt:stamp(),shippedBy:currentStaffName}); }); showToast("発送済みを記録しました"); }
  catch(err) { console.error(err); showToast(err.message||"更新に失敗しました"); }
}

window.KOBUNSHA_APP_VERSION = "2026-10-06-qr-product-name-v14";
init();
