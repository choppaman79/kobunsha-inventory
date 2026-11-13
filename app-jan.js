// ===================== 設定 =====================
const MEMBERS = ["仙波","山崎","田中","落合","川野","迫","佐藤","二神","森重","小鷹","山根","熊澤"];
const CATEGORIES = ["神具","仏具","神向き用品","チェーン","防災用品","清掃用品","その他"];
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
let pendingSlipScanCode = null; // 商品QRと伝票別の検品QRを照合
let inspectedLabelTokens = new Set();
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
  initPilotTools();
  initOpeningStockTools();
  initS1ShippingImport();
  initInvoicePdfImport();
  initProductLabelSizes();
  initLabelPrinterGuide();
  initBarcodeTransferTools();

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
  document.getElementById("posCsvBtn").addEventListener("click", exportPosProducts);
  document.getElementById("qrBulkCloseBtn").addEventListener("click", () => {
    document.getElementById("qrBulkOverlay").classList.remove("show");
  });
  document.getElementById("qrBulkPrintOkBtn").addEventListener("click", () => {
    document.body.classList.add("label-print");
    document.body.classList.remove("slip-print", "work-print", "order-print", "prepared-print");
    applyLabelPaperSize();
    setTimeout(() => window.print(), 150);
  });
  document.getElementById("qrBulkOverlay").addEventListener("click", (e) => {
    if (e.target.id === "qrBulkOverlay") document.getElementById("qrBulkOverlay").classList.remove("show");
  });

  // ---- Phase2: エクセル一括登録 ----
  document.getElementById("excelFileInput").addEventListener("change", handleExcelFile);
  document.getElementById("excelImportBtn").addEventListener("click", handleExcelImport);

  // ---- Phase2: 伝票（出荷/入荷）----
  document.getElementById("slipCreateOutBtn").addEventListener("click", () => openManualShippingForm());
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
    refreshInvoiceProductNames();
    renderDisaster();
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
  const categories = [...new Set([...CATEGORIES, ...allProducts.map(p => categoryLabel(p.category)).filter(Boolean)])];
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
    const matchCat = activeCategory === "すべて" || categoryLabel(p.category) === activeCategory;
    const matchKeyword = !keyword || [p.name, p.code, p.supplier, p.barcode, ...(p.barcodeAliases || [])].some(value => String(value || "").toLowerCase().includes(keyword));
    return matchCat && matchKeyword;
  });

  listEl.innerHTML = "";
  emptyEl.style.display = items.length === 0 ? "block" : "none";
  document.getElementById("productListCount").textContent = `表示：${items.length}商品`;
  if (items.length) {
    const table = document.createElement("table");
    table.className = "inventory-grid";
    table.innerHTML = `<caption class="visually-hidden">商品在庫一覧</caption><thead><tr>
      ${bulkMode ? '<th scope="col" class="inventory-select">選択</th>' : ''}
      <th scope="col" class="inventory-code">商品コード</th>
      <th scope="col" class="inventory-name">商品名</th>
      <th scope="col" class="inventory-stock">現在庫数</th>
      <th scope="col" class="inventory-unit">単位</th>
      <th scope="col" class="inventory-price">単価</th>
      <th scope="col" class="inventory-action">操作</th>
    </tr></thead>`;
    const tbody = document.createElement("tbody");
    items.forEach(p => {
      const isLow = Number(p.currentStock ?? 0) <= Number(p.minStock ?? 0);
      const id = escapeHtml(p.id);
      const row = document.createElement("tr");
      row.className = isLow ? "inventory-low" : "";
      row.innerHTML = `
        ${bulkMode ? `<td class="inventory-select"><input type="checkbox" class="bulk-check" data-id="${id}" ${bulkSelected.has(p.id) ? "checked" : ""} aria-label="${escapeHtml(p.name || '')}を選択"></td>` : ''}
        <td class="inventory-code">${escapeHtml(p.code || "―")}</td>
        <td class="inventory-name"><span class="inventory-product-name">${escapeHtml(p.name || "商品名未登録")}</span>
          <details class="inventory-details"><summary>詳細</summary><dl>
            <dt>バーコード</dt><dd>${escapeHtml(p.barcode || "未登録")}</dd>
            <dt>仕入れ先</dt><dd>${escapeHtml(p.supplier || "―")}</dd>
            <dt>ロット</dt><dd>${escapeHtml(p.lot || "―")}</dd>
            <dt>分類</dt><dd>${escapeHtml(categoryLabel(p.category) || "未分類")}</dd>
            <dt>備考</dt><dd>${escapeHtml(p.note || "―")}</dd>
            <dt>僅少ライン</dt><dd>${Number(p.minStock || 0).toLocaleString("ja-JP")}${escapeHtml(p.unit || "")}</dd>
          </dl></details>
        </td>
        <td class="inventory-stock"><strong>${Number(p.currentStock ?? 0).toLocaleString("ja-JP")}</strong>${isLow ? '<span class="inventory-low-label">在庫僅少</span>' : ''}</td>
        <td class="inventory-unit">${escapeHtml(p.unit || "―")}</td>
        <td class="inventory-price">¥${Number(p.price || 0).toLocaleString("ja-JP")}</td>
        <td class="inventory-action"><div class="inventory-buttons">
          <button type="button" class="btn-move" data-action="move" data-id="${id}">入出庫</button>
          <button type="button" class="btn-qr" data-id="${id}">JAN</button>
          <button type="button" class="inventory-edit edit-link" data-id="${id}">編集</button>
        </div></td>`;
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    listEl.appendChild(table);
  }

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
  if (!inventoryWritesAllowed()) return;
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

  db.runTransaction(async tx => {
    await requireNoActiveReset(tx);
    return tx.get(productRef).then(doc => {
      if (!doc.exists) throw new Error("商品が見つかりません");
      const latestStock = Number(doc.data().currentStock || 0);
      const latestNewStock = type === "in" ? latestStock + qty : latestStock - qty;
      if (latestNewStock < Number(doc.data().reservedStock||0)) throw new Error("在庫不足");
      tx.update(productRef, { currentStock: latestNewStock });
      tx.set(movementRef, {
        productId: movingProductId,
        productName: product.name || "",
        category: categoryLabel(product.category) || "",
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
function buildInspectionUrl(slipId, productId, itemIndex, unitIndex) {
  return `${location.origin}${location.pathname}#inspection=${encodeURIComponent(slipId)}&product=${encodeURIComponent(productId)}&item=${itemIndex}&unit=${unitIndex}`;
}
function buildSlipUrl(id) {
  return `${location.origin}${location.pathname}#slip=${encodeURIComponent(id)}`;
}

function handlePendingHash() {
  if (pendingHashHandled) return;
  const hash = location.hash;
  if (!hash) return;
  const inspection = extractScannedId(hash);
  if (inspection.type === "inspection") {
    const slip = allSlips.find(x => x.id === inspection.slipId);
    if (slip) {
      pendingHashHandled = true;
      history.replaceState(null, "", location.pathname);
      switchTab("slips");
      openSlipDetailModal(slip.id);
      showToast("検品用QRです。商品QRと組み合わせて検品してください");
    }
    return;
  }
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
async function openQrModal(id) {
  qrProductId = id;
  try {
    const p = await ensureProductBarcode(id);
    if (qrProductId !== id) return;
    document.getElementById("qrProductName").textContent = p.name || "";
    document.getElementById("qrProductCode").textContent = p.barcode + "　売価 ¥" + Number(p.price || 0).toLocaleString("ja-JP");
    const box = document.getElementById("qrCanvasBox");
    box.replaceChildren(makeEanSvg(p.barcode));
    document.getElementById("qrOverlay").classList.add("show");
  } catch (err) { barcodeError(err); }
}

function closeQrModal() {
  qrProductId = null;
  document.getElementById("qrOverlay").classList.remove("show");
}

// QL-800: DK-1221 (23×23mm) と DK-1209 (62×29mm) に1枚ずつ印刷する。
function showBrotherLabelPreview(kind, title, count) {
  const area = document.getElementById("qrBulkPrintArea");
  area.classList.remove("brother-qr-mode", "brother-pick-mode", "brother-product-mode", "brother-product-small-mode");
  document.getElementById("productLabelSizeTools").hidden = true;
  area.classList.add(kind === "pick" ? "brother-pick-mode" : "brother-qr-mode");
  document.getElementById("qrBulkTitle").textContent = title;
  document.getElementById("qrBulkHint").textContent = `${count}枚／Brother QL-800・${kind === "pick" ? "DK-1209（62×29mm）" : "DK-1221（23×23mm）"}。PCでQL-800を選び、用紙サイズを合わせて倍率100%・ヘッダー／フッターなしで印刷してください。QRシールは四辺に2mmの余裕を確保しています。`;
  document.getElementById("qrBulkPrintOkBtn").disabled = false;
  document.getElementById("qrBulkOverlay").classList.add("show");
  updateLabelPrinterGuide();
}

function finishBrotherLabels(grid, kind, title, count) {
  const last = grid.querySelector(kind === "pick" ? ".brother-pick-label:last-child" : ".brother-qr-label:last-child");
  if (!last) return showToast("印刷対象のラベルがありません");
  last.classList.add("last-label");
  showBrotherLabelPreview(kind, title, count);
}

function printProductQrLabel(id) {
  if (!allProducts.some(p => p.id === id)) return;
  return renderProductLabels([{ id, qty: 1 }]);
}

function openQrBulkPrint() {
  const keyword = document.getElementById("searchBox").value.trim().normalize("NFKC").toLowerCase();
  const items = allProducts.filter(p =>
    (activeCategory === "すべて" || categoryLabel(p.category) === activeCategory) &&
    (!keyword || `${p.name || ""} ${p.code || ""} ${p.barcode || ""}`.normalize("NFKC").toLowerCase().includes(keyword))
  );
  if (!items.length) return showToast("印刷対象の商品がありません");
  return renderProductLabels(items.map(p => ({ id: p.id, qty: 1 })));
}


function printSlipReceivingLabels(slipId) {
  const slip = allSlips.find(x => x.id === slipId);
  if (!slip || slip.type !== "in") return showToast("入荷伝票を開いてください");
  try {
    const requests = (slip.items || []).map((item, index) => {
      const input = slip.status !== "done" && openSlipId === slipId
        ? document.querySelector(`.slip-check-qty[data-idx="${index}"]`) : null;
      const value = slip.status === "done" ? item.checkedQty : input ? input.value : item.checkedQty ?? item.plannedQty;
      return { id: item.productId, name: item.productName, qty: inventoryQuantity(value, (item.productName || "商品") + "の入荷数") };
    }).filter(item => item.qty > 0);
    if (!requests.length) return showToast("印刷する入荷シールはありません");
    return renderProductLabels(requests);
  } catch (err) { barcodeError(err); }
}
// 検品用は商品用EAN-13とは別の伝票・商品・連番付きQRを維持する。

function printSlipPickLabels(slipId) {
  if(allSlips.find(x=>x.id===slipId)?.type==="out")return printOutgoingInspectionLabels(slipId).catch(e=>showToast(e.message||"検品シールを作成できませんでした"));
  const s = allSlips.find(x => x.id === slipId);
  if (!s) return;
  const grid = document.getElementById("qrBulkGrid");
  grid.className = "brother-label-list";
  grid.replaceChildren();
  const issueDate = s.createdAt?.toDate ? formatDateOnly(s.createdAt.toDate()) : "";
  const shipTo = s.shipTo || s.partner || "";
  let total = 0;
  (s.items || []).forEach((item, itemIndex) => {
    const qty = Number(item.plannedQty);
    if (!item.productId || !Number.isInteger(qty) || qty <= 0) return;
    const price = Number(item.unitPrice || 0);
    for (let i = 1; i <= qty; i++) {
      const cell = document.createElement("div");
      cell.className = "brother-pick-label";
      cell.innerHTML = `<div class="brother-pick-qr"></div><div class="brother-pick-info">
        <div class="brother-pick-name">${escapeHtml(item.productName || "")}</div>
        <div>伝票 ${escapeHtml((s.slipNumber || "") + (s.destinationCode ? " ／ 出荷先コード " + s.destinationCode : ""))}${qty > 1 ? `　${i}/${qty}` : ""}</div>
        <div class="brother-pick-price">¥${price.toLocaleString()}</div>
        <div class="brother-pick-meta">${escapeHtml(shipTo)}${issueDate ? ` / ${escapeHtml(issueDate)}` : ""}</div>
      </div>`;
      grid.appendChild(cell);
      new QRCode(cell.querySelector(".brother-pick-qr"), { text: buildInspectionUrl(s.id, item.productId, itemIndex, i), width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
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
      if(workbook.Sheets["出荷指示依頼書"])throw Error("このExcelは「伝票・検品」の出荷依頼書取込から選択してください。商品登録には使用できません");
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false });
      if (rows.some(row => Object.keys(row).some(key => normalizeHeader(key) === normalizeHeader("開始在庫数")))) {
        showToast("開始在庫のファイルは、画面上部の「開始在庫の一括入力（Excel）」から読み込んでください");
        return;
      }
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
  if (!inventoryWritesAllowed()) return;
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
        category: categoryLabel(r.category) || CATEGORIES[0],
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
    renderManualCodeLists();
    [...slipSelected].forEach(id => { if (!allSlips.some(s => s.id === id)) slipSelected.delete(id); });
    if (document.getElementById("tabSlips").style.display !== "none") {
      renderSlipList(getActiveSlipFilter());
    }
    if(openSlipId)syncInspectionCounts();
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
          <span class="slip-number">${escapeHtml((s.slipNumber || "") + (s.destinationCode ? " ／ 出荷先コード " + s.destinationCode : ""))}</span>
          <span class="slip-status ${s.status === "done" ? "done" : ""}">${statusLabel}</span>
        </div>
        <div class="history-meta">${escapeHtml(s.partner || "取扱先未設定")}　/　${dt}　/　品目数：${(s.items || []).length}</div>
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
  document.getElementById("slipPartnerLabel").textContent = type === "in" ? "仕入先（任意）" : "取扱先（任意）";
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
  for(const id of ["slipSourceNumber","slipHandlingCode","slipTransactionName"])document.getElementById(id).value="";
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
  prepareDestinationForm(type);
  document.getElementById("slipCreateOverlay").classList.add("show");
  setTimeout(() => document.getElementById("slipItemCodeInput").focus(), 50);
}

function closeSlipCreateModal() {
  clearTimeout(destinationLookupTimer);destinationLookupGeneration++;
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

async function handleSlipCreateSave() {
  if (!inventoryWritesAllowed()) return;
  if (!currentSlipItems.length) return showToast("商品を追加してください");
  const type = document.getElementById("slipCreateType").value;
  if (!["in","out"].includes(type)) return showToast("伝票区分を確認してください");
  clearTimeout(destinationLookupTimer); destinationLookupGeneration++;
  const fields = destinationForm();
  let code = "";
  try {
    if (type === "out") code = normalizeDestinationCode(document.getElementById("slipDestinationCode").value);
    const items = currentSlipItems.map(item => {
      const qty = inventoryQuantity(item.plannedQty,"数量");
      if(qty < 1) throw Error("数量は1以上で入力してください");
      return { ...item };
    });
    const btn = document.getElementById("slipCreateSaveBtn");
    if (btn.disabled) return;
    btn.disabled = true;
    const slip = {
      type, slipNumber:generateSlipNumber(type), ...fields,
      postingDate:document.getElementById("slipPostingDate").value,
      transactionType:document.getElementById("slipTransactionType").value.trim(),
      transactionTypeName:document.getElementById("slipTransactionName").value.trim(),
      sourceSlipNumber:document.getElementById("slipSourceNumber").value.trim(),
      handlingCode:document.getElementById("slipHandlingCode").value.trim(),
      customerOrderNo:document.getElementById("slipOrderNo").value.trim(),
      warehouse:document.getElementById("slipWarehouse").value.trim(),
      orderNo:document.getElementById("slipOrderNo").value.trim(),
      memo:document.getElementById("slipMemo").value.trim(),
      status:"draft", items, staff:currentStaffName,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
      await savePilotSlip(type,code,fields,slip,document.getElementById("saveDestinationMaster").checked,
        matchedDestinationCode === code ? matchedDestinationRevision : null);
      showToast("伝票を作成しました");closeSlipCreateModal();
    } catch(err) {console.error(err);showToast(err.message || "保存できませんでした。追加ルールと通信状態を確認してください");}
    finally {btn.disabled=false;}
  } catch(err) {showToast(err.message);}
}

// ---- 伝票の詳細・検品・印刷 ----
function openSlipDetailModal(id) {
  const s = allSlips.find(x => x.id === id);
  if (!s) return;
  openSlipId = id;
  pendingSlipScanCode = null;
  inspectedLabelTokens.clear();
  const typeLabel = s.type === "in" ? "入荷伝票" : "出荷伝票";
  document.getElementById("slipDetailTitle").textContent = typeLabel;
  document.getElementById("slipDetailNumber").textContent = (s.sourceSlipNumber || s.slipNumber || "") + (s.destinationCode ? " ／ 出荷先コード " + s.destinationCode : "");
  document.getElementById("slipDetailPartner").textContent = invoiceHandlingText(s) || "取扱先未設定";
  document.getElementById("slipDetailPartnerAddress").textContent = s.partnerAddress || "";
  document.getElementById("slipDetailPartnerTel").textContent = s.partnerTel || "";
  document.getElementById("slipDetailShipToLabel").textContent = s.type === "in" ? "入荷元" : "出荷先";
  document.getElementById("slipDetailShipTo").textContent = s.shipTo || s.partner || "";
  document.getElementById("slipDetailIssueDate").textContent = s.createdAt && s.createdAt.toDate ? formatDateOnly(s.createdAt.toDate()) : "";
  document.getElementById("slipDetailDeliveryDate").textContent = s.deliveryDate || "指定なし";
  document.getElementById("slipDetailDeliveryTime").textContent = s.deliveryTime || "指定なし";
  document.getElementById("slipDetailPostingDate").textContent = formatPostingDate(s.postingDate);
  document.getElementById("slipDetailTransactionType").textContent = invoiceTradeText(s);
  document.getElementById("slipDetailWarehouse").textContent = s.warehouse || "";
  document.getElementById("slipDetailOrderNo").textContent = invoiceOrderNumber(s);
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
  document.getElementById("slipPickLabelWrap").style.display = "flex";

  document.getElementById("slipDetailOverlay").classList.add("show");
  document.getElementById("slipBluetoothModeBtn").disabled = isDone;
  document.getElementById("slipScanFocusBtn").disabled = isDone;
  setSlipScannerMode(!isDone);
  document.getElementById("slipDetailPrintCheckBtn").textContent=s.type==="out"?"📋 出荷指示書・検品JAN":"🔍 検品表";
  document.getElementById("slipDetailScanBtn").disabled=s.type==="out" || isDone;
  document.getElementById("slipItemScannerInput").placeholder=s.type==="out"?"現品の商品JAN → 指示書の検品JAN":"現品QR → 検品シールQR";
  if(s.type==="out")syncInspectionCounts();
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
    ? (allSlips.find(s=>s.id===openSlipId)?.type==="out" ? "出荷指示書を発行後、現品の商品JAN → 指示書の検品JANを読み取ってください（2回で1個確認・自動保存）。" : "スキャナーで現品QR、検品シールQRの順に読み取ってください（同じ商品で1件確認）。")
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
  if(mode==="check" && allSlips.find(x=>x.id===openSlipId)?.type==="out" && (allSlips.find(x=>x.id===openSlipId)?.status==="draft" || allSlips.find(x=>x.id===openSlipId)?.inspectionVersion===1)) {
    return printOutgoingInspectionSheet(openSlipId).catch(e=>showToast(e.message||"出荷指示書を作成できませんでした"));
  }
  const s = allSlips.find(x => x.id === openSlipId);
  if (!s) return;
  clearInspectionPaperSize();
  const sheet = document.getElementById("slipPrintSheet");
  delete sheet.dataset.inspection;
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
  const typeLabel=s.type==='in'?'入荷':'出荷',shipToLabel=s.type==='in'?'入荷元':'出荷先';
  const issueDate=s.createdAt&&s.createdAt.toDate?formatDateOnly(s.createdAt.toDate()):'';
  const number=s.sourceSlipNumber||s.slipNumber||'';
  const rows=(s.items||[]).map(item=>`<tr><td>${escapeHtml(item.code||'')}</td><td>${escapeHtml(item.productName)}</td><td>¥${Number(item.unitPrice||0).toLocaleString()}</td><td>${item.plannedQty}${escapeHtml(item.unit||'')}</td><td><span class="fill-blank"></span></td></tr>`).join('');
  return `<div class="slip-formal-header"><h2 style="margin:0;">検品表（${typeLabel}）</h2><div class="slip-formal-header-qr"><div id="printSheetQr"></div><span class="slip-formal-header-qr-label">${escapeHtml(number)}</span></div>${companyLetterheadHtml()}</div>
    <table class="slip-formal-table invoice-instruction-meta">
      <tr><th>${shipToLabel}</th><td colspan="3">${escapeHtml(invoiceShipText(s))}</td><th>計上日</th><td>${escapeHtml(s.postingDate||issueDate)}</td></tr>
      <tr><th>${s.type==='in'?'仕入先':'取扱先'}</th><td colspan="3">${escapeHtml(invoiceHandlingText(s))}</td><th>伝票番号</th><td>${escapeHtml(number)}</td></tr>
      <tr><th>取引区分</th><td>${escapeHtml(invoiceTradeText(s))}</td><th>倉庫</th><td>${escapeHtml(s.warehouse||'')}</td><th>受注番号</th><td>${escapeHtml(invoiceOrderNumber(s))}</td></tr>
      <tr><th>管理番号</th><td colspan="5">${escapeHtml(number)}</td></tr>
      ${s.sourceImport?.format==='S1-v1'?`<tr><th>依頼番号</th><td colspan="5">${escapeHtml(s.sourceImport.reference||'')}</td></tr>`:''}
    </table>
    <p class="instruction-delivery">配達指定日：${escapeHtml(s.deliveryDate||'指定なし')}　／　指定時間：${escapeHtml(s.deliveryTime||'指定なし')}</p>
    <table class="slip-detail-table"><thead><tr><th>商品コード</th><th>商品名</th><th>単価</th><th>数量（予定）</th><th>照合チェック</th></tr></thead><tbody>${rows}</tbody></table>`;
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
        <span class="slip-formal-header-qr-label">${escapeHtml((s.sourceSlipNumber || s.slipNumber || "") + (s.destinationCode ? " ／ 出荷先コード " + s.destinationCode : ""))}</span>
      </div>
      ${companyLetterheadHtml()}
    </div>
    <table class="slip-formal-table">
      <tr><th>配達指定日</th><td>${escapeHtml(s.deliveryDate || "指定なし")}</td><th>指定時間</th><td>${escapeHtml(s.deliveryTime || "指定なし")}</td></tr>
      <tr>
        <th>発行日</th><td>${issueDate}</td>
        <th>計上日</th><td>${formatPostingDate(s.postingDate)}</td>
      </tr>
      <tr>
        <th>伝票番号</th><td>${escapeHtml((s.sourceSlipNumber || s.slipNumber || "") + (s.destinationCode ? " ／ 出荷先コード " + s.destinationCode : ""))}</td>
        <th>${shipToLabel}</th><td>${escapeHtml(s.shipTo || s.partner || "")}</td>
      </tr>
      <tr>
        <th>取扱先</th>
        <td colspan="3">
          名称：${escapeHtml(invoiceHandlingText(s))}　
          住所：${escapeHtml(s.partnerAddress || "")}　
          TEL：${escapeHtml(s.partnerTel || "")}
        </td>
      </tr>
      <tr>
        <th>取引区分</th><td>${escapeHtml(invoiceTradeText(s))}</td>
        <th>倉庫</th><td>${escapeHtml(s.warehouse || "")}</td>
      </tr>
      <tr>
        <th>受注№</th><td colspan="3">${escapeHtml(invoiceOrderNumber(s))}</td>
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
  if (!inventoryWritesAllowed()) return;
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
    await requireNoActiveReset(tx);
    const doc = await tx.get(ref);
    if (!doc.exists || !allowed.includes(doc.data().status)) {
      throw Error("発注の状態が変わりました。開き直してください");
    }
    tx.update(ref, changes);
  });
}

function handleOrderMarkOrdered() {
  if (!inventoryWritesAllowed()) return;
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
  if (!inventoryWritesAllowed()) return;
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
    await requireNoActiveReset(tx);
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
    if(!isOrder && record.type==="out")assertInspectionComplete(record,enteredItems);
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
  if (!inventoryWritesAllowed()) return;
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
  const issued=findInspectionCode(String(text).trim());
  if(issued)return {type:"inspection",id:issued.unit.productId,slipId:issued.slip.id,itemIndex:issued.unit.itemIndex,unitIndex:issued.unit.unitIndex,jan:true};
  const mark = text.indexOf("#inspection=");
  if (mark !== -1) {
    const params = new URLSearchParams(text.slice(mark + 1));
    return { type: "inspection", id: params.get("product") || "", slipId: params.get("inspection") || "", itemIndex: Number(params.get("item") ?? NaN), unitIndex: Number(params.get("unit") ?? NaN) };
  }
  const pm = text.match(/#product=([^&]+)/);
  if (pm) return { type: "product", id: decodeURIComponent(pm[1]) };
  const sm = text.match(/#slip=([^&]+)/);
  if (sm) return { type: "slip", id: decodeURIComponent(sm[1]) };
  return { type: "unknown", id: text.trim() };
}

function handleScanResult(text) {
  const parsed = extractScannedId(text);

  if (scanMode === "slip-item") {
    handleSlipItemVerifyScan(text);
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
    const productId = resolveScannedProductId(text);
    if (productId) { type = "product"; id = productId; }
    else if (allSlips.find(s => s.id === id)) type = "slip";
  }

  if (type === "inspection") {
    const slip = allSlips.find(x => x.id === parsed.slipId);
    stopScanCamera();
    closeScanModal();
    if (slip) { switchTab("slips"); openSlipDetailModal(slip.id); }
    else showToast("検品QRの伝票が見つかりません");
  } else if (type === "product") {
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
// 検品シール方式：現品のQRと検品シールのQRを順にスキャンし、異なる種類のQRが同じ商品を指していれば1件確認とする
function setSlipScanStatus(message, warning) {
  const status = document.getElementById("slipScanStatus");
  if (status) {
    status.textContent = message;
    status.className = warning ? "scan-warning" : "scan-ready";
  }
}

function handleLegacySlipItemVerifyScan(text) {
  const slip = allSlips.find(s => s.id === openSlipId);
  if (!slip || slip.status === "done") return showToast("伝票を開くか、完了状態を確認してください");
  const parsed = extractScannedId(text);
  const productId = resolveScannedProductId(text);
  const role = parsed.type === "inspection" ? "inspection" : "product";
  const index = role === "inspection" ? parsed.itemIndex : (slip.items || []).findIndex(i => i.productId === productId);
  const item = slip.items?.[index];
  const fail = message => {
    playWarningAlert();
    showToast(message);
    setSlipScanStatus(message, true);
    const status = document.getElementById("scanStepStatus");
    if (status) { status.textContent = message; status.style.color = "var(--warn-text, #a3392b)"; }
  };
  if (!item || item.productId !== productId ||
      (role === "inspection" && (parsed.slipId !== openSlipId ||
        !Number.isSafeInteger(index) || index < 0 ||
        !Number.isSafeInteger(parsed.unitIndex) || parsed.unitIndex < 1 ||
        parsed.unitIndex > Number(item.plannedQty)))) {
    pendingSlipScanCode = null;
    return fail("⚠️ この伝票の商品・検品QRではありません");
  }
  const token = role === "inspection" ? `${parsed.slipId}:${index}:${parsed.unitIndex}` : null;
  if (token && inspectedLabelTokens.has(token)) {
    pendingSlipScanCode = null;
    return fail("⚠️ この検品シールは既に読み取り済みです");
  }
  const scan = { role, productId, index, token };
  if (!pendingSlipScanCode) {
    pendingSlipScanCode = scan;
    playTone(660, 60, "sine");
    const message = role === "product" ? "① 商品QRを確認 → ② 検品用シールのQRを読んでください" : "① 検品用QRを確認 → ② 商品に貼ったQRを読んでください";
    showToast(message);
    setSlipScanStatus(message, false);
    const status = document.getElementById("scanStepStatus");
    if (status) { status.textContent = message; status.style.color = "var(--indigo-deep)"; }
    return;
  }
  const first = pendingSlipScanCode;
  if (first.role === role) return fail("⚠️ 同じ種類のQRです。商品QRと検品用QRを1回ずつ読んでください");
  pendingSlipScanCode = null;
  if (first.productId !== productId) return fail("⚠️ 商品QRと検品用QRの商品が一致しません");
  const inspection = role === "inspection" ? scan : first;
  if (handleSlipItemScan(productId, inspection.index)) {
    inspectedLabelTokens.add(inspection.token);
    const message = `✅ ${item.productName || "商品"} を確認しました。次の現品を読み取ってください。`;
    setSlipScanStatus(message, false);
    const status = document.getElementById("scanStepStatus");
    if (status) { status.textContent = message; status.style.color = "var(--ok-text, #0f6e56)"; }
  }
}

function resolveScannedProductId(text) {
  const parsed = extractScannedId(text);
  if (parsed.type === "slip") return null;
  if (parsed.type === "inspection") return parsed.id || null;
  const numbered = allProducts.filter(p => p.barcode === parsed.id || (p.barcodeAliases || []).includes(parsed.id));
  if (numbered.length) return numbered.length === 1 ? numbered[0].id : null;
  const byId = allProducts.find(p => p.id === parsed.id);
  if (byId) return byId.id;
  const code = parsed.id.normalize("NFKC").toLowerCase();
  const matches = allProducts.filter(p => String(p.code || "").trim().normalize("NFKC").toLowerCase() === code);
  return matches.length === 1 ? matches[0].id : null;
}

function handleSlipItemScan(productId, itemIndex = null) {
  const s = allSlips.find(x => x.id === openSlipId);
  if (!s || s.status === "done") { showToast("伝票が開かれていないか、検品完了済みです"); return false; }
  const idx = itemIndex === null ? (s.items || []).findIndex(it => it.productId === productId) : itemIndex;

  if (!s.items?.[idx] || s.items[idx].productId !== productId) {
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
    handleSlipItemVerifyScan(text);
    inputEl.focus();
    return;
  }

  let { type, id } = parsed;
  if (type === "unknown") {
    const productId = resolveScannedProductId(text);
    if (productId) { type = "product"; id = productId; }
    else if (allSlips.find(s => s.id === id)) type = "slip";
  }

  if (type === "inspection") {
    const slip = allSlips.find(x => x.id === parsed.slipId);
    if (slip) { switchTab("slips"); openSlipDetailModal(slip.id); }
    else showToast("検品QRの伝票が見つかりません");
  } else if (type === "product") {
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
  if (!inventoryWritesAllowed()) return;
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
  if(s.type==="out") {
    try{assertInspectionComplete(s,items);}catch(e){showToast(e.message);return;}
  }
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
  if (!inventoryWritesAllowed()) return;
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
  if (barcodeEditSaveBusy) return showToast("保存中です。完了をお待ちください");
  clearBarcodeEditStatus();
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById("editName").value = p.name || "";
  document.getElementById("editCode").value = p.code || "";
  document.getElementById("editBarcode").value = p.barcode || "";
  document.getElementById("editSupplier").value = p.supplier || "";
  document.getElementById("editLot").value = p.lot || "";
  document.getElementById("editCategory").value = categoryLabel(p.category) || CATEGORIES[0];
  document.getElementById("editUnit").value = p.unit || "";
  document.getElementById("editPrice").value = p.price ?? "";
  document.getElementById("editStock").value = p.currentStock ?? 0;
  document.getElementById("editMinStock").value = p.minStock ?? 0;
  document.getElementById("editNote").value = p.note || "";
  document.getElementById("editOverlay").classList.add("show");
}

function closeEditModal() {
  clearBarcodeEditStatus();
  editingId = null;
  document.getElementById("editOverlay").classList.remove("show");
}

function handleEditSave() {
  if (barcodeEditSaveBusy) return;
  if (!inventoryWritesAllowed()) return;
  if (!editingId) return;
  const targetId = editingId;
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
  if (!data.name || !Number.isFinite(data.price) || data.price < 0) return showToast("商品名と売価を確認してください");
  const requested = document.getElementById("editBarcode").value.trim();
  const formState = barcodeEditFormState();
  clearBarcodeEditStatus();setBarcodeEditBusy(true);
  ensureProductBarcode(targetId, requested, data)
    .then(() => { renderProductList();showToast("保存しました"); if (editingId === targetId) closeEditModal(); })
    .catch(error => showBarcodeEditFailure(error,targetId,requested,data,formState))
    .finally(() => setBarcodeEditBusy(false));
}

function handleEditDelete() {
  if (!inventoryWritesAllowed()) return;
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
  initDisasterOps();
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
  if (!inventoryWritesAllowed()) return;
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
  if (!inventoryWritesAllowed()) return;
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
    return `<tr data-id="${safe(i.productId)}" data-category="${safe(categoryLabel(i.category)||"未分類")}" data-name="${safe(i.name)}" data-code="${safe(i.code)}" data-stock="${book}"><td>${safe(i.code)}</td><td>${safe(i.name)}</td><td>${safe(categoryLabel(i.category))}</td><td>${prepared}</td><td>${book-prepared}</td><td>${book}</td><td><input class="staged-actual" type="number" min="0" step="1" value="${i.stagedActual??""}" ${applied||applying?"disabled":""}></td><td><input class="warehouse-actual" type="number" min="0" step="1" value="${i.warehouseActual??""}" ${applied||applying?"disabled":""}></td><td class="actual-total">${actual??"―"}</td><td class="difference">${actual===null?"―":actual-book}</td><td><input class="note" type="text" value="${safe(i.note)}" ${applied||applying?"disabled":""}></td></tr>`;
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
  if (!inventoryWritesAllowed()) return;
  if(!stocktakeKey()||stocktakeRecord?.status==="applied") return;
  try {
    const items=collectStocktake();
    await db.collection(STOCKTAKES).doc(stocktakeKey()).set({date:stocktakeKey(),festivalMonth:nextFestivalMonth(stocktakeKey()),items,status:"draft",updatedBy:currentStaffName,updatedAt:stamp()});
    stocktakeRecord={items,status:"draft"};renderStocktake();showToast("棚卸し表を保存しました");
  } catch(err) {console.error(err);showToast(err.message||"保存に失敗しました");}
}
async function applyStocktake() {
  if (!inventoryWritesAllowed()) return;
  const key=stocktakeKey();if(!key||stocktakeRecord?.status==="applied")return;
  const resuming=stocktakeRecord?.status==="applying";
  let items;
  try{items=resuming?stocktakeRecord.items:collectStocktake();}catch(err){return showToast(err.message);}
  if(!items.length||items.some(i=>i.warehouseActual===null||i.stagedActual===null))return showToast("倉庫と準備分の実数をすべて入力してください");
  if(!confirm(resuming?"途中から棚卸し反映を再開しますか？":`${items.length}件の棚卸しを在庫に反映します。確定後は編集できません。よろしいですか？`))return;
  const ref=db.collection(STOCKTAKES).doc(key),btn=$w("stocktakeApplyBtn");btn.disabled=true;
  try {
    if(!resuming){
      await db.runTransaction(async tx => {
    await requireNoActiveReset(tx);
        const prior=await tx.get(ref);if(prior.exists&&["applying","applied"].includes(prior.data().status))throw Error("既に反映が始まっています。表を開き直してください");
        tx.set(ref,{date:key,festivalMonth:nextFestivalMonth(key),items,status:"applying",appliedCount:0,startedBy:currentStaffName,startedAt:stamp()});
      });
      stocktakeRecord={items,status:"applying",appliedCount:0};renderStocktake();
    }
    let position=Number(stocktakeRecord.appliedCount||0);
    while(position<items.length){
      const expected=position,chunk=items.slice(position,position+100);
      await db.runTransaction(async tx => {
    await requireNoActiveReset(tx);
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
    await db.runTransaction(async tx => {
    await requireNoActiveReset(tx);const state=await tx.get(ref);if(!state.exists||state.data().status!=="applying"||state.data().appliedCount!==items.length)throw Error("進捗が変わりました");tx.update(ref,{status:"applied",appliedBy:currentStaffName,appliedAt:stamp()});});
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
    return `<tr data-id="${safe(i.productId)}" data-category="${safe(categoryLabel(p?.category||i.category)||"未分類")}" data-name="${safe(i.name)}" data-code="${safe(i.code)}" data-stock="${total}"><td>${safe(i.code)}</td><td>${safe(i.name)}</td><td>${p?total:"―"}</td><td>${field("qty",n.qty,true)}</td><td>${field("extraQty",n.extra)}</td><td>${field("directQty",n.direct)}</td><td>${field("returnedQty",n.returned)}</td><td>${field("damagedQty",n.damaged)}</td><td>${field("sampleQty",n.sample)}</td><td class="soldQty">${n.sold}</td><td><input class="price" type="number" min="0" value="${price}" ${disabled}></td><td class="salesAmount">${(n.sold*price).toLocaleString()}</td></tr>`;
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
  if (!inventoryWritesAllowed()) return;
  const month=festivalKey();if(!month||festivalRecord?.status==="settled")return;
  try{
    const items=collectFestival(),ref=db.collection(FESTIVALS).doc(month);
    await db.runTransaction(async tx => {
    await requireNoActiveReset(tx);const doc=await tx.get(ref),status=doc.exists?doc.data().status:"draft";
      if(status==="settled"||status==="prepared"&&festivalRecord?.status!=="prepared")throw Error("準備状態が変わりました。開き直してください");
      tx.set(ref,{month,items,status,stockMode:doc.exists?doc.data().stockMode||"deducted":"included",updatedBy:currentStaffName,updatedAt:stamp()});
    });
    festivalRecord={month,items,status:festivalRecord?.status||"draft",stockMode:festivalRecord?.stockMode||"included"};renderFestival();showToast("月始祭の入力を保存しました");
  }catch(err){console.error(err);showToast(err.message||"保存に失敗しました");}
}
async function changeFestival(prepare) {
  if (!inventoryWritesAllowed()) return;
  const month=festivalKey();if(!month)return;
  let items;try{items=prepare?collectFestival():festivalRecord?.items;}catch(err){return showToast(err.message);}
  if(!items?.some(i=>i.qty))return showToast("準備数量を入力してください");
  if(items.length>245)return showToast("一度に確定できる商品は245件までです");
  if(!confirm(prepare?`${month}の準備分を確定します。総在庫は減りません。よろしいですか？`:`${month}の準備を取り消します。よろしいですか？`))return;
  const ref=db.collection(FESTIVALS).doc(month),btn=prepare?$w("festivalCommitBtn"):$w("festivalReturnBtn");btn.disabled=true;
  try{
    let mode="included";
    await db.runTransaction(async tx => {
    await requireNoActiveReset(tx);
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
  if (!inventoryWritesAllowed()) return;
  const month=festivalKey();if(!month||festivalRecord?.status!=="prepared")return;
  let items;try{items=collectFestival();}catch(err){return showToast(err.message);}
  if(items.length>245)return showToast("一度に精算できる商品は245件までです");
  const sold=items.reduce((n,i)=>n+festivalNumbers(i).sold,0);
  if(!confirm(`${month}の売上数 合計${sold}点を精算します。戻り・乱丁・見本を確認しましたか？`))return;
  const ref=db.collection(FESTIVALS).doc(month),btn=$w("festivalSettleBtn");btn.disabled=true;
  try{
    await db.runTransaction(async tx => {
    await requireNoActiveReset(tx);
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
// 出荷先台帳。QR版/JAN版で同じコードと登録内容を共有する。
const DESTINATIONS_COLLECTION = "inventory_shipping_destinations";
const INVENTORY_CONTROL_COLLECTION = "inventory_operation_controls";
let destinationLookupGeneration = 0, destinationLookupTimer = null;
let matchedDestinationCode = "", matchedDestinationRevision = null;
let destinationWasAutofilled = false;
let inventoryControlReady = false, inventoryResetLocked = false;
let resetPreview = null, resetRunning = false, controlUnsubscribe = null;
const destinationFields = ["slipPartner", "slipPartnerAddress", "slipPartnerTel", "slipShipTo"];
function normalizeDestinationCode(value) {
  const code = String(value || "").normalize("NFKC").trim().toUpperCase();
  if(code === "社内")return code;
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(code)) throw Error("出荷先コードは半角英数字・ハイフン・アンダーバーの1～32文字で入力してください");
  return code;
}
function destinationForm() {
  return Object.fromEntries(["partner","partnerAddress","partnerTel","shipTo"].map((key,i) => [key, document.getElementById(destinationFields[i]).value.trim()]));
}
function destinationFormSignature() { return JSON.stringify(destinationForm()); }
function destinationMessage(message) { document.getElementById("destinationLookupStatus").textContent = message; }
function prepareDestinationForm(type) {
  clearTimeout(destinationLookupTimer); destinationLookupGeneration++;
  matchedDestinationCode = ""; matchedDestinationRevision = null; destinationWasAutofilled = false;
  document.getElementById("destinationCodeWrap").style.display = type === "out" ? "block" : "none";
  document.getElementById("slipDestinationCode").value = "";
  document.getElementById("saveDestinationMaster").checked = true;
  destinationMessage("初回はコードと出荷先を手入力します。登録後は同じコードで呼び出せます。");
}
async function lookupShippingDestination() {
  if (document.getElementById("slipCreateType").value !== "out") return;
  const input = document.getElementById("slipDestinationCode");
  const raw = input.value;
  if (!raw.trim()) return destinationMessage("出荷先コードを入力してください。");
  let code;
  try { code = normalizeDestinationCode(raw); }
  catch (err) { destinationMessage(err.message); return; }
  const generation = ++destinationLookupGeneration, signature = destinationFormSignature();
  destinationMessage("出荷先を検索しています…");
  try {
    let doc = await db.collection(DESTINATIONS_COLLECTION).doc(code).get({ source: "server" });
    let destination = doc.exists ? doc.data() : null;
    if (!destination) {
      // 新方式でコードを保存した過去の出荷伝票も呼び出し元にできる。
      const history = await db.collection(SLIPS_COLLECTION).where("destinationCode", "==", code).get({ source: "server" });
      const prior = history.docs.filter(d => d.data().type === "out").sort((a,b) => {
        const seconds = d => d.data().createdAt?.seconds || 0;
        return seconds(b) - seconds(a);
      })[0];
      if (prior) destination = prior.data();
    }
    if (generation !== destinationLookupGeneration || document.getElementById("slipCreateType").value !== "out" ||
        normalizeDestinationCode(input.value) !== code) return;
    matchedDestinationCode = code;
    matchedDestinationRevision = doc.exists ? Number(doc.data().revision || 0) : null;
    if (!destination) {
      document.getElementById("saveDestinationMaster").checked = true;
      return destinationMessage("未登録のコードです。出荷先名・住所・TEL等を手入力し、伝票を保存してください。");
    }
    document.getElementById("saveDestinationMaster").checked = !doc.exists;
    if (destinationFormSignature() !== signature) {
      return destinationMessage("検索中に手入力されたため上書きしていません。必要なら「呼び出す」を押してください。");
    }
    input.value = code;
    destinationFields.forEach((id,i) => {
      document.getElementById(id).value = destination[["partner","partnerAddress","partnerTel","shipTo"][i]] || "";
    });
    destinationWasAutofilled = true;
    document.getElementById("saveDestinationMaster").checked = !doc.exists;
    destinationMessage(doc.exists ? "登録済みの出荷先を反映しました。変更を台帳に残す場合は下のチェックを入れてください。" : "過去の出荷伝票から反映しました。保存時に台帳へ登録します。");
  } catch (err) {
    if (generation === destinationLookupGeneration) destinationMessage("検索できませんでした。通信状態と出荷先台帳のルールを確認してください。");
    console.error(err);
  }
}
async function savePilotSlip(type, destinationCode, destination, slip, saveMaster, expectedRevision) {
  const slipRef = db.collection(SLIPS_COLLECTION).doc();
  await db.runTransaction(async tx => {
    await requireNoActiveReset(tx);
    let master = null, ref = null;
    if (type === "out") {
      const code = normalizeDestinationCode(destinationCode);
      if (!destination.partner && !destination.shipTo) throw Error("出荷先名を入力してください");
      ref = db.collection(DESTINATIONS_COLLECTION).doc(code);
      master = await tx.get(ref);
      if (master.exists && saveMaster) {
        if (expectedRevision === null || Number(master.data().revision || 0) !== expectedRevision) {
          throw Error("このコードは別の操作で登録・変更されています。コードで呼び出し直して確認してください");
        }
      }
      if (!master.exists || saveMaster) tx.set(ref, {
        code, ...destination, revision: master.exists ? Number(master.data().revision || 0) + 1 : 1,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentStaffName
      });
    }
    tx.set(slipRef, { ...slip, ...(type === "out" ? { destinationCode: normalizeDestinationCode(destinationCode) } : {}) });
  });
}
function inventoryWritesAllowed() {
  if (!inventoryControlReady || inventoryResetLocked) {
    showToast(inventoryResetLocked ? "在庫の初期化中です。完了するまで操作をお待ちください" : "運用設定を確認中です。追加ルールと通信状態を確認してください");
    return false;
  }
  return true;
}
function inventoryControlRef() { return db.collection(INVENTORY_CONTROL_COLLECTION).doc("current"); }
async function requireNoActiveReset(tx) {
  const state = await tx.get(inventoryControlRef());
  if (state.exists && state.data().state === "resetting") throw Error("初期化中のため在庫操作を停止しています");
}
function resetStatus(message) { document.getElementById("pilotResetStatus").textContent = message; }
async function collectInventoryResetPlan() {
  if (!auth.currentUser) throw Error("ログインしてください");
  const disasterCheck=await db.collection(DISASTER_MOVEMENTS).get({source:"server"});
  if(disasterCheck.docs.some(d=>['disaster-sale-v1','disaster-purchase-v1'].includes(d.data().kind)&&['ordered','part_received'].includes(d.data().status)))throw Error("防災斡旋に未出荷注文・未入荷発注があります。先に完了または取消してください");
  const names = [COLLECTION,MOVEMENTS_COLLECTION,SLIPS_COLLECTION,FESTIVALS,STOCKTAKES];
  const snapshots = await Promise.all(names.map(name => db.collection(name).get({ source:"server" })));
  const plan = Object.fromEntries(names.map((name,i) => [name,snapshots[i].docs]));
  const reserved = plan[COLLECTION].filter(d => Number(d.data().reservedStock || 0) !== 0);
  const prepared = plan[FESTIVALS].filter(d => d.data().status === "prepared");
  const applying = plan[STOCKTAKES].filter(d => d.data().status === "applying");
  if (reserved.length || prepared.length || applying.length) {
    throw Error("月始祭の準備在庫または反映中の棚卸しがあるため初期化できません。先に準備取消・棚卸しの完了状態を確認してください");
  }
  return plan;
}
function resetCounts(plan) {
  return "入出庫履歴 " + plan[MOVEMENTS_COLLECTION].length + "件、入荷・出荷伝票 " + plan[SLIPS_COLLECTION].length +
    "件、通常商品 " + plan[COLLECTION].length + "件の現在庫を0にします。";
}
function downloadResetBackup(plan) {
  const payload = { savedAt: new Date().toISOString(), projectId:firebase.app().options.projectId, collections:{} };
  [COLLECTION,MOVEMENTS_COLLECTION,SLIPS_COLLECTION].forEach(name => {
    payload.collections[name] = plan[name].map(doc => ({ id:doc.id, data:doc.data() }));
  });
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  const a = document.createElement("a");a.href=url;a.download="在庫初期化前バックアップ_"+new Date().toISOString().slice(0,10)+".json";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function previewPilotReset() {
  if (resetRunning) return;
  document.getElementById("pilotResetExecuteBtn").disabled = true;
  resetPreview = null;
  try {
    resetPreview = await collectInventoryResetPlan();
    resetStatus("対象："+firebase.app().options.projectId+"\n"+resetCounts(resetPreview)+"\n紙製御み霊箱以外の通常商品も対象です。商品マスタ・出荷先台帳は残します。");
    document.getElementById("pilotResetExecuteBtn").disabled = false;
    document.getElementById("pilotResetBackupBtn").disabled = false;
  } catch (err) { resetStatus(err.message || "確認できませんでした。ルールと通信状態を確認してください"); }
}
async function acquireInventoryReset(runId) {
  const uid=auth.currentUser?.uid;
  if (!uid) throw Error("ログインしてください");
  const ref=inventoryControlRef();
  await db.runTransaction(async tx=>{
    const previous=await tx.get(ref);
    if(previous.exists&&previous.data().state==="resetting"&&previous.data().ownerUid!==uid) throw Error("別の担当者が初期化中です");
    tx.set(ref,{state:"resetting",ownerUid:uid,runId,startedBy:currentStaffName,startedAt:firebase.firestore.FieldValue.serverTimestamp()});
  });
  inventoryResetLocked=true;
}
async function releaseInventoryReset(runId, state, message) {
  await db.runTransaction(async tx=>{
    const doc=await tx.get(inventoryControlRef());
    if (!doc.exists || doc.data().runId!==runId || doc.data().ownerUid!==auth.currentUser?.uid) throw Error("初期化の実行状態が変わりました");
    tx.update(inventoryControlRef(),{state,message,finishedAt:firebase.firestore.FieldValue.serverTimestamp()});
  });
  inventoryResetLocked = state === "resetting";
}
async function performInventoryReset(plan, progress) {
  let processed=0;
  for (const name of [MOVEMENTS_COLLECTION,SLIPS_COLLECTION]) {
    const docs=plan[name];
    for(let i=0;i<docs.length;i+=350){
      const batch=db.batch();docs.slice(i,i+350).forEach(doc=>batch.delete(doc.ref));
      await batch.commit();processed+=Math.min(350,docs.length-i);progress(processed);
    }
  }
  const products=plan[COLLECTION];
  for(let i=0;i<products.length;i+=350){
    const batch=db.batch();products.slice(i,i+350).forEach(doc=>batch.update(doc.ref,{currentStock:0,reservedStock:0,openingStockImportId:firebase.firestore.FieldValue.delete(),openingStockImportedAt:firebase.firestore.FieldValue.delete()}));
    await batch.commit();processed+=Math.min(350,products.length-i);progress(processed);
  }
  // 同時更新などがあれば完了と扱わず、再実行可能な停止状態にする。
  const after=await Promise.all([COLLECTION,MOVEMENTS_COLLECTION,SLIPS_COLLECTION].map(name=>db.collection(name).get({source:"server"})));
  if(after[1].docs.length||after[2].docs.length||after[0].docs.some(d=>Number(d.data().currentStock||0)!==0||Number(d.data().reservedStock||0)!==0)) {
    throw Error("別操作によるデータ変更が検出されました。他の端末を停止して初期化を再実行してください");
  }
}
async function executePilotReset() {
  if(!resetPreview||resetRunning)return;
  if(!confirm(resetCounts(resetPreview)+"\n他の端末・旧版アプリの操作を止めてください。削除した履歴は元に戻せません。実行しますか？"))return;
  resetRunning=true;
  const runId=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);
  let locked=false, mutationsStarted=false;
  document.getElementById("pilotResetExecuteBtn").disabled=true;
  document.getElementById("pilotResetPreviewBtn").disabled=true;
  try {
    await acquireInventoryReset(runId);locked=true;
    const fresh=await collectInventoryResetPlan();
    downloadResetBackup(fresh);
    resetStatus("バックアップのダウンロードを開始しました。初期化しています…");
    mutationsStarted=true;
    await performInventoryReset(fresh,n=>resetStatus("初期化中："+n+"件処理しました。この画面を閉じないでください。"));
    await releaseInventoryReset(runId,"complete","履歴・伝票削除、通常商品の現在庫0をサーバーで確認");
    historySelected.clear();slipSelected.clear();resetPreview=null;
    resetStatus("初期化が完了しました。履歴・入荷出荷伝票が0件、通常商品の現在庫が0であることを確認しました。");
    showToast("初期化が完了しました");
  } catch(err) {
    console.error(err);
    if(locked&&!mutationsStarted) {
      try{await releaseInventoryReset(runId,"cancelled",err.message||"処理前に停止");}catch(releaseError){console.error(releaseError);}
    }
    resetStatus((err.message||"初期化が中断されました")+"\n"+(mutationsStarted?"一部処理済みの可能性があります。同じ担当者で対象を確認し、初期化を再実行してください。":"初期化は完了していません。"));
  } finally {resetRunning=false;document.getElementById("pilotResetPreviewBtn").disabled=false;}
}
function clearInventoryFormsForReset() {
  invalidateOpeningStock();
  destinationLookupGeneration++;clearTimeout(destinationLookupTimer);
  document.querySelectorAll(".modal-overlay.show").forEach(el=>el.classList.remove("show"));
  editingId=null;movingProductId=null;openSlipId=null;openOrderId=null;currentSlipItems=[];
  setSlipScannerMode(false);
}
function initPilotTools() {
  document.getElementById("searchBox").value="紙製御み霊箱";
  document.getElementById("destinationLookupBtn").addEventListener("click",lookupShippingDestination);
  const code=document.getElementById("slipDestinationCode");
  code.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();clearTimeout(destinationLookupTimer);lookupShippingDestination();}});
  code.addEventListener("input",()=>{
    destinationLookupGeneration++;clearTimeout(destinationLookupTimer);
    if(destinationWasAutofilled){destinationFields.forEach(id=>document.getElementById(id).value="");destinationWasAutofilled=false;}
    matchedDestinationCode="";matchedDestinationRevision=null;
    document.getElementById("saveDestinationMaster").checked=true;
    destinationMessage("コード入力後に呼び出します。未登録なら手入力で登録します。");
    destinationLookupTimer=setTimeout(lookupShippingDestination,350);
  });
  code.addEventListener("blur",()=>{clearTimeout(destinationLookupTimer);lookupShippingDestination();});
  document.getElementById("pilotResetPreviewBtn").addEventListener("click",previewPilotReset);
  document.getElementById("pilotResetBackupBtn").addEventListener("click",()=>{if(resetPreview)downloadResetBackup(resetPreview);});
  document.getElementById("pilotResetExecuteBtn").addEventListener("click",executePilotReset);
  document.addEventListener("click",e=>{
    if(!auth.currentUser||e.target.closest("#pilotResetPanel")||e.target.closest("#logoutBtn"))return;
    if(inventoryResetLocked&&e.target.closest("button,a")){e.preventDefault();e.stopImmediatePropagation();showToast("在庫の初期化中です");}
  },true);
  auth.onAuthStateChanged(user=>{
    if(controlUnsubscribe)controlUnsubscribe();
    inventoryControlReady=false;inventoryResetLocked=false;
    if(!user)return;
    controlUnsubscribe=inventoryControlRef().onSnapshot(doc=>{
      const wasLocked=inventoryResetLocked;
      inventoryControlReady=true;inventoryResetLocked=doc.exists&&doc.data().state==="resetting";
      if(inventoryResetLocked&&!wasLocked)clearInventoryFormsForReset();
      document.getElementById("pilotOperationMessage").textContent=inventoryResetLocked?"現在、在庫の初期化中です。完了するまで通常操作を停止してください。":"紙製御み霊箱から試験運用を開始します。初期検索は「紙製御み霊箱」です。";
    },err=>{console.error(err);document.getElementById("pilotOperationMessage").textContent="運用設定を読み込めません。READMEの追加ルールを確認してください。";});
  });
}


// ===================== 開始在庫の一括入力（既存商品専用） =====================
let openingStockPlan = null;
let openingStockGeneration = 0;
let openingStockBusy = false;
const OPENING_STOCK_HEADERS = ["商品ID", "商品コード", "商品名", "単位", "開始在庫数"];
function openingStockStatus(message) { document.getElementById("openingStockStatus").textContent = message; }
function invalidateOpeningStock() {
  openingStockGeneration++;
  openingStockPlan = null;
  document.getElementById("openingStockApplyBtn").disabled = true;
  document.getElementById("openingStockPreview").replaceChildren();
}
function openingText(value) { return String(value ?? "").normalize("NFKC").trim(); }
function parseOpeningQuantity(value) {
  const text = openingText(value);
  if (text === "") return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) throw Error("開始在庫数は0以上の整数で入力してください");
  const qty = Number(text.replace(/,/g,""));
  if (!Number.isSafeInteger(qty)) throw Error("開始在庫数が大きすぎます");
  return qty;
}
function buildOpeningStockPlan(rows, products) {
  const used = new Set(), plan = [], errors = [];
  rows.forEach((row,index) => {
    try {
      const qty = parseOpeningQuantity(row["開始在庫数"]);
      if (qty === null) return; // 空欄は変更しない。0は入力値として扱う。
      const id = String(row["商品ID"] ?? "").trim();
      const code = openingText(row["商品コード"]);
      const name = openingText(row["商品名"]);
      let matches;
      if (id) matches = products.filter(p => p.id === id);
      else if (code) matches = products.filter(p => openingText(p.code) === code);
      else if (name) matches = products.filter(p => openingText(p.name) === name);
      else throw Error("商品ID・商品コード・商品名のいずれかが必要です");
      if (matches.length !== 1) throw Error(matches.length ? "商品が複数あります。商品IDで指定してください" : "既存商品が見つかりません");
      const p = matches[0];
      if (code && code !== openingText(p.code)) throw Error("商品コードが一致しません");
      if (name && name !== openingText(p.name)) throw Error("商品名が一致しません");
      if (openingText(row["単位"]) && openingText(row["単位"]) !== openingText(p.unit)) throw Error("単位が一致しません。商品に登録された単位の数量を入力してください");
      if (used.has(p.id)) throw Error("同じ商品が重複しています");
      used.add(p.id);
      if (Number(p.currentStock || 0) !== 0) throw Error("現在庫が0ではありません。開始在庫で上書きできません");
      if (Number(p.reservedStock || 0) !== 0) throw Error("準備在庫があるため登録できません");
      if (p.openingStockImportId) throw Error("開始在庫は登録済みです。修正は入出庫または棚卸しで行ってください");
      plan.push({id:p.id, code:p.code || "", name:p.name || "", unit:p.unit || "", qty});
    } catch(err) { errors.push((index+2)+"行目："+err.message); }
  });
  if (errors.length) throw Error(errors.slice(0,20).join("\n")+(errors.length>20?"\nほか "+(errors.length-20)+"件":""));
  if (!plan.length) throw Error("開始在庫数が入力された行がありません。空欄は取り込みません");
  if (plan.length > 150) throw Error("1回150商品までです。ファイルを分けてください");
  return plan;
}
async function exportOpeningStockSheet() {
  if (!inventoryWritesAllowed() || openingStockBusy) return;
  if (typeof XLSX === "undefined") { showToast("Excel機能が読み込まれていません"); return; }
  try {
    const snapshot = await db.collection(COLLECTION).get({source:"server"});
    const only = document.getElementById("openingStockOnlyOmi").checked;
    const products = snapshot.docs.map(d=>({...d.data(),id:d.id})).filter(p=>!only||openingText(p.name).includes("紙製御み霊箱"));
    if (!products.length) throw Error("対象商品がありません。「紙製御み霊箱のみ」の選択や商品名を確認してください");
    products.sort((a,b)=>(a.code||a.name||"").localeCompare(b.code||b.name||"","ja"));
    const sheet = XLSX.utils.aoa_to_sheet([OPENING_STOCK_HEADERS,...products.map(p=>[p.id,String(p.code||""),p.name||"",p.unit||"",""])]);
    sheet["!cols"]=[{wch:30},{wch:20},{wch:38},{wch:10},{wch:16}];
    sheet["!autofilter"]={ref:sheet["!ref"]};
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,"開始在庫入力");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
      ["開始在庫の入力方法"],
      ["開始在庫入力シートの「開始在庫数」のみ入力してください。商品ID・コード・名称・単位は変えないでください。"],
      ["空欄は変更しません。0は在庫0として登録します。箱換算は行いません。登録単位の総数を入力してください。"],
      ["現在庫0・開始在庫未登録の商品が対象です。1回150商品まで。商品は新規作成しません。"],
      ["取り込み前に他の端末の在庫操作を止め、画面の照合結果を確認してください。"],
      ["登録後に初期化を実行すると入力した開始在庫も0になります。初期化は先に行ってください。"]
    ]),"入力方法");
    wb.Sheets["入力方法"]["!cols"]=[{wch:115}];
    XLSX.writeFile(wb,"開始在庫入力_商品一覧.xlsx");
    openingStockStatus(products.length+"商品の入力表を出力しました。「開始在庫数」を入力し、この欄で読み込んでください。");
  } catch(err) { openingStockStatus(err.message || "入力表を出力できませんでした"); }
}
async function handleOpeningStockFile(e) {
  invalidateOpeningStock();
  const generation=openingStockGeneration, uid=auth.currentUser?.uid;
  const file=e.target.files[0];
  if (!file || !inventoryWritesAllowed() || openingStockBusy) return;
  openingStockStatus("Excelを読み込み、最新の商品情報と照合しています…");
  try {
    if(typeof XLSX === "undefined") throw Error("Excel機能が読み込まれていません");
    const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"});
    const sheet=workbook.Sheets["開始在庫入力"] || workbook.Sheets[workbook.SheetNames[0]];
    const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:"",raw:false,blankrows:true});
    const headers=(matrix[0] || []).map(openingText);
    if (!headers.includes("開始在庫数") || !headers.some(h=>["商品ID","商品コード","商品名"].includes(h))) throw Error("1行目の見出しが違います。開始在庫用の入力表を使ってください");
    if (headers.some((h,i)=>h&&headers.indexOf(h)!==i)) throw Error("同じ列名が重複しています");
    const rows=matrix.slice(1).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]??""])));
    const snapshot=await db.collection(COLLECTION).get({source:"server"});
    const plan=buildOpeningStockPlan(rows,snapshot.docs.map(d=>({...d.data(),id:d.id})));
    if(generation!==openingStockGeneration || uid!==auth.currentUser?.uid || inventoryResetLocked || !inventoryControlReady)return;
    openingStockPlan=plan;
    const body=document.getElementById("openingStockPreview");body.replaceChildren();
    plan.forEach(p=>{const tr=document.createElement("tr");[p.code,p.name,"0",p.qty,p.unit].forEach(value=>{const td=document.createElement("td");td.textContent=String(value);tr.appendChild(td);});body.appendChild(tr);});
    openingStockStatus(plan.length+"商品を照合しました。現在庫0から入力数に設定します。空欄の行は変更しません。");
    document.getElementById("openingStockApplyBtn").disabled=false;
  } catch(err) { if(generation===openingStockGeneration)openingStockStatus(err.message || "読み込みに失敗しました"); }
}
async function commitOpeningStock(plan, importId, staff) {
  const refs=plan.map(p=>db.collection(COLLECTION).doc(p.id));
  const movementRefs=plan.map(()=>db.collection(MOVEMENTS_COLLECTION).doc());
  await db.runTransaction(async tx=>{
    await requireNoActiveReset(tx);
    const docs=[];
    for(const ref of refs)docs.push(await tx.get(ref));
    docs.forEach((doc,i)=>{
      if(!doc.exists)throw Error("商品が削除されました。Excelを読み込み直してください");
      const p=doc.data(), row=plan[i];
      if(p.openingStockImportId || Number(p.currentStock||0)!==0 || Number(p.reservedStock||0)!==0 || (p.name||"")!==row.name || (p.code||"")!==row.code || (p.unit||"")!==row.unit) throw Error("商品・在庫情報が変わりました："+row.name+"。Excelを読み込み直してください");
    });
    const timestamp=firebase.firestore.FieldValue.serverTimestamp();
    plan.forEach((row,i)=>{
      tx.update(refs[i],{currentStock:row.qty,openingStockImportId:importId,openingStockImportedAt:timestamp});
      if(row.qty>0)tx.set(movementRefs[i],{productId:row.id,productName:row.name,unit:row.unit,type:"in",qty:row.qty,note:"運用開始時の開始在庫（Excel一括入力）",staff,createdAt:timestamp,openingStockImportId:importId});
    });
  });
}
async function applyOpeningStock() {
  if(!inventoryWritesAllowed() || openingStockBusy || !openingStockPlan)return;
  const plan=openingStockPlan.map(p=>({...p}));
  if(!confirm(plan.length+"商品の開始在庫を登録します。数量は加算ではなく、現在庫0から入力数に設定します。実行しますか？"))return;
  openingStockBusy=true;document.getElementById("openingStockApplyBtn").disabled=true;
  document.getElementById("openingStockFile").disabled=true;
  try {
    await commitOpeningStock(plan,"opening-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2),currentStaffName);
    invalidateOpeningStock();document.getElementById("openingStockFile").value="";
    openingStockStatus(plan.length+"商品の開始在庫を登録しました。数量が1以上の行は入出庫履歴に「運用開始時の開始在庫」として残しました。");
    showToast("開始在庫を登録しました");
  } catch(err) {
    invalidateOpeningStock();
    openingStockStatus((err.message||"登録結果を確認できませんでした")+"\n在庫一覧と履歴を確認してからExcelを読み込み直してください。");
  } finally {openingStockBusy=false;document.getElementById("openingStockFile").disabled=false;}
}
function initOpeningStockTools() {
  document.getElementById("openingStockExportBtn").addEventListener("click",exportOpeningStockSheet);
  document.getElementById("openingStockFile").addEventListener("change",handleOpeningStockFile);
  document.getElementById("openingStockApplyBtn").addEventListener("click",applyOpeningStock);
  auth.onAuthStateChanged(()=>invalidateOpeningStock());
}

// 商品バーコードの用紙選択。23mmは縮小印刷のため実機で読取確認が必要。
let productLabelSize = "23";
let productLabelPreviewCount = 0;
let compactBarcodeReduction = 1;
// 300dpiで1モジュールを2ドットにそろえ、線と隙間の端数縮小を避ける。
function makeCompactProductBarcode(code) {
  const bits = ean13Bits(code);
  const canvas = document.createElement("canvas");
  // EAN-13：左11・右7モジュールの白地を含む113モジュール。
  canvas.width = 226;
  canvas.height = 88;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "商品バーコード " + code);
  const context = canvas.getContext("2d");
  if (!context) throw Error("バーコードの画像を作成できませんでした");
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 226, 88);
  context.fillStyle = "#000";
  // 黒い連続区間をまとめて補正する。太いバーの内部に白い隙間を作らない。
  for (let i = 0; i < bits.length;) {
    if (bits[i] !== "1") { i++; continue; }
    const start = i;
    while (i < bits.length && bits[i] === "1") i++;
    const guard = start < 3 || start >= 45 && start < 50 || start >= 92;
    const width = Math.max(1, (i - start) * 2 - compactBarcodeReduction);
    context.fillRect((11 + start) * 2, 0, width, guard ? 84 : 76);
  }
  return canvas;
}

function makeProductLabelSvg(code) {
  return productLabelSize === "23" ? makeCompactProductBarcode(code) : makeEanSvg(code);
}
// 数字は画像から分けて専用の行へ。画像の下端で文字を切らない。
function renderProductBarcodeBox(box) {
  const code = box.dataset.barcode;
  box.replaceChildren(makeProductLabelSvg(code));
  if (productLabelSize === "23") {
    const digits = document.createElement("div");
    digits.className = "product-label-digits";
    digits.textContent = code;
    box.appendChild(digits);
  }
}
// 文字を省略せず枠内に収める。収まらないときは小型シールの印刷を止める。
function fitCompactProductText() {
  if (productLabelSize !== "23") return true;
  let fits = true;
  document.getElementById("qrBulkGrid").querySelectorAll(".brother-product-label").forEach(cell => {
    [[".product-label-name", 5, 3.5, 0.1], [".product-label-color", 5.5, 3.8, 0.1], [".product-label-price", 6.5, 5, 0.25]].forEach(([selector, start, min, step]) => {
      const element = cell.querySelector(selector);
      if (!element) { fits = false; return; }
      if (element.hidden) return;
      let size = start;
      element.style.fontSize = size + "pt";
      const overflows = () => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
      if (element.clientWidth <= 0 || element.clientHeight <= 0) { fits = false; return; }
      while (overflows() && size > min) {
        size = Math.max(min, Math.round((size - step) * 100) / 100);
        element.style.fontSize = size + "pt";
      }
      if (overflows()) fits = false;
    });
  });
  return fits;
}

function updateProductLabelSize() {
  const select = document.getElementById("productLabelSizeSelect");
  productLabelSize = select.value === "62" ? "62" : "23";
  compactBarcodeReduction = document.getElementById("productBarcodeWeightSelect").value === "standard" ? 0 : 1;
  document.getElementById("productBarcodeWeightTools").hidden = productLabelSize !== "23";
  const area = document.getElementById("qrBulkPrintArea");
  area.classList.remove("brother-qr-mode", "brother-pick-mode", "brother-product-small-mode");
  area.classList.add("brother-product-mode");
  if (productLabelSize === "23") area.classList.add("brother-product-small-mode");
  document.getElementById("qrBulkGrid").querySelectorAll(".product-label-bars").forEach(renderProductBarcodeBox);
  // 大きい用紙へ戻した場合は通常サイズに戻す。
  document.getElementById("qrBulkGrid").querySelectorAll(".product-label-name, .product-label-color, .product-label-price").forEach(element => { element.style.fontSize = ""; });
  document.getElementById("qrBulkTitle").textContent = productLabelSize === "23" ? "商品バーコード・商品名・価格（23×23mm）" : "商品バーコード・商品名・価格（62×29mm）";
  document.getElementById("qrBulkHint").textContent = productLabelPreviewCount + "枚／" + (productLabelSize === "23"
    ? "DK-1221（23×23mm）。300dpi・倍率100%・ヘッダー／フッターなし。用紙に合わせる拡大縮小は使わないでください。商品名2行・色1行・価格の順に印刷します。色は商品名末尾の既知の色名から分けて表示し、判別できない場合は商品名に残します。標準より小さいバーコードです。最初に1枚だけ印刷し、Tera HW0010で商品が正しく開くか確認してください。POSでの読取は未確認です。"
    : "DK-1209（62×29mm）。倍率100%・ヘッダー／フッターなし。価格は商品マスタの売価です。POS利用には同じ商品番号と価格の登録が必要です。");
  if (productLabelSize === "23") document.getElementById("qrBulkHint").textContent += compactBarcodeReduction
    ? " 線は「細く補正」です。線が欠ける場合は「標準」に戻してください。"
    : " 線は「標準」です。黒い線が太る場合は「細く補正」を試してください。";
  const fits = fitCompactProductText();
  document.getElementById("qrBulkPrintOkBtn").disabled = !fits;
  if (!fits) document.getElementById("qrBulkHint").textContent += " 文字が収まらない商品があります。用紙を62×29mmに切り替えてください。";
  updateLabelPrinterGuide();
  return fits;
}
function initProductLabelSizes() {
  const select = document.getElementById("productLabelSizeSelect");
  select.value = productLabelSize;
  select.addEventListener("change", updateProductLabelSize);
  const weight = document.getElementById("productBarcodeWeightSelect");
  weight.value = "thin";
  weight.addEventListener("change", updateProductLabelSize);
}

// ブラウザ・ドライバーの実設定は読めないため、今回選ぶ設定と開き方を表示する。
function updateLabelPrinterGuide() {
  const area = document.getElementById("qrBulkPrintArea");
  const small = area.classList.contains("brother-product-small-mode") || area.classList.contains("brother-qr-mode");
  const compactBarcode = area.classList.contains("brother-product-small-mode");
  document.getElementById("printerGuidePaper").textContent = small ? "23×23mm（DK-1221）" : "62×29mm（DK-1209）";
  document.getElementById("printerGuideWeight").textContent = compactBarcode ? (compactBarcodeReduction ? "細く補正（印字太り対策）" : "標準") : "標準";
  document.getElementById("printerGuideResolution").textContent = compactBarcode ? "300dpi" : "プリンターの標準設定";
  document.getElementById("printerGuideSummary").textContent = "今回の用紙：" + (small ? "23×23mm" : "62×29mm") + " ／ 倍率100% ／ ヘッダー・フッターなし";
}
function openLabelPrinterGuide() {
  updateLabelPrinterGuide();
  const guide = document.getElementById("labelPrinterGuide");
  guide.open = true;
  const summary = document.getElementById("labelPrinterGuideToggle");
  summary.focus();
  summary.scrollIntoView({block:"nearest", behavior:"smooth"});
}
function initLabelPrinterGuide() {
  document.getElementById("qrPrinterHelpBtn").addEventListener("click", openLabelPrinterGuide);
}

let barcodeEditSaveBusy = false;
let pendingBarcodeTransfer = null;
const barcodeEditFieldIds = ["editName","editCode","editBarcode","editSupplier","editLot","editCategory","editUnit","editPrice","editStock","editMinStock","editNote"];
function barcodeProductState(product) {
  return JSON.stringify(["name","code","barcode","barcodeAliases","supplier","lot","category","unit","price","currentStock","reservedStock","minStock","note"].map(key=>product[key]??null));
}
function barcodeEditFormState() { return JSON.stringify(barcodeEditFieldIds.map(id=>document.getElementById(id).value)); }
function clearBarcodeEditStatus() {
  pendingBarcodeTransfer = null;
  document.getElementById("editBarcodeStatus").textContent = "";
  document.getElementById("editBarcodeTransferBtn").hidden = true;
}
function setBarcodeEditBusy(busy) {
  barcodeEditSaveBusy = busy;
  document.getElementById("editSaveBtn").disabled = busy;
  document.getElementById("editBarcodeTransferBtn").disabled = busy;
  barcodeEditFieldIds.forEach(id=>{document.getElementById(id).disabled=busy;});
}
function showBarcodeEditFailure(error, targetId, requested, data, formState) {
  barcodeError(error);
  if (editingId !== targetId || barcodeEditFormState() !== formState) return;
  clearBarcodeEditStatus();
  document.getElementById("editBarcodeStatus").textContent = error.message || "保存できませんでした";
  const conflict = error.barcodeConflict;
  if (conflict?.kind !== "alias") return;
  pendingBarcodeTransfer = {targetId, requested, data, formState, conflict};
  const button = document.getElementById("editBarcodeTransferBtn");
  button.textContent = "旧番号の使用先を確認して、この商品へ付け替える";
  button.hidden = false;
}
async function confirmBarcodeAliasTransfer() {
  const pending = pendingBarcodeTransfer;
  if (barcodeEditSaveBusy || !pending || !inventoryWritesAllowed()) return;
  if (editingId !== pending.targetId || barcodeEditFormState() !== pending.formState) {
    clearBarcodeEditStatus();return showToast("入力内容が変わりました。保存し直して確認してください");
  }
  const c=pending.conflict;
  const message = "番号："+pending.requested+"\n変更元："+c.ownerName+"（商品コード "+c.ownerCode+"）\n変更元の現在番号："+c.currentBarcode+"\n変更先："+pending.data.name+"（商品コード "+pending.data.code+"）\n\nこの番号を変更元の旧番号から外し、変更先へ登録します。変更元の現在番号は変更しません。\nこの番号が印刷された変更元の古いシールは、今後変更先の商品を開きます。古いシールを使わず、貼り替えてください。\n付け替えて保存しますか？";
  if(!confirm(message)) return;
  setBarcodeEditBusy(true);
  try {
    await ensureProductBarcode(pending.targetId,pending.requested,pending.data,{fromProductId:c.ownerId,ownerState:c.ownerState,targetState:c.targetState});
    renderProductList();showToast("旧番号を付け替えて保存しました。対象商品のシールを貼り替えてください");
    if(editingId===pending.targetId)closeEditModal();
  } catch(error) { showBarcodeEditFailure(error,pending.targetId,pending.requested,pending.data,pending.formState); }
  finally { setBarcodeEditBusy(false); }
}
function initBarcodeTransferTools() {
  document.getElementById("editBarcodeTransferBtn").addEventListener("click",confirmBarcodeAliasTransfer);
  barcodeEditFieldIds.forEach(id=>document.getElementById(id).addEventListener("input",clearBarcodeEditStatus));
}

// 印刷ジョブ全体の用紙指定。ラベルの子要素だけに名前付きページを割り当てない。
function labelPaperSettings() {
  const area = document.getElementById("qrBulkPrintArea");
  const small = area.classList.contains("brother-product-small-mode") || area.classList.contains("brother-qr-mode");
  const product = area.classList.contains("brother-product-mode");
  return {size: small ? "23mm 23mm" : "62mm 29mm", margin: small ? (area.classList.contains("brother-qr-mode") ? "2mm" : "1.9mm") : (product ? "1.8mm" : "0")};
}
function clearLabelPaperSize() {
  const style = document.getElementById("activeLabelPaperStyle");
  if (style) style.remove();
}
function applyLabelPaperSize() {
  clearLabelPaperSize();
  if (!document.body.classList.contains("label-print")) return;
  const paper = labelPaperSettings();
  const style = document.createElement("style");
  style.id = "activeLabelPaperStyle";
  // 匿名ページにも指定し、親ページが前回の29×90mm等になることを防ぐ。
  style.textContent = "@page { size:" + paper.size + "; margin:" + paper.margin + "; }\n" +
    "@media print { html, body.label-print, body.label-print * { page:auto !important; } }";
  document.head.appendChild(style);
}
window.addEventListener("beforeprint", applyLabelPaperSize);
window.addEventListener("afterprint", clearLabelPaperSize);

// 個体別の検品専用EAN-13。商品用番号と独立し、再印刷しても同じ番号を使う。
const INSPECTION_UNIT_LIMIT = 300;
let inspectionScanQueue = Promise.resolve();
function inspectionPlan(items) {
  if (!Array.isArray(items) || !items.length) throw Error("出荷商品がありません");
  let count=0;
  const rows=items.map((item,index)=>{
    if (!item.productId || typeof item.productId!=="string") throw Error("商品を確認してください");
    const qty=inventoryQuantity(item.plannedQty,"出荷数量");
    if (!qty) throw Error("出荷数量は1以上にしてください");
    count+=qty; return [index,item.productId,qty];
  });
  if (count>INSPECTION_UNIT_LIMIT) throw Error("検品番号は1伝票300個までです。伝票を分けてください");
  return {signature:JSON.stringify(rows),count,rows};
}
function inspectionLedger(s) {
  const plan=inspectionPlan(s.items);
  if (s.inspectionVersion!==1 || s.inspectionPlan!==plan.signature || !Array.isArray(s.inspectionUnits) || s.inspectionUnits.length!==plan.count) throw Error("検品番号と出荷内容が一致しません。伝票を確認してください");
  const codes=new Set(),positions=new Set();
  for (const u of s.inspectionUnits) {
    const item=s.items[u.itemIndex];
    const pos=u.itemIndex+":"+u.unitIndex;
    if (!validEan13(u.code) || !item || u.productId!==item.productId || !Number.isSafeInteger(u.itemIndex) || !Number.isSafeInteger(u.unitIndex) || u.unitIndex<1 || u.unitIndex>Number(item.plannedQty) || codes.has(u.code) || positions.has(pos) || typeof u.used!=="boolean") throw Error("検品番号の登録内容を確認してください");
    codes.add(u.code);positions.add(pos);
  }
  return s.inspectionUnits;
}
function inspectionCounts(s) {
  const units=inspectionLedger(s);
  return s.items.map((_,i)=>units.filter(u=>u.itemIndex===i && u.used).length);
}
function assertInspectionComplete(s, entered) {
  const counts=inspectionCounts(s);
  if (counts.some((n,i)=>n!==Number(s.items[i].plannedQty) || Number(entered[i]?.checkedQty)!==n || !entered[i]?.checked)) throw Error("全ての現品と検品JANを読み取ってください。未検品の数量があります");
}
function updateInspectionLocal(s) {
  const old=allSlips.find(x=>x.id===s.id);
  if (old) Object.assign(old,s);
  if (openSlipId===s.id) syncInspectionCounts();
}
function syncInspectionCounts() {
  const s=allSlips.find(x=>x.id===openSlipId);
  if (!s || s.type!=="out") return;
  let counts=s.items.map(i=>s.status==="done"?Number(i.checkedQty||0):0);
  if (s.inspectionVersion===1) {
    try {counts=inspectionCounts(s);} catch(e) {setSlipScanStatus(e.message,true);}
  }
  s.items.forEach((item,i)=>{
    const input=document.querySelector(`.slip-check-qty[data-idx="${i}"]`);
    const check=document.querySelector(`.slip-check-box[data-idx="${i}"]`);
    if(input){input.value=counts[i];input.readOnly=true;}
    if(check){check.checked=counts[i]===Number(item.plannedQty);check.disabled=true;}
  });
  const button=document.getElementById("slipDetailPrintCheckBtn");
  if(button)button.textContent=s.status==="done" && s.inspectionVersion!==1?"🔍 検品表（旧方式）":"📋 出荷指示書・検品JAN";
}
function findInspectionCode(code) {
  for (const s of allSlips) {
    const unit=(s.inspectionUnits||[]).find(u=>u.code===code);
    if(unit)return {slip:s,unit};
  }
  return null;
}
async function ensureSlipInspection(slipId) {
  if (!inventoryWritesAllowed()) throw Error("現在は更新できません");
  const ref=db.collection(SLIPS_COLLECTION).doc(slipId);
  const registry=db.collection(BARCODE_REGISTRY),counterRef=registry.doc("_inspection_sequence");
  const result=await db.runTransaction(async tx=>{
    await requireNoActiveReset(tx);
    const doc=await tx.get(ref);
    if(!doc.exists)throw Error("伝票が見つかりません");
    const s=doc.data();
    if(s.type!=="out")throw Error("出荷伝票を開いてください");
    if(s.inspectionVersion===1){inspectionLedger(s);return {id:slipId,...s};}
    if(s.inspectionVersion!=null)throw Error("検品方式の版が異なります。管理者に確認してください");
    if(s.status!=="draft")throw Error("完了済みの伝票には検品番号を新規発行できません");
    if((s.items||[]).some(i=>Number(i.checkedQty||0)!==0))throw Error("確認済み数量が残っています。数量を確認して新しい出荷伝票を作成してください");
    const plan=inspectionPlan(s.items),counter=await tx.get(counterRef);
    let next=counter.exists?Number(counter.data().next):1;
    if(!Number.isSafeInteger(next)||next<1)throw Error("検品番号の採番設定を確認してください");
    const reserved=[];let attempts=0;
    while(reserved.length<plan.count){
      if(++attempts>plan.count+1000 || next>9999999999)throw Error("検品番号を発行できません。管理者に確認してください");
      const body="29"+String(next++).padStart(10,"0"),code=body+eanCheckDigit(body);
      const allocated=await tx.get(registry.doc(code));
      if(allocated.exists || allProducts.some(p=>p.barcode===code || (p.barcodeAliases||[]).includes(code)))continue;
      reserved.push(code);
    }
    const units=[];
    for(const [itemIndex,productId,qty] of plan.rows)for(let unitIndex=1;unitIndex<=qty;unitIndex++)units.push({code:reserved[units.length],itemIndex,productId,unitIndex,used:false});
    // すべての読み取りを済ませてから書く。採番台帳と伝票をまとめて確定。
    units.forEach(u=>tx.set(registry.doc(u.code),{kind:"inspection",slipId,itemIndex:u.itemIndex,unitIndex:u.unitIndex,productId:u.productId,used:false}));
    tx.set(counterRef,{next});
    const changes={inspectionVersion:1,inspectionPlan:plan.signature,inspectionUnits:units,inspectionUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()};
    tx.update(ref,changes);
    return {id:slipId,...s,...changes};
  });
  updateInspectionLocal(result);return result;
}
async function consumeInspectionUnit(slipId, code, productId) {
  if(!inventoryWritesAllowed())throw Error("現在は更新できません");
  const ref=db.collection(SLIPS_COLLECTION).doc(slipId),reg=db.collection(BARCODE_REGISTRY).doc(code);
  const result=await db.runTransaction(async tx=>{
    await requireNoActiveReset(tx);
    const record=await tx.get(ref),allocation=await tx.get(reg);
    if(!record.exists)throw Error("伝票が削除されています");
    const s=record.data();
    if(s.type!=="out" || s.status!=="draft")throw Error("出荷伝票が完了済みか、状態が変わっています");
    const units=inspectionLedger(s),unit=units.find(u=>u.code===code);
    const a=allocation.exists?allocation.data():null;
    if(!unit || !a || a.kind!=="inspection" || a.slipId!==slipId || a.productId!==unit.productId || a.itemIndex!==unit.itemIndex || a.unitIndex!==unit.unitIndex)throw Error("この出荷指示書の検品JANではありません");
    if(unit.productId!==productId)throw Error("現品と検品JANの商品が一致しません");
    if(unit.used || a.used)throw Error("この検品JANは読み取り済みです。同じ番号は使えません");
    const inspectionUnits=units.map(u=>u.code===code?{...u,used:true,usedAt:Date.now(),usedBy:currentStaffName||""}:u);
    const changed={...s,inspectionUnits};const counts=inspectionCounts(changed);
    const items=s.items.map((item,i)=>({...item,checkedQty:counts[i],checked:counts[i]===Number(item.plannedQty)}));
    tx.update(reg,{used:true,usedAt:firebase.firestore.FieldValue.serverTimestamp(),usedBy:currentStaffName||""});
    tx.update(ref,{inspectionUnits,items,inspectionUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    return {id:slipId,...changed,items};
  });
  updateInspectionLocal(result);return result;
}
function inspectionFailure(message) {pendingSlipScanCode=null;playWarningAlert();showToast(message);setSlipScanStatus(message,true);}
function handleSlipItemVerifyScan(text) {
  const slipId=openSlipId;
  const s=allSlips.find(s=>s.id===slipId);
  if(s?.type!=="out")return handleLegacySlipItemVerifyScan(text);
  inspectionScanQueue=inspectionScanQueue.then(()=>verifyOutgoingInspection(text,slipId)).catch(e=>{if(openSlipId===slipId)inspectionFailure(e.message||"検品結果を保存できませんでした。通信を確認してください");});
  return inspectionScanQueue;
}
async function verifyOutgoingInspection(text,slipId) {
  if(openSlipId!==slipId)throw Error("出荷伝票を開き直して読み取ってください");
  const s=allSlips.find(s=>s.id===slipId);
  if(!s || s.status!=="draft")throw Error("伝票は完了済みか、状態が変わっています");
  if(s.inspectionVersion!==1)throw Error("先に「出荷指示書・検品JAN」を押して検品番号を発行してください");
  inspectionLedger(s);
  const raw=String(text).trim(),found=findInspectionCode(raw);
  let scan;
  if(found){
    if(found.slip.id!==slipId)throw Error("別の出荷指示書の検品JANです");
    if(found.unit.used)throw Error("この検品JANは読み取り済みです。同じ番号は使えません");
    scan={role:"inspection",productId:found.unit.productId,code:raw};
  } else {
    const parsed=extractScannedId(raw);
    if(parsed.type==="inspection")throw Error("出荷指示書に印刷した検品JANを読んでください。旧検品QRは使えません");
    const productId=resolveScannedProductId(raw);
    if(!productId || !s.items.some(i=>i.productId===productId))throw Error("この出荷伝票に含まれない商品です");
    scan={role:"product",productId};
  }
  const first=pendingSlipScanCode;
  if(!first){pendingSlipScanCode=scan;setSlipScanStatus(scan.role==="product"?"現品を確認しました。対応する検品JANを読んでください":"検品JANを確認しました。現品の商品JANを読んでください",false);playTone(660,60,"sine");return;}
  pendingSlipScanCode=null;
  if(first.role===scan.role)throw Error("現品の商品JANと検品JANを、1回ずつ読み取ってください");
  if(first.productId!==scan.productId)throw Error("現品と検品JANの商品が一致しません");
  const unit=scan.role==="inspection"?scan:first;
  const saved=await consumeInspectionUnit(slipId,unit.code,scan.productId);
  const counts=inspectionCounts(saved),match=saved.inspectionUnits.find(u=>u.code===unit.code),item=saved.items[match.itemIndex];
  playSuccessBeep();
  if(openSlipId===slipId)setSlipScanStatus(`✅ ${item.productName}：${counts[match.itemIndex]}/${item.plannedQty}${item.unit||""} 検品済み。次の現品を読んでください`,false);
}
function makeInspectionSvg(code) {
  const bits=ean13Bits(code),ns="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(ns,"svg");
  for(const [key,value] of Object.entries({viewBox:"0 0 117 60",width:"35.1mm",height:"18mm",role:"img","aria-label":"検品専用バーコード "+code,"shape-rendering":"crispEdges"}))svg.setAttribute(key,value);
  const white=document.createElementNS(ns,"rect");
  for(const [k,v] of Object.entries({width:"117",height:"60",fill:"white"}))white.setAttribute(k,v);svg.appendChild(white);
  [...bits].forEach((bit,i)=>{if(bit!=="1")return;const bar=document.createElementNS(ns,"rect");
    for(const [k,v] of Object.entries({x:String(i+11),y:"0",width:"1",height:(i<3 || i>=45&&i<50 || i>=92)?"47":"43",fill:"black"}))bar.setAttribute(k,v);svg.appendChild(bar);
  });
  const number=document.createElementNS(ns,"text");
  for(const [k,v] of Object.entries({x:"58.5",y:"56","text-anchor":"middle","font-size":"8","font-family":"Arial, sans-serif",fill:"black"}))number.setAttribute(k,v);
  number.textContent=code;svg.appendChild(number);return svg;
}
function clearInspectionPaperSize(){document.getElementById("activeInspectionPaperStyle")?.remove();}
function applyInspectionPaperSize(){
  clearInspectionPaperSize();
  if(!document.body.classList.contains("slip-print") || document.getElementById("slipPrintSheet").dataset.inspection!=="1")return;
  const style=document.createElement("style");style.id="activeInspectionPaperStyle";
  style.textContent="@page {size:A4 portrait;margin:10mm;} @media print {html, body.slip-print, body.slip-print * {page:auto !important;}}";
  document.head.appendChild(style);
}
window.addEventListener("beforeprint",applyInspectionPaperSize);
window.addEventListener("afterprint",clearInspectionPaperSize);
function appendInspectionCard(host,s,u) {
  const item=s.items[u.itemIndex],card=document.createElement("div");card.className="inspection-jan-card";
  const heading=document.createElement("div");heading.className="inspection-jan-heading";
  heading.textContent=`${item.code||""} ${item.productName}　${u.unitIndex}/${item.plannedQty}（1個分）${u.used?"【検品済み】":""}`;
  card.appendChild(heading);if(item.remark){const instruction=document.createElement("div");instruction.className="inspection-jan-note";instruction.textContent="指定："+item.remark;card.appendChild(instruction);}card.appendChild(makeInspectionSvg(u.code));
  const note=document.createElement("div");note.className="inspection-jan-note";note.textContent="検品専用・販売不可 ／ 商品JANと組み合わせて1回だけ使用";card.appendChild(note);host.appendChild(card);
}
async function printOutgoingInspectionSheet(slipId) {
  const s=await ensureSlipInspection(slipId);
  if(openSlipId!==slipId)return;
  const sheet=document.getElementById("slipPrintSheet");
  sheet.dataset.inspection="1";sheet.innerHTML=buildCheckSheetHtml(s).replace("検品表（出荷）","出荷指示書・個数検品");
  const instruction=document.createElement("p");instruction.textContent="現品の商品JAN → この指示書の検品JANで1個確認。数量分すべての番号を読み取ってください。同じ番号は再使用できません。再印刷しても使用状況は変わりません。";
  const cards=document.createElement("div");cards.className="inspection-jan-cards";
  inspectionLedger(s).forEach(u=>appendInspectionCard(cards,s,u));sheet.appendChild(cards);sheet.appendChild(instruction);
  const qrHost=document.getElementById("printSheetQr");
  if(qrHost)new QRCode(qrHost,{text:buildSlipUrl(s.id),width:64,height:64,correctLevel:QRCode.CorrectLevel.M});
  clearLabelPaperSize();document.body.classList.remove("label-print","work-print","order-print","prepared-print");document.body.classList.add("slip-print");
  applyInspectionPaperSize();setTimeout(()=>window.print(),150);
}
async function printOutgoingInspectionLabels(slipId) {
  const s=await ensureSlipInspection(slipId),grid=document.getElementById("qrBulkGrid");grid.className="brother-label-list";grid.replaceChildren();
  for(const u of inspectionLedger(s)){
    const item=s.items[u.itemIndex],cell=document.createElement("div");cell.className="brother-pick-label inspection-jan-label";
    const title=document.createElement("div");title.textContent=`${item.productName}　${u.unitIndex}/${item.plannedQty}${item.remark?"　指定："+item.remark:""}${u.used?" 検品済み":""}`;
    cell.appendChild(title);cell.appendChild(makeInspectionSvg(u.code));
    const note=document.createElement("div");note.textContent=`検品専用・販売不可　${s.slipNumber||""}`;cell.appendChild(note);grid.appendChild(cell);
  }
  finishBrotherLabels(grid,"pick","出荷検品JANシール（62×29mm）",s.inspectionUnits.length);
  if([...grid.children].some(c=>c.scrollHeight>c.clientHeight || c.scrollWidth>c.clientWidth)) {
    document.getElementById("qrBulkPrintOkBtn").disabled=true;
    document.getElementById("qrBulkHint").textContent="文字が検品シールに収まりません。A4の出荷指示書をご利用ください。";
  }
}

// S1出荷指示依頼書：原本の4区画から、出荷先ごとの未検品伝票を作成する。
let s1ImportPlan=null,s1ImportGeneration=0,s1ImportBusy=false;
function s1Normalize(v){return String(v??"").normalize("NFKC").trim();}
function s1Name(v){return s1Normalize(v).replace(/\s+/g,"").toLowerCase();}
function s1ValidDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+"T00:00:00Z");return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function s1HeaderDate(title,fallback){
  const text=s1Normalize(title).split("出荷分")[0];
  let m=text.match(/令和\s*(元|\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/),year,month,day;
  if(m){year=(m[1]==="元"?1:Number(m[1]))+2018;month=Number(m[2]);day=Number(m[3]);}
  else {m=text.match(/(\d{4})\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);if(m){year=Number(m[1]);month=Number(m[2]);day=Number(m[3]);}}
  if(!m){if(/\d|元/.test(text))throw Error("出荷日の記入が途中です。年月日を全て入力するか、日付欄を空欄にしてください");return fallback;}
  const date=String(year).padStart(4,"0")+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0");
  if(!s1ValidDate(date))throw Error("出荷日が正しくありません："+title);return date;
}
function parseS1ShippingWorkbook(workbook,fallbackDate){
  if(!s1ValidDate(fallbackDate))throw Error("出荷日を入力してください");
  const sheet=workbook.Sheets?.["出荷指示依頼書"];
  if(!sheet)throw Error("「出荷指示依頼書」シートがありません");
  const end=Number((sheet["!ref"]||"").match(/\d+$/)?.[0]||31);
  if(end>10000)throw Error("シートの行数が多すぎます。指定の出荷依頼書を使用してください");
  const cell=(col,row)=>sheet[col+row];
  function value(col,row){const c=cell(col,row);if(c?.t==="e" || c?.f&&c.v===undefined)throw Error(col+row+"の数式結果を確認し、Excelで再計算・保存してください");return c?.v??"";}
  const configs=[{code:"0020",title:"A1",header:2,start:3,end:16,cols:["A","B","C","D"]},{code:"0160",title:"A17",header:18,start:19,end,cols:["A","B","C","D"]},{code:"0050",title:"G1",header:2,start:3,end:16,cols:["G","H","I","J"]},{code:"社内",title:"G17",header:18,start:19,end,cols:["G","H","I","J"]}];
  return configs.map(c=>{
    const title=s1Normalize(sheet[c.title]?.v),match=title.match(/出荷分\s*(0020|0160|0050|社内)\s*$/);
    if(!match || match[1]!==c.code)throw Error(c.title+"の出荷先見出しを確認してください（"+c.code+"）");
    const expected=["商品コード","jan","商品名","数量"];
    c.cols.forEach((col,i)=>{if(s1Name(value(col,c.header))!==expected[i])throw Error(col+c.header+"の見出しが異なります。元の4区画の形式で保存してください");});
    const postingDate=s1HeaderDate(title,fallbackDate),rows=[];
    for(let row=c.start;row<=c.end;row++){
      let raw=value(c.cols[3],row);if(s1Normalize(raw)==="")continue;
      let text=s1Normalize(raw);if(/^\d{1,3}(,\d{3})+$/.test(text))text=text.replace(/,/g,"");
      if(typeof raw==="boolean")throw Error(c.cols[3]+row+"の数量は整数で入力してください");
      const qty=inventoryQuantity(text,c.code+"・"+c.cols[3]+row+"の数量");if(!qty)continue;
      const code=s1Normalize(value(c.cols[0],row)),barcode=s1Normalize(value(c.cols[1],row)),name=s1Normalize(value(c.cols[2],row));
      if(!code || !barcode || !name)throw Error(c.code+"・"+row+"行目の商品コード・JAN・商品名を入力してください");
      if(!validEan13(barcode))throw Error(c.cols[1]+row+"のJAN番号が正しくありません");
      rows.push({code,barcode,name,qty,sourceRow:row,quantityCell:c.cols[3]+row});
    }
    return {destinationCode:c.code,postingDate,rows};
  });
}
function s1ProductState(p){return JSON.stringify([p.name||"",String(p.code||""),p.unit||"",p.price??null,p.barcode||"",[...(p.barcodeAliases||[])].sort()]);}
function s1DestinationFields(p,code){return {partner:p?.partner||p?.shipTo||code,partnerAddress:p?.partnerAddress||"",partnerTel:p?.partnerTel||"",shipTo:p?.shipTo||p?.partner||code};}
function s1DestinationState(p){return JSON.stringify(p?[p.partner||"",p.partnerAddress||"",p.partnerTel||"",p.shipTo||"",Number(p.revision||0)]:null);}
function matchS1Products(groups,products){
  const warnings=[],states={},mapped=[];
  for(const group of groups){
    const items=[],seen=new Set();
    for(const row of group.rows){
      const byCode=products.filter(p=>s1Normalize(p.code)===row.code),byJan=products.filter(p=>p.barcode===row.barcode||(p.barcodeAliases||[]).includes(row.barcode));
      if(byCode.length!==1)throw Error(group.destinationCode+"・"+row.sourceRow+"行：商品コード「"+row.code+"」が未登録か重複しています");
      const p=byCode[0];
      if(byJan.length!==1 || byJan[0].id!==p.id)throw Error(group.destinationCode+"・"+row.sourceRow+"行：商品コードとJANの登録先が一致しません");
      if(seen.has(p.id))throw Error(group.destinationCode+"：同じ商品が複数行あります。数量を1行にまとめてください");seen.add(p.id);
      const price=Number(p.price);if(p.price==null||!Number.isFinite(price)||price<0)throw Error("商品マスタの売価を確認してください："+p.name);
      if(s1Name(row.name)!==s1Name(p.name))warnings.push(group.destinationCode+"・"+row.sourceRow+"行：商品名の表記が異なります。コードとJANが一致した「"+p.name+"」で作成します。");
      states[p.id]=s1ProductState(p);
      items.push({productId:p.id,productName:p.name,code:String(p.code||""),unit:p.unit||"個",plannedQty:row.qty,checkedQty:0,checked:false,unitPrice:price,remark:""});
    }
    if(items.length){if(items.reduce((n,i)=>n+i.plannedQty,0)>INSPECTION_UNIT_LIMIT)throw Error(group.destinationCode+"の合計が300個を超えています。検品JANを発行できるよう依頼を分けてください");mapped.push({destinationCode:group.destinationCode,postingDate:group.postingDate,items});}
  }
  if(!mapped.length)throw Error("数量が入力されていません。D列・J列に出荷数量を入力し、Excelを保存してから選択してください（空欄・0は取り込みません）");
  const totals=new Map();mapped.forEach(g=>g.items.forEach(i=>totals.set(i.productId,(totals.get(i.productId)||0)+i.plannedQty)));
  for(const [id,qty] of totals){const p=products.find(p=>p.id===id);if(qty>Number(p.currentStock||0)-Number(p.reservedStock||0))warnings.push(p.name+"：今回の出荷合計"+qty+"が現在の利用可能在庫を超えています。在庫の減算可否は検品完了時に再確認します。");}
  return {groups:mapped,states,warnings};
}
async function s1Digest(text){const bytes=new TextEncoder().encode(text);return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");}
function clearS1ImportPreview(){s1ImportGeneration++;s1ImportPlan=null;document.getElementById("s1ImportApplyBtn").disabled=true;document.getElementById("s1ImportPreview").replaceChildren();document.getElementById("s1ImportStatus").textContent="";}
function setS1Busy(busy){s1ImportBusy=busy;for(const id of ["s1ImportFile","s1ImportDate","s1ImportReference","s1ImportPreviewBtn"])document.getElementById(id).disabled=busy;document.getElementById("s1ImportApplyBtn").disabled=busy||!s1ImportPlan;}
function showS1Preview(plan){
  const host=document.getElementById("s1ImportPreview");host.replaceChildren();
  for(const g of plan.groups){const box=document.createElement("div");box.className="s1-import-group";
    const heading=document.createElement("h4");heading.textContent=`出荷先 ${g.destinationCode} ／ ${g.destination.shipTo} ／ ${g.postingDate} ／ ${g.items.reduce((n,i)=>n+i.plannedQty,0)}個`;box.appendChild(heading);
    const table=document.createElement("table");table.className="slip-detail-table";table.innerHTML="<thead><tr><th>商品コード</th><th>商品名</th><th>出荷数</th><th>売価</th></tr></thead>";
    const body=document.createElement("tbody");g.items.forEach(i=>{const tr=document.createElement("tr");for(const text of [i.code,i.productName,String(i.plannedQty)+i.unit,"¥"+i.unitPrice.toLocaleString("ja-JP")]){const td=document.createElement("td");td.textContent=text;tr.appendChild(td);}body.appendChild(tr);});table.appendChild(body);box.appendChild(table);host.appendChild(box);
  }
  for(const message of plan.warnings){const p=document.createElement("p");p.className="s1-import-warning";p.textContent=message;host.appendChild(p);}
}
async function previewS1ShippingImport(){
  if(s1ImportBusy)return;clearS1ImportPreview();const generation=s1ImportGeneration;
  const file=document.getElementById("s1ImportFile").files[0],date=document.getElementById("s1ImportDate").value,reference=s1Normalize(document.getElementById("s1ImportReference").value);
  if(!file)return showToast("Excelファイルを選択してください");
  if(!reference || reference.length>100)return showToast("依頼番号を100文字以内で入力してください。同じ依頼の再取込を防ぐ番号です");
  if(file.size>20*1024*1024)return showToast("Excelファイルは20MB以下にしてください");
  if(typeof XLSX==="undefined")return showToast("Excel読込機能を読み込めませんでした。再読み込みしてください");
  setS1Busy(true);document.getElementById("s1ImportStatus").textContent="数量・商品・出荷先を照合しています…";
  try{
    const buffer=await file.arrayBuffer(),book=XLSX.read(buffer,{type:"array"}),parsed=parseS1ShippingWorkbook(book,date);
    const docs=await db.collection(COLLECTION).get({source:"server"}),products=docs.docs.map(d=>({id:d.id,...d.data()})),plan=matchS1Products(parsed,products);
    for(const group of plan.groups){
      const master=await db.collection(DESTINATIONS_COLLECTION).doc(group.destinationCode).get({source:"server"});
      group.masterState=s1DestinationState(master.exists?master.data():null);group.historyId=null;
      let destination=master.exists?master.data():null;
      if(!destination){const previous=await db.collection(SLIPS_COLLECTION).where("destinationCode","==",group.destinationCode).get({source:"server"});const history=previous.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.type==="out").sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));if(history.length){destination=history[0];group.historyId=history[0].id;group.historyState=s1DestinationState(destination);}}
      group.destination=s1DestinationFields(destination,group.destinationCode);
      if(!destination)plan.warnings.push(group.destinationCode+"：出荷先台帳・履歴がないため、出荷先名を「"+group.destinationCode+"」として作成します。住所は空欄です。");
      const key=await s1Digest(JSON.stringify(["S1-v1",reference,group.postingDate,group.destinationCode]));
      group.id="s1-"+key;group.slipNumber="SYK-S1-"+group.postingDate.replace(/-/g,"")+"-"+group.destinationCode+"-"+key.slice(0,8);
      const existing=await db.collection(SLIPS_COLLECTION).doc(group.id).get({source:"server"});
      if(existing.exists)throw Error(group.destinationCode+"：この依頼番号・出荷日の伝票は作成済みです（"+existing.data().slipNumber+"）。新しい依頼なら依頼番号を変更してください");
    }
    if(generation!==s1ImportGeneration)return;
    plan.reference=reference;plan.fileName=file.name;plan.sourceSheet="出荷指示依頼書";s1ImportPlan=plan;
    showS1Preview(plan);document.getElementById("s1ImportStatus").textContent=plan.groups.length+"件の出荷伝票を作成します。出荷先・日付・数量を確認して下の作成ボタンを押してください。";
  }catch(e){if(generation===s1ImportGeneration)document.getElementById("s1ImportStatus").textContent=e.message||"ファイルを読み込めませんでした";}
  finally{setS1Busy(false);}
}
async function commitS1ShippingImport(plan){
  if(!inventoryWritesAllowed())throw Error("現在は登録できません");
  const refs=plan.groups.map(g=>db.collection(SLIPS_COLLECTION).doc(g.id));
  await db.runTransaction(async tx=>{
    await requireNoActiveReset(tx);
    const existing=[];for(const ref of refs)existing.push(await tx.get(ref));
    const products=new Map();for(const id of Object.keys(plan.states))products.set(id,await tx.get(db.collection(COLLECTION).doc(id)));
    const destinations=[];
    for(const g of plan.groups){const master=await tx.get(db.collection(DESTINATIONS_COLLECTION).doc(g.destinationCode));const history=g.historyId?await tx.get(db.collection(SLIPS_COLLECTION).doc(g.historyId)):null;destinations.push({master,history});}
    plan.groups.forEach((g,i)=>{
      if(existing[i].exists)throw Error(g.destinationCode+"の依頼は既に取り込まれています。伝票一覧を確認してください");
      const {master,history}=destinations[i];
      if(s1DestinationState(master.exists?master.data():null)!==g.masterState || g.historyId&&(!history.exists||s1DestinationState(history.data())!==g.historyState))throw Error(g.destinationCode+"の出荷先情報が変更されました。もう一度内容を確認してください");
      for(const item of g.items){const product=products.get(item.productId);if(!product?.exists||s1ProductState(product.data())!==plan.states[item.productId])throw Error(item.productName+"の商品情報が変更されました。もう一度内容を確認してください");}
    });
    const stamp=firebase.firestore.FieldValue.serverTimestamp();
    plan.groups.forEach((g,i)=>tx.set(refs[i],{type:"out",status:"draft",slipNumber:g.slipNumber,destinationCode:g.destinationCode,...g.destination,postingDate:g.postingDate,transactionType:"出荷",warehouse:"",orderNo:plan.reference,memo:"S1出荷指示依頼書から取込",items:g.items,staff:currentStaffName,createdAt:stamp,sourceImport:{format:"S1-v1",reference:plan.reference,fileName:plan.fileName,sheet:plan.sourceSheet}}));
  });
  return refs.map(r=>r.id);
}
async function applyS1ShippingImport(){
  if(s1ImportBusy||!s1ImportPlan)return;
  const plan=s1ImportPlan;if(!confirm(plan.groups.length+"件の出荷伝票を作成します。在庫は検品完了時に反映します。よろしいですか？"))return;
  setS1Busy(true);
  try{await commitS1ShippingImport(plan);const count=plan.groups.length;clearS1ImportPreview();document.getElementById("s1ImportStatus").textContent=count+"件の出荷伝票を作成しました。一覧から開き、出荷指示書・検品JANを発行してください。";showToast(count+"件の出荷伝票を作成しました");}
  catch(e){clearS1ImportPreview();document.getElementById("s1ImportStatus").textContent=(e.message||"登録結果を確認できませんでした")+"\n伝票一覧を確認し、再実行する場合も同じ依頼番号を使用してください。";}
  finally{setS1Busy(false);}
}
function initS1ShippingImport(){
  const now=new Date();document.getElementById("s1ImportDate").value=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
  document.getElementById("s1ImportFile").addEventListener("change",()=>{clearS1ImportPreview();const file=document.getElementById("s1ImportFile").files[0];if(file)document.getElementById("s1ImportReference").value=file.name.replace(/\.[^.]+$/,"");});
  for(const id of ["s1ImportDate","s1ImportReference"])document.getElementById(id).addEventListener("input",clearS1ImportPreview);
  document.getElementById("s1ImportPreviewBtn").addEventListener("click",previewS1ShippingImport);
  document.getElementById("s1ImportApplyBtn").addEventListener("click",applyS1ShippingImport);
  auth.onAuthStateChanged(()=>{clearS1ImportPreview();});
}

// 納品書PDF読取。PDF本体は送信せず、端末内でページを描画・OCRする。
let invoicePdfBusy=false,invoicePdfGeneration=0,invoicePdfSource=null,invoicePdfPlan=null,invoiceLibraryPromise=null;
function invoiceText(v){return String(v??"").normalize("NFKC").trim();}
function invoiceDigits(v){return invoiceText(v).replace(/\s+/g,"").match(/^\d+$/)?.[0]||"";}
function invoiceOrderNumber(s){return s.customerOrderNo??(s.sourceImport?.format==="S1-v1"?"":s.orderNo||"");}
function invoiceTradeText(s){return [s.transactionType,s.transactionTypeName].filter(Boolean).join(" ／ ");}
function invoiceHandlingText(s){return [s.handlingCode,s.partner].filter(Boolean).join(" ／ ");}
function invoiceShipText(s){return [s.destinationCode,s.shipTo||s.partner].filter(Boolean).join(" ／ ");}
function parseInvoiceParty(text,label){
  let value=invoiceText(text).replace(new RegExp("^.*?"+label+"\\s*[:：]?\\s*"),"").replace(/[|｜]/g," ").trim();
  const end=value.match(/(?:様\s*)?(\d{3,12})\s*$/);
  return {code:end?end[1]:"",name:(end?value.slice(0,end.index):value).replace(/様\s*$/,"").replace(/\s+/g," ").trim()};
}
function parseInvoiceDate(text){
  const m=invoiceText(text).match(/\b(\d{2}|\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})\b/);
  if(!m)return "";let year=Number(m[1]);if(year<100)year+=2000;
  const value=year+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0");return s1ValidDate(value)?value:"";
}
function parseInvoiceTsv(tsv,width,height){
  const rows=String(tsv||"").trim().split(/\r?\n/),head=(rows.shift()||"").split("\t"),idx=Object.fromEntries(head.map((k,i)=>[k,i]));
  if(!["text","level","left","top","width","height"].every(k=>k in idx))return [];
  return rows.flatMap(line=>{const a=line.split("\t"),text=a.slice(idx.text).join("\t").trim();
    if(Number(a[idx.level])!==5||!text)return[];
    const x=Number(a[idx.left])/width,y=Number(a[idx.top])/height,w=Number(a[idx.width])/width,h=Number(a[idx.height])/height;
    return [x,y,w,h].every(Number.isFinite)?[{text,x,y,w,h}]:[];
  });
}
function invoiceRegionText(words,[x,y,w,h]){
  return words.filter(a=>a.x+a.w/2>=x&&a.x+a.w/2<=x+w&&a.y+a.h/2>=y&&a.y+a.h/2<=y+h).sort((a,b)=>Math.abs(a.y-b.y)>.015?a.y-b.y:a.x-b.x).map(a=>a.text).join(" ");
}
function invoiceItemsFromWords(words){
  const candidates=words.filter(w=>w.x>=.105&&w.x<.179&&w.y>=.39&&w.y<.79&&/^\d{2,12}$/.test(invoiceText(w.text))).sort((a,b)=>a.y-b.y||a.x-b.x),anchors=[];
  for(const w of candidates){const center=w.y+w.h/2;let row=anchors.find(r=>Math.abs(r.y-center)<.012);if(!row){row={y:center,parts:[]};anchors.push(row);}row.parts.push(w);}
  return anchors.map(row=>{
    const at=(left,right)=>words.filter(w=>Math.abs(w.y+w.h/2-row.y)<.016&&w.x+w.w/2>=left&&w.x+w.w/2<right).sort((a,b)=>a.x-b.x).map(w=>w.text).join("");
    const price=invoiceText(at(.521,.607)).replace(/[,，¥￥\s]/g,"");
    return {code:row.parts.sort((a,b)=>a.x-b.x).map(w=>w.text).join(""),name:at(.18,.521),qty:invoiceDigits(at(.607,.681)),price:/^\d+(\.\d+)?$/.test(price)?price:""};
  }).slice(0,50);
}
const INVOICE_REGIONS={sourceNo:[.881,.128,.065,.021],transactionCode:[.116,.317,.037,.025],transactionName:[.179,.316,.136,.029],orderNo:[.398,.317,.035,.027],warehouse:[.317,.316,.029,.029],ship:[.111,.141,.482,.024],handling:[.111,.188,.482,.024]};
function invoiceExtractFields(words,text,regions={}){
  const r=key=>regions[key]??invoiceRegionText(words,INVOICE_REGIONS[key]);
  const ship=parseInvoiceParty(r("ship"),"出荷先"),handling=parseInvoiceParty(r("handling"),"取扱先");
  return {sourceNo:invoiceDigits(r("sourceNo")),transactionCode:invoiceDigits(r("transactionCode")),transactionName:invoiceText(r("transactionName")).replace(/[|｜]/g,"").trim(),orderNo:invoiceDigits(r("orderNo")),warehouse:invoiceDigits(r("warehouse")),shipCode:ship.code,shipName:ship.name,handlingCode:handling.code,handlingName:handling.name,postingDate:parseInvoiceDate(text),partnerAddress:"",partnerTel:""};
}
async function loadInvoiceLibraries(){
  if(invoiceLibraryPromise)return invoiceLibraryPromise;
  invoiceLibraryPromise=(async()=>{
    const pdfjs=await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
    return pdfjs;
  })().catch(e=>{invoiceLibraryPromise=null;throw e;});return invoiceLibraryPromise;
}
async function loadInvoiceOcr(){
  if(window.Tesseract)return window.Tesseract;
  await new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";script.async=true;const timer=setTimeout(()=>{script.remove();reject(Error("OCR機能の読込がタイムアウトしました"));},60000);script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error("OCR機能を読み込めませんでした。通信を確認してください"));};document.head.appendChild(script);});
  if(!window.Tesseract)throw Error("OCR機能を初期化できませんでした");return window.Tesseract;
}
function invoiceCrop(canvas,[x,y,w,h]){
  const out=document.createElement("canvas"),padding=20;
  const width=Math.max(1,Math.round(w*canvas.width)),height=Math.max(1,Math.round(h*canvas.height));out.width=width+padding*2;out.height=height+padding*2;
  const ctx=out.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,Math.round(x*canvas.width),Math.round(y*canvas.height),width,height,padding,padding,width,height);return out;
}
function invoiceFieldIds(){return {sourceNo:"pdfInvoiceSourceNo",transactionCode:"pdfInvoiceTransactionCode",transactionName:"pdfInvoiceTransactionName",orderNo:"pdfInvoiceOrderNo",shipCode:"pdfInvoiceShipCode",shipName:"pdfInvoiceShipName",handlingCode:"pdfInvoiceHandlingCode",handlingName:"pdfInvoiceHandlingName",deliveryDate:"pdfInvoiceDeliveryDate",deliveryTime:"pdfInvoiceDeliveryTime",postingDate:"pdfInvoicePostingDate",warehouse:"pdfInvoiceWarehouse",partnerAddress:"pdfInvoiceAddress",partnerTel:"pdfInvoiceTel"};}
function invoiceActionMessage(message,error=false,scroll=false){
  document.getElementById("pdfInvoiceStatus").textContent=message;
  const status=document.getElementById("pdfInvoiceActionStatus");
  status.textContent=message;status.hidden=!message;
  status.className=error?"invoice-action-error":"invoice-action-info";
  if(scroll)status.scrollIntoView?.({block:"nearest",behavior:"smooth"});
}
function invalidateInvoicePlan(){invoicePdfPlan=null;document.getElementById("pdfInvoiceSaveBtn").disabled=invoicePdfBusy;document.getElementById("pdfInvoiceActionStatus").textContent="";document.getElementById("pdfInvoiceActionStatus").hidden=true;document.getElementById("pdfInvoiceConfirmed").checked=false;document.getElementById("pdfInvoicePreview").textContent="";}
function clearInvoicePdf(){
  invoicePdfGeneration++;invoicePdfSource={format:"manual-v1"};invalidateInvoicePlan();
  for(const kind of Object.keys(manualLookupKinds)){manualLookupEpoch[kind]++;clearTimeout(manualLookupTimers[kind]);manualLookupMessage(kind,"");}
  document.getElementById("pdfInvoiceForm").hidden=false;document.getElementById("pdfInvoiceItems").replaceChildren();
  for(const id of Object.values(invoiceFieldIds()))document.getElementById(id).value="";
  document.getElementById("pdfInvoicePostingDate").value=todayDateInputValue();
  document.getElementById("pdfInvoiceWarehouse").value="01";
  document.getElementById("manualManagementNumber").value="";
  document.getElementById("pdfInvoiceRawText").value="";document.getElementById("pdfInvoiceStatus").textContent="";
  document.getElementById("pdfInvoiceCanvas").hidden=true;appendInvoiceItem();
}
function setInvoiceBusy(busy){invoicePdfBusy=busy;for(const id of ["pdfInvoiceFile","pdfInvoicePage","pdfInvoiceReadBtn","pdfInvoiceValidateBtn","pdfInvoiceAddItemBtn"])document.getElementById(id).disabled=busy;document.getElementById("pdfInvoiceForm").disabled=busy;document.getElementById("manualNewBtn").disabled=busy;const save=document.getElementById("pdfInvoiceSaveBtn");save.disabled=busy;save.textContent=busy?"処理中…":"確認した内容で出荷伝票を作成";}
function syncInvoiceItemName(tr,forcePrice=false){
  const fields=Object.fromEntries([...tr.querySelectorAll("input[data-field]")].map(input=>[input.dataset.field,input]));
  const status=tr.querySelector(".invoice-code-status");
  if(!fields.code||!fields.name||!status)return false;
  const code=invoiceText(fields.code.value).toUpperCase();
  const products=typeof allProducts!=="undefined"?allProducts:[];
  const matches=code?products.filter(p=>invoiceText(p.code).toUpperCase()===code):[];
  const name=matches.length===1?String(matches[0].name||""):"";
  const id=matches.length===1?matches[0].id:"";
  let priceChanged=false;
  if(fields.price){
    const before=fields.price.value;
    const price=matches.length===1?matches[0].price:null;
    const valid=price!==null&&price!==undefined&&String(price).trim()!==""&&Number.isFinite(Number(price))&&Number(price)>=0;
    if(forcePrice||!before||before===tr.dataset.autoPrice){
      fields.price.value=valid?String(Number(price)):"";
      tr.dataset.autoPrice=fields.price.value;
    }
    priceChanged=before!==fields.price.value;
  }
  const changed=priceChanged || fields.name.value!==name || (tr.dataset.productId||"")!==id;
  fields.name.value=name;tr.dataset.productId=id;
  status.textContent=!code?"商品コードを入力してください":matches.length===1?"商品一覧と一致しました":matches.length>1?"同じ商品コードが複数登録されています":"商品一覧に一致するコードがありません";
  status.className="invoice-code-status "+(matches.length===1?"invoice-code-found":"invoice-code-missing");
  return changed;
}
function refreshInvoiceProductNames(){
  const host=document.getElementById("pdfInvoiceItems");if(!host)return;
  let changed=false;host.querySelectorAll(".pdf-invoice-item").forEach(tr=>{if(syncInvoiceItemName(tr))changed=true;});
  if(changed)invalidateInvoicePlan();
}
function appendInvoiceItem(row={}){
  const tr=document.createElement("tr");tr.className="pdf-invoice-item";
  for(const [key,label] of [["code","商品コード"],["name","商品名"],["price","単価"],["qty","数量"]]){const td=document.createElement("td"),input=document.createElement("input");input.type="text";input.dataset.field=key;input.value=String(row[key]??"");input.setAttribute("aria-label",label);input.placeholder=label;input.addEventListener("input",()=>{invalidateInvoicePlan();if(key==="code")syncInvoiceItemName(tr,true);});
    if(key==="code")input.addEventListener("change",()=>{invalidateInvoicePlan();syncInvoiceItemName(tr,true);});
    if(key==="price"){input.placeholder="商品コードから自動入力";input.title="商品一覧の単価を自動入力します。手動修正もできます。PDF読取済みの単価は、コードを変更するまでは保持します。";}
    if(key==="name"){input.placeholder="商品コードから自動表示";input.title=row.name?"PDF読取商品名："+row.name:"商品一覧から自動表示します";}
    td.appendChild(input);
    if(key==="code"){const status=document.createElement("small");status.className="invoice-code-status";status.setAttribute("role","status");status.setAttribute("aria-live","polite");td.appendChild(status);}
    tr.appendChild(td);}
  const td=document.createElement("td"),remove=document.createElement("button");remove.type="button";remove.textContent="削除";remove.addEventListener("click",()=>{tr.remove();invalidateInvoicePlan();});td.appendChild(remove);tr.appendChild(td);document.getElementById("pdfInvoiceItems").appendChild(tr);
  syncInvoiceItemName(tr);
  const fields=Object.fromEntries([...tr.querySelectorAll("input[data-field]")].map(i=>[i.dataset.field,i]));
  fields.code.addEventListener("keydown",e=>{if(e.key!=="Enter")return;e.preventDefault();syncInvoiceItemName(tr,true);(fields.price.value?fields.qty:fields.price).focus();});
  fields.qty.addEventListener("keydown",e=>{if(e.key!=="Enter")return;e.preventDefault();if(!fields.code.value||!fields.price.value||!/^\d+$/.test(invoiceText(fields.qty.value))||Number(fields.qty.value)<1){invoiceActionMessage("商品コード・単価と1以上の数量を入力してください",true);return;}appendInvoiceItem();const rows=document.getElementById("pdfInvoiceItems").querySelectorAll(".pdf-invoice-item");rows[rows.length-1].querySelector('input[data-field="code"]').focus();invalidateInvoicePlan();});
}
async function readInvoicePdf(){
  if(invoicePdfBusy)return;clearInvoicePdf();const generation=invoicePdfGeneration;
  const file=document.getElementById("pdfInvoiceFile").files[0],pageNumber=Number(document.getElementById("pdfInvoicePage").value);
  if(!file)return showToast("納品書PDFを選択してください");
  if(file.size>20*1024*1024)return showToast("PDFは20MB以下にしてください");
  if(!Number.isSafeInteger(pageNumber)||pageNumber<1)return showToast("ページ番号を1以上の整数で入力してください");
  setInvoiceBusy(true);const status=document.getElementById("pdfInvoiceStatus");let pdf=null,worker=null;
  try{
    status.textContent="PDFを読み込んでいます…";
    const buffer=await file.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",buffer))].map(x=>x.toString(16).padStart(2,"0")).join("");
    const pdfjs=await loadInvoiceLibraries();pdf=await pdfjs.getDocument({data:new Uint8Array(buffer)}).promise;
    if(pageNumber>pdf.numPages)throw Error("このPDFは"+pdf.numPages+"ページです。ページ番号を確認してください");
    const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1}),scale=3200/Math.max(base.width,base.height),viewport=page.getViewport({scale});
    const canvas=document.getElementById("pdfInvoiceCanvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
    if(generation!==invoicePdfGeneration)return;
    document.getElementById("pdfInvoiceForm").hidden=false;
    const content=await page.getTextContent();let words=(content.items||[]).filter(i=>i.str?.trim()).map(i=>{const [x,y]=viewport.convertToViewportPoint(i.transform[4],i.transform[5]);return {text:i.str,x:x/canvas.width,y:(y-i.height*scale)/canvas.height,w:i.width*scale/canvas.width,h:i.height*scale/canvas.height};});
    let text=words.map(w=>w.text).join("\n"),regions={};
    if(text.replace(/\s/g,"").length<80){
      status.textContent="スキャン画像を読み取っています。初回は日本語データの準備に時間がかかります…";
      const T=await loadInvoiceOcr();
      worker=await T.createWorker("jpn+eng",1,{workerPath:"https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",langPath:"https://tessdata.projectnaptha.com/4.0.0",logger:m=>{if(generation===invoicePdfGeneration&&m.status==="recognizing text")status.textContent="画像の文字を読取中… "+Math.round(m.progress*100)+"％";}});
      await worker.setParameters({tessedit_pageseg_mode:"11"});
      const result=await worker.recognize(canvas,{}, {text:true,tsv:true});text=result.data.text||"";words=parseInvoiceTsv(result.data.tsv,canvas.width,canvas.height);
      for(const key of ["sourceNo","transactionCode","orderNo","warehouse","transactionName","ship","handling"]){
        const digits=["sourceNo","transactionCode","orderNo","warehouse"].includes(key);
        await worker.setParameters({tessedit_pageseg_mode:"7",tessedit_char_whitelist:digits?"0123456789":""});
        const r=await worker.recognize(invoiceCrop(canvas,INVOICE_REGIONS[key]));regions[key]=r.data.text||"";
      }
    }
    if(generation!==invoicePdfGeneration)return;
    const fields=invoiceExtractFields(words,text,regions);
    for(const [key,id] of Object.entries(invoiceFieldIds()))document.getElementById(id).value=fields[key]||"";
    const rows=invoiceItemsFromWords(words);document.getElementById("pdfInvoiceItems").replaceChildren();(rows.length?rows:[{}]).forEach(appendInvoiceItem);
    document.getElementById("pdfInvoiceCanvas").hidden=false;syncManualManagementNumber();
    document.getElementById("pdfInvoiceRawText").value=text;
    invoicePdfSource={digest,fileName:file.name,page:pageNumber};
    status.textContent=`${pageNumber}/${pdf.numPages}ページを読み取りました。原本と照合し、番号・コード・名称・数量を修正してください。太枠や薄い文字は誤読することがあります。`;
  }catch(e){status.textContent=(e.message||"PDFを読み取れませんでした")+"。通信・PDF形式を確認して再実行してください。";}
  finally{if(worker)await worker.terminate().catch(()=>{});if(pdf)await pdf.destroy().catch(()=>{});setInvoiceBusy(false);}
}
function collectInvoiceForm(){
  const fields=Object.fromEntries(Object.entries(invoiceFieldIds()).map(([key,id])=>[key,invoiceText(document.getElementById(id).value)]));
  const rows=[...document.getElementById("pdfInvoiceItems").querySelectorAll(".pdf-invoice-item")].map(tr=>Object.fromEntries([...tr.querySelectorAll("input[data-field]")].map(i=>[i.dataset.field,invoiceText(i.value)])));
  return {fields,rows:rows.filter(r=>Object.values(r).some(value=>invoiceText(value)))};
}
function invoiceFormSignature(){return JSON.stringify(collectInvoiceForm());}
function validateInvoiceData(input){
  const f={...input.fields,deliveryDate:invoiceText(input.fields.deliveryDate),deliveryTime:invoiceText(input.fields.deliveryTime)};
  if(f.deliveryDate&&!s1ValidDate(f.deliveryDate))throw Error("配達指定日を確認してください");
  if(f.deliveryTime.length>80)throw Error("指定時間は80文字以内で入力してください");
  if(!/^[A-Za-z0-9_-]{1,40}$/.test(f.sourceNo))throw Error("納品書の伝票番号を確認してください");
  if(!/^\d{3}$/.test(f.transactionCode))throw Error("取引区分は050など3桁の数字で入力してください");
  if(!s1ValidDate(f.postingDate))throw Error("計上日を確認してください");
  if(!f.transactionName)throw Error("取引区分名を入力してください");
  const destinationCode=normalizeDestinationCode(f.shipCode),handlingCode=normalizeDestinationCode(f.handlingCode);
  if(!f.shipName||!f.handlingName)throw Error("出荷先名と取扱先名を入力してください");
  if(!input.rows.length)throw Error("商品明細を追加してください");
  const missing=[];input.rows.forEach((r,i)=>{for(const [field,label] of [["code","商品コード"],["qty","数量"],["price","単価"]])if(!invoiceText(r[field]))missing.push("明細"+(i+1)+"の"+label);});
  if(missing.length)throw Error("未入力の項目があります：\n"+missing.join("、")+"\n入力後、もう一度照合してください。");
  const rows=input.rows.map((r,index)=>{const qty=inventoryQuantity(r.qty,"明細"+(index+1)+"の数量");if(!qty||!r.code)throw Error("各明細の商品コードと1以上の数量を入力してください");const raw=r.price.replace(/[,，¥￥\s]/g,"");if(!/^\d+(\.\d+)?$/.test(raw)||!Number.isFinite(Number(raw)))throw Error("各明細の単価を確認してください");return {...r,qty,price:Number(raw)};});
  if(rows.reduce((n,r)=>n+r.qty,0)>INSPECTION_UNIT_LIMIT)throw Error("検品できる数量は1伝票300個までです");
  return {fields:{...f,shipCode:destinationCode,handlingCode},rows};
}
async function prepareInvoiceImport(input,source){
  source=source||{format:"manual-v1"};const checked=validateInvoiceData(input);
  const docs=await db.collection(COLLECTION).get({source:"server"}),products=docs.docs.map(d=>({id:d.id,...d.data()})),states={},seen=new Set();
  const items=checked.rows.map(r=>{const matches=products.filter(p=>invoiceText(p.code).toUpperCase()===invoiceText(r.code).toUpperCase());if(matches.length!==1)throw Error("商品コード「"+r.code+"」が未登録か重複しています。登録済みのコードへ修正してください");const p=matches[0];const rowKey=p.id;if(seen.has(rowKey))throw Error("同じ商品が複数行あります。数量を1行にまとめてください");seen.add(rowKey);states[p.id]=s1ProductState(p);return {productId:p.id,productName:p.name,code:String(p.code),unit:p.unit||"個",plannedQty:r.qty,checkedQty:0,checked:false,unitPrice:r.price,remark:"",sourceProductName:r.name};});
  const f=checked.fields,masters=await prepareManualMasters(f),key=await s1Digest(JSON.stringify(["invoice-pdf-v1",f.postingDate.slice(0,4),f.sourceNo])),id="pdf-"+key;
  const existing=await db.collection(SLIPS_COLLECTION).doc(id).get({source:"server"});if(existing.exists)throw Error("同じ年・伝票番号の納品書は登録済みです。既存の出荷伝票を確認してください");
  return {id,fields:f,items,states,masters,source:{...source},slipNumber:f.sourceNo};
}
async function confirmInvoiceRead(){
  if(invoicePdfBusy)return;invalidateInvoicePlan();setInvoiceBusy(true);
  try{const signature=invoiceFormSignature(),plan=await prepareInvoiceImport(collectInvoiceForm(),invoicePdfSource);if(signature!==invoiceFormSignature())throw Error("入力内容が変わりました。もう一度確認してください");plan.formSignature=signature;invoicePdfPlan=plan;const f=plan.fields;document.getElementById("pdfInvoicePreview").textContent=`伝票番号：${f.sourceNo}\n取引区分：${f.transactionCode} ${f.transactionName}\n受注№：${f.orderNo||"未記入"}\n出荷先：${f.shipCode} ${f.shipName}\n取扱先：${f.handlingCode} ${f.handlingName}\n計上日：${f.postingDate}\n配達指定日：${f.deliveryDate||"指定なし"}\n指定時間：${f.deliveryTime||"指定なし"}\n`+plan.items.map(i=>`${i.code} ${i.productName}　${i.plannedQty}${i.unit}　単価¥${i.unitPrice.toLocaleString()}`).join("\n");invoiceActionMessage("登録商品の名称・単価とコード台帳を照合しました。登録予定内容を確認し、確認チェックを入れて作成してください。",false,true);}
  catch(e){invoiceActionMessage(e.message||"照合できませんでした",true,true);}
  finally{setInvoiceBusy(false);}
}
async function commitInvoiceImport(plan){
  if(!inventoryWritesAllowed())throw Error("現在は登録できません");const ref=db.collection(SLIPS_COLLECTION).doc(plan.id);
  await db.runTransaction(async tx=>{
    await requireNoActiveReset(tx);const existing=await tx.get(ref);if(existing.exists)throw Error("この納品書は既に登録されています");
    for(const [id,state] of Object.entries(plan.states)){const doc=await tx.get(db.collection(COLLECTION).doc(id));if(!doc.exists||s1ProductState(doc.data())!==state)throw Error("商品情報が変わりました。もう一度登録内容を確認してください");}
    const masterReads=await readManualMasters(tx,plan.masters);
    const f=plan.fields;
    writeManualMasters(tx,masterReads,f);
    tx.set(ref,{type:"out",status:"draft",slipNumber:plan.slipNumber,sourceSlipNumber:f.sourceNo,transactionType:f.transactionCode,transactionTypeName:f.transactionName,orderNo:f.orderNo,customerOrderNo:f.orderNo,destinationCode:f.shipCode,shipTo:f.shipName,handlingCode:f.handlingCode,partner:f.handlingName,partnerAddress:f.partnerAddress,partnerTel:f.partnerTel,postingDate:f.postingDate,warehouse:f.warehouse,deliveryDate:f.deliveryDate,deliveryTime:f.deliveryTime,memo:plan.source.format==="manual-v1"?"手入力で確認して作成":"納品書PDFから読取・確認して作成",items:plan.items,staff:currentStaffName,createdAt:firebase.firestore.FieldValue.serverTimestamp(),sourceImport:plan.source.format==="manual-v1"?{format:"manual-v1"}:{format:"invoice-pdf-v1",fileName:plan.source.fileName,digest:plan.source.digest,page:plan.source.page}});
  });return ref.id;
}
async function saveInvoiceImport(){
  if(invoicePdfBusy)return;
  if(!invoicePdfPlan){
    await confirmInvoiceRead();
    if(invoicePdfPlan)invoiceActionMessage("商品マスタとの照合が完了しました。登録予定内容を確認し、確認チェックを入れて、もう一度作成ボタンを押してください。",false,true);
    return;
  }
  const plan=invoicePdfPlan;
  if(plan.formSignature!==invoiceFormSignature()){
    invalidateInvoicePlan();invoiceActionMessage("入力内容が変わりました。もう一度「修正内容を商品マスタと照合」を押してください。",true,true);return;
  }
  if(!document.getElementById("pdfInvoiceConfirmed").checked){
    invoiceActionMessage("登録予定内容の確認チェックを入れてください。",true,true);return;
  }
  setInvoiceBusy(true);invoiceActionMessage("出荷伝票を保存しています…");
  try{await commitInvoiceImport(plan);invoicePdfPlan=null;document.getElementById("pdfInvoiceConfirmed").checked=false;invoiceActionMessage("出荷伝票を作成しました。一覧から開いて出荷指示書を印刷できます。在庫は検品完了時に反映します。",false,true);showToast("出荷伝票を作成しました");}
  catch(e){invalidateInvoicePlan();invoiceActionMessage((e.message||"登録結果を確認できませんでした")+"。再実行前に伝票一覧を確認してください。",true,true);}
  finally{setInvoiceBusy(false);}
}
function initInvoicePdfImport(){
  document.getElementById("pdfInvoiceReadBtn").addEventListener("click",readInvoicePdf);
  for(const id of ["pdfInvoiceFile","pdfInvoicePage"])document.getElementById(id).addEventListener("change",clearInvoicePdf);
  for(const id of Object.values(invoiceFieldIds()))document.getElementById(id).addEventListener("input",invalidateInvoicePlan);
  document.getElementById("pdfInvoiceAddItemBtn").addEventListener("click",()=>{appendInvoiceItem();invalidateInvoicePlan();});
  document.getElementById("pdfInvoiceValidateBtn").addEventListener("click",confirmInvoiceRead);
  document.getElementById("pdfInvoiceSaveBtn").addEventListener("click",saveInvoiceImport);
  initManualShipping();clearInvoicePdf();
  auth.onAuthStateChanged(()=>clearInvoicePdf());
}

// 手入力伝票のコード台帳。既存の出荷先コレクション内で種類を分けて保存する。
const manualLookupKinds={
  ship:{code:'pdfInvoiceShipCode',name:'pdfInvoiceShipName',label:'出荷先',history:'destinationCode',value:'shipTo'},
  handling:{code:'pdfInvoiceHandlingCode',name:'pdfInvoiceHandlingName',label:'取扱先',history:'handlingCode',value:'partner'},
  trade:{code:'pdfInvoiceTransactionCode',name:'pdfInvoiceTransactionName',label:'取引区分',history:'transactionType',value:'transactionTypeName'}
};
let manualCacheGeneration=0;
let manualLookupEpoch={ship:0,handling:0,trade:0},manualLookupTimers={},manualCodeCache=[];
function manualCode(kind,raw){
  const value=invoiceText(raw).toUpperCase();
  if(kind==='trade'){if(!/^\d{3}$/.test(value))throw Error('取引区分コードは3桁の数字で入力してください');return value;}
  return normalizeDestinationCode(value);
}
function manualMasterRef(kind,code){return db.collection(DESTINATIONS_COLLECTION).doc(kind==='ship'?code:kind+':'+code);}
function manualMasterName(kind,data){return invoiceText(kind==='ship'?(data.shipTo||data.partner):kind==='handling'?(data.name||data.partner):(data.name||data.transactionTypeName));}
function manualMasterState(data){return JSON.stringify(data?[data.kind||'',data.code||'',data.name||'',data.shipTo||'',data.partner||'',data.partnerAddress||'',data.partnerTel||'',Number(data.revision||0)]:null);}
async function resolveManualCode(kind,code){
  const doc=await manualMasterRef(kind,code).get({source:'server'});
  if(doc.exists)return {data:doc.data(),state:manualMasterState(doc.data()),fromHistory:false};
  const config=manualLookupKinds[kind];
  const history=await db.collection(SLIPS_COLLECTION).where(config.history,'==',code).get({source:'server'});
  const rows=history.docs.map(d=>d.data()).filter(s=>s.type==='out'&&invoiceText(s[config.value]));
  rows.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)||(b.createdAt?.nanoseconds||0)-(a.createdAt?.nanoseconds||0));
  if(!rows.length)return {data:null,state:manualMasterState(null),fromHistory:false};
  const latest=rows[0],sameTime=rows.filter(s=>(s.createdAt?.seconds||0)===(latest.createdAt?.seconds||0)&&(s.createdAt?.nanoseconds||0)===(latest.createdAt?.nanoseconds||0));
  if(new Set(sameTime.map(s=>invoiceText(s[config.value]))).size>1)throw Error('このコードの履歴に異なる名称があります。正しい名称で台帳へ登録してください');
  return {data:{name:latest[config.value],shipTo:kind==='ship'?latest.shipTo:undefined,partner:latest.partner||'',partnerAddress:kind==='handling'?latest.partnerAddress||'':'',partnerTel:kind==='handling'?latest.partnerTel||'':''},state:manualMasterState(null),fromHistory:true};
}
function manualLookupMessage(kind,text){document.getElementById('manual-'+kind+'-status').textContent=text;}
function manualNameInputs(kind){const c=manualLookupKinds[kind];return [c.name,...(kind==='handling'?['pdfInvoiceAddress','pdfInvoiceTel']:[])];}
async function lookupManualCode(kind){
  const c=manualLookupKinds[kind],input=document.getElementById(c.code),generation=++manualLookupEpoch[kind];
  let code;try{code=manualCode(kind,input.value);}catch(e){manualLookupMessage(kind,e.message);return;}
  const ids=manualNameInputs(kind),signature=JSON.stringify(ids.map(id=>document.getElementById(id).value));
  manualLookupMessage(kind,'検索しています…');
  try{
    const result=await resolveManualCode(kind,code);
    if(generation!==manualLookupEpoch[kind]||invoiceText(input.value).toUpperCase()!==code)return;
    if(signature!==JSON.stringify(ids.map(id=>document.getElementById(id).value))){manualLookupMessage(kind,'検索中に手入力されたため上書きしていません。必要なら「検索」を押してください。');return;}
    if(!result.data){manualLookupMessage(kind,'未登録です。名称を入力し「追加」、または伝票作成時に登録できます。');return;}
    const name=manualMasterName(kind,result.data);
    if(!name)throw Error('登録名称が空です。台帳の内容を確認してください');
    input.value=code;document.getElementById(c.name).value=name;
    if(kind==='handling'){document.getElementById('pdfInvoiceAddress').value=result.data.partnerAddress||'';document.getElementById('pdfInvoiceTel').value=result.data.partnerTel||'';}
    invalidateInvoicePlan();manualLookupMessage(kind,result.fromHistory?'過去の伝票から表示しました。作成時に台帳へ登録します。':'登録済みの名称を表示しました。');
  }catch(e){if(generation===manualLookupEpoch[kind])manualLookupMessage(kind,e.message||'検索できません。通信状態を確認してください。');}
}
function manualMasterPayload(kind,code,name,fields){
  const common={kind,code,name,revision:1,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:currentStaffName};
  if(kind==='ship')return {...common,shipTo:name,partner:name,partnerAddress:'',partnerTel:''};
  if(kind==='handling')return {...common,partner:name,partnerAddress:fields.partnerAddress||'',partnerTel:fields.partnerTel||''};
  return common;
}
async function addManualCode(kind){
  if(invoicePdfBusy||!inventoryWritesAllowed())return;
  const c=manualLookupKinds[kind],fields=collectInvoiceForm().fields;
  let code,name;try{code=manualCode(kind,document.getElementById(c.code).value);name=invoiceText(document.getElementById(c.name).value);if(!name)throw Error(c.label+'名を入力してください');}catch(e){manualLookupMessage(kind,e.message);return;}
  ++manualLookupEpoch[kind];clearTimeout(manualLookupTimers[kind]);
  setInvoiceBusy(true);manualLookupMessage(kind,'登録しています…');
  try{
    const ref=manualMasterRef(kind,code);
    await db.runTransaction(async tx=>{await requireNoActiveReset(tx);const doc=await tx.get(ref);if(doc.exists){if(manualMasterName(kind,doc.data())!==name)throw Error('このコードには別の名称が登録されています。検索し直してください');return;}tx.set(ref,manualMasterPayload(kind,code,name,fields));});
    invalidateInvoicePlan();manualLookupMessage(kind,'登録しました。次回から同じコードで検索できます。');
    await refreshManualCodeLists();
  }catch(e){manualLookupMessage(kind,e.message||'登録できません。通信状態と権限を確認してください。');}
  finally{setInvoiceBusy(false);}
}
async function prepareManualMasters(fields){
  const entries=[];
  for(const [kind,code,name] of [['ship',fields.shipCode,fields.shipName],['handling',fields.handlingCode,fields.handlingName],['trade',fields.transactionCode,fields.transactionName]]){
    const normalized=manualCode(kind,code),doc=await manualMasterRef(kind,normalized).get({source:'server'});
    if(doc.exists&&manualMasterName(kind,doc.data())!==name)throw Error(manualLookupKinds[kind].label+'コード「'+normalized+'」は別の名称で登録されています。コードで検索し直してください');
    entries.push({kind,code:normalized,name,state:manualMasterState(doc.exists?doc.data():null)});
  }
  return entries;
}
async function readManualMasters(tx,entries){
  const result=[];
  for(const entry of entries){const ref=manualMasterRef(entry.kind,entry.code),doc=await tx.get(ref);if(manualMasterState(doc.exists?doc.data():null)!==entry.state)throw Error('コード台帳が変更されています。もう一度照合してください');result.push({entry,ref,exists:doc.exists});}
  return result;
}
function writeManualMasters(tx,reads,fields){for(const {entry,ref,exists} of reads)if(!exists)tx.set(ref,manualMasterPayload(entry.kind,entry.code,entry.name,fields));}
function renderManualCodeLists(){
  const history=[...(typeof allSlips==='undefined'?[]:allSlips)].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  for(const kind of Object.keys(manualLookupKinds)){
    const config=manualLookupKinds[kind],values=new Map();
    for(const s of history)if(s.type==='out'&&s[config.history]&&s[config.value]&&!values.has(String(s[config.history])))values.set(String(s[config.history]),s[config.value]);
    for(const data of manualCodeCache){if((kind==='ship'&&!data.kind)||(data.kind===kind)){const name=manualMasterName(kind,data);if(data.code&&name)values.set(data.code,name);}}
    const list=document.getElementById('manual-'+kind+'-list');list.replaceChildren();
    for(const [code,name] of [...values].sort(([a],[b])=>a.localeCompare(b))){const option=document.createElement('option');option.value=code;option.textContent=name;list.appendChild(option);}
  }
  const warehouses=new Set(['01']);history.forEach(s=>{if(s.warehouse)warehouses.add(String(s.warehouse));});
  const list=document.getElementById('manual-warehouse-list');list.replaceChildren();for(const value of warehouses){const option=document.createElement('option');option.value=value;list.appendChild(option);}
}
async function refreshManualCodeLists(){
  const generation=++manualCacheGeneration;
  try{const docs=await db.collection(DESTINATIONS_COLLECTION).get({source:'server'});if(generation!==manualCacheGeneration)return;manualCodeCache=docs.docs.map(d=>({...d.data(),code:d.data().code||d.id}));renderManualCodeLists();}catch(e){console.error('コード候補を取得できませんでした',e);}
}
function openManualShippingForm(){
  const panel=document.getElementById('pdfInvoicePanel');panel.open=true;
  panel.scrollIntoView?.({block:'start',behavior:'smooth'});document.getElementById('pdfInvoiceShipCode').focus();
}
function syncManualManagementNumber(){document.getElementById('manualManagementNumber').value=document.getElementById('pdfInvoiceSourceNo').value;}
function initManualShipping(){
  document.getElementById('manualNewBtn').addEventListener('click',()=>{clearInvoicePdf();openManualShippingForm();});
  document.getElementById('pdfInvoiceSourceNo').addEventListener('input',syncManualManagementNumber);
  for(const [kind,c] of Object.entries(manualLookupKinds)){
    const input=document.getElementById(c.code);input.addEventListener('input',()=>{
      ++manualLookupEpoch[kind];clearTimeout(manualLookupTimers[kind]);manualNameInputs(kind).forEach(id=>document.getElementById(id).value='');invalidateInvoicePlan();
      manualLookupMessage(kind,'');if(input.value.trim())manualLookupTimers[kind]=setTimeout(()=>lookupManualCode(kind),350);
    });
    input.addEventListener('change',()=>{clearTimeout(manualLookupTimers[kind]);if(input.value.trim())lookupManualCode(kind);});
    document.getElementById('manual-'+kind+'-lookup').addEventListener('click',()=>{clearTimeout(manualLookupTimers[kind]);lookupManualCode(kind);});
    document.getElementById('manual-'+kind+'-add').addEventListener('click',()=>addManualCode(kind));
  }
  auth.onAuthStateChanged(user=>{manualCacheGeneration++;manualCodeCache=[];renderManualCodeLists();if(user)refreshManualCodeLists();});
}

// 防災斡旋：商品・現在庫は通常在庫と共通。旧独立在庫は自動合算しない。
const disasterChannels=['斡旋防災','売掛','ネット','前受','代引き','お供え'];
let disasterRecords=[],disasterUnsubscribe=null,disasterBusy=false,disasterCart=[],disasterToken='',disasterMode='sale';
let festivalExcelPlan=null,festivalExcelBusy=false,festivalExcelGeneration=0;
function categoryLabel(value){return value==='非常用品'?'防災用品':value||'';}
function disasterEligible(p){return categoryLabel(p.category)==='防災用品';}
function disasterCode(value){return String(value??'').normalize('NFKC').trim().toUpperCase();}
function disasterMasterState(p){return JSON.stringify([p.name||'',p.code||'',p.category||'',p.unit||'',p.price??null,p.disasterPackSize??null,p.disasterBoxPrice??null,p.disasterPurchaseBoxPrice??null,p.purchasePrice??null]);}
function disasterId(){return crypto.randomUUID();}
function disasterQ(value,label){return inventoryQuantity(value,label);}
function disasterQuantity(boxes,loose,pack){const b=disasterQ(boxes,'箱数'),n=disasterQ(loose,'ばら数量'),size=disasterQ(pack,'1箱の入数');if(size<1)throw Error('入数は1以上で入力してください');const total=b*size+n;if(!Number.isSafeInteger(total)||total<1)throw Error('数量は1以上の整数で入力してください');return {boxQty:b,looseQty:n,packSize:size,qty:total};}
function disasterMoney(value,label){const n=Number(value);if(value===''||!Number.isFinite(n)||n<0||n>1e12)throw Error(label+'を0以上で入力してください');return n;}
function disasterStatus(message,error=false){const node=$w('dsStatus');node.textContent=message;node.className=error?'invoice-action-error':'invoice-action-info';}
function disasterSetBusy(busy){disasterBusy=busy;$w('dsMode').disabled=busy;$w('dsEntry').disabled=busy;$w('dsNew').disabled=busy;$w('dsLedger').querySelectorAll('button,input').forEach(e=>e.disabled=busy);}
function disasterNew(){disasterCart=[];disasterToken=disasterId();$w('dsBoxes').value='0';$w('dsLoose').value='1';$w('dsProduct').value='';$w('dsPack').value='1';$w('dsUnitPrice').value='0';$w('dsBoxPrice').value='0';$w('dsParty').value='';$w('dsReference').value='';$w('dsExpected').value='';$w('dsNote').value='';renderDisasterCart();disasterStatus('新しい入力を開始しました。');}
function disasterProductChanged(){const p=allProducts.find(p=>p.id===$w('dsProduct').value);const pack=Number(p?.disasterPackSize||1);$w('dsPack').value=String(pack);$w('dsUnitPrice').value=disasterMode==='purchase'?(p?.purchasePrice??''):String(p?.price||0);$w('dsBoxPrice').value=disasterMode==='purchase'?(p?.disasterPurchaseBoxPrice??''):String(p?.disasterBoxPrice??Number(p?.price||0)*pack);$w('dsBaseUnit').textContent=p?.unit||'個';}
function renderDisasterCart(){
  $w('dsCart').innerHTML=disasterCart.map((i,n)=>`<tr><td>${safe(i.code)}</td><td>${safe(i.productName)}</td><td>${i.boxQty}箱＋${i.looseQty}${safe(i.unit)}<br>1箱${i.packSize}${safe(i.unit)}</td><td>${i.qty}${safe(i.unit)}</td><td>¥${i.amount.toLocaleString()}</td><td><button type="button" class="btn-secondary-inline ds-remove" data-index="${n}">削除</button></td></tr>`).join('');
  $w('dsCart').querySelectorAll('.ds-remove').forEach(b=>b.onclick=()=>{disasterCart.splice(Number(b.dataset.index),1);renderDisasterCart();});
}
function disasterAddLine(){
  try{const p=allProducts.find(p=>p.id===$w('dsProduct').value);if(!p||!disasterEligible(p))throw Error('防災用品を選択してください');if(disasterCart.some(i=>i.productId===p.id))throw Error('同じ商品は1行にまとめてください。明細を削除し、数量をまとめて追加してください');if(disasterCart.length>=100)throw Error('1件の明細は100商品までです');const quantities=disasterQuantity($w('dsBoxes').value,$w('dsLoose').value,$w('dsPack').value),unitPrice=disasterMoney($w('dsUnitPrice').value===''&&quantities.looseQty===0?0:$w('dsUnitPrice').value,'ばら単価'),boxPrice=disasterMoney($w('dsBoxPrice').value===''&&quantities.boxQty===0?0:$w('dsBoxPrice').value,'箱単価');
    disasterCart.push({productId:p.id,productName:p.name,code:String(p.code||''),unit:p.unit||'個',...quantities,unitPrice,boxPrice,amount:quantities.boxQty*boxPrice+quantities.looseQty*unitPrice,receivedQty:0,masterState:disasterMasterState(p)});renderDisasterCart();disasterStatus('明細を追加しました。在庫はまだ変わりません。');
  }catch(e){disasterStatus(e.message,true);}
}
async function saveDisasterPack(){
  if(disasterBusy||!inventoryWritesAllowed())return;const id=$w('dsProduct').value;
  try{const p=allProducts.find(p=>p.id===id);if(!p)throw Error('用品を選択してください');const pack=disasterQ($w('dsPack').value,'入数'),price=disasterMoney($w('dsBoxPrice').value,'箱単価');if(pack<1)throw Error('入数は1以上です');disasterSetBusy(true);
    await db.runTransaction(async tx=>{await requireNoActiveReset(tx);const ref=db.collection(COLLECTION).doc(id),doc=await tx.get(ref);if(!doc.exists||disasterMasterState(doc.data())!==disasterMasterState(p))throw Error('商品情報が変わりました。選び直してください');tx.update(ref,{disasterPackSize:pack,...(disasterMode==='purchase'?{disasterPurchaseBoxPrice:price}:{disasterBoxPrice:price})});});disasterStatus('入数・箱単価を商品に保存しました。現在庫・ばら単価は変更しません。');
  }catch(e){disasterStatus(e.message,true);}finally{disasterSetBusy(false);}
}
async function createDisasterOrder(input){
  if(!inventoryWritesAllowed())throw Error('登録できません');
  if(!['sale','purchase'].includes(input.mode)||!input.party.trim()||!input.items.length||input.items.length>100)throw Error('相手先と1～100件の明細を入力してください');
  if(input.mode==='sale'&&!disasterChannels.includes(input.channel))throw Error('区分を選択してください');
  if(input.expected&&!s1ValidDate(input.expected))throw Error('入荷予定日を確認してください');
  const ids=new Set();for(const i of input.items){if(ids.has(i.productId))throw Error('同じ商品が重複しています');ids.add(i.productId);const q=disasterQuantity(i.boxQty,i.looseQty,i.packSize);if(q.qty!==i.qty)throw Error('箱数と合計数量が一致しません');disasterMoney(i.unitPrice,'単価');disasterMoney(i.boxPrice,'箱単価');if(i.amount!==q.boxQty*i.boxPrice+q.looseQty*i.unitPrice)throw Error('金額が一致しません');}
  const ref=db.collection(DISASTER_MOVEMENTS).doc('ds-'+input.mode+'-'+input.token);
  await db.runTransaction(async tx=>{await requireNoActiveReset(tx);const existing=await tx.get(ref);if(existing.exists)throw Error('この入力は登録済みです。一覧を確認してください');const docs=await Promise.all(input.items.map(i=>tx.get(db.collection(COLLECTION).doc(i.productId))));
    docs.forEach((d,n)=>{if(!d.exists||!disasterEligible(d.data())||disasterMasterState(d.data())!==input.items[n].masterState)throw Error('商品情報が変更されています。明細を追加し直してください');});
    tx.set(ref,{kind:'disaster-'+input.mode+'-v1',status:'ordered',party:input.party.trim(),channel:input.mode==='sale'?input.channel:'発注',reference:input.reference.trim(),expectedDate:input.expected,note:input.note.trim(),items:input.items.map(({masterState,...i})=>({...i,receivedQty:0})),amount:input.items.reduce((n,i)=>n+i.amount,0),staff:currentStaffName,createdAt:stamp()});
  });return ref.id;
}
async function saveDisasterOrder(){
  if(disasterBusy)return;const input={mode:disasterMode,party:$w('dsParty').value,channel:$w('dsChannel').value,reference:$w('dsReference').value,expected:$w('dsExpected').value,note:$w('dsNote').value,items:structuredClone(disasterCart),token:disasterToken};
  disasterSetBusy(true);try{await createDisasterOrder(input);disasterNew();disasterStatus(input.mode==='sale'?'注文を登録しました。出荷確定時に在庫を減らします。':'発注を登録しました。入荷予定数に加え、入荷確定時に在庫を増やします。');}catch(e){disasterStatus((e.message||'保存できませんでした')+'。再実行前に一覧を確認してください。',true);}finally{disasterSetBusy(false);}
}
function disasterItemsSignature(items){return JSON.stringify(items.map(i=>[i.productId,i.qty,i.receivedQty||0,i.unitPrice,i.boxPrice,i.amount]));}
async function shipDisasterOrder(id,expectedSignature){
  if(!inventoryWritesAllowed())throw Error('出荷できません');const ref=db.collection(DISASTER_MOVEMENTS).doc(id);
  await db.runTransaction(async tx=>{await requireNoActiveReset(tx);const doc=await tx.get(ref);if(!doc.exists||doc.data().kind!=='disaster-sale-v1'||doc.data().status!=='ordered')throw Error('既に出荷済み・取消済みです');const order=doc.data();if(disasterItemsSignature(order.items)!==expectedSignature)throw Error('注文内容が変わりました');const seen=new Set();order.items.forEach(i=>{if(seen.has(i.productId))throw Error('商品明細が重複しています');seen.add(i.productId);if(!disasterQ(i.qty,'出荷数'))throw Error('数量が不正です');});
    const docs=await Promise.all(order.items.map(i=>tx.get(db.collection(COLLECTION).doc(i.productId))));docs.forEach((d,n)=>{if(!d.exists||disasterQ(d.data().currentStock||0,'現在庫')-disasterQ(d.data().reservedStock||0,'準備確保数')<order.items[n].qty)throw Error('出荷可能数が不足：'+order.items[n].productName);});
    order.items.forEach((i,n)=>{tx.update(docs[n].ref,{currentStock:Number(docs[n].data().currentStock||0)-i.qty});tx.set(db.collection(MOVEMENTS_COLLECTION).doc('ds-out-'+id+'-'+n),{productId:i.productId,productName:i.productName,unit:i.unit,type:'out',qty:i.qty,note:'防災斡旋 '+order.channel+' '+order.party,sourceDisasterOrder:id,staff:currentStaffName,createdAt:stamp()});});tx.update(ref,{status:'shipped',shippedAt:stamp(),shippedBy:currentStaffName});
  });
}
async function receiveDisasterOrder(id,index,qty,expectedReceived){
  if(!inventoryWritesAllowed())throw Error('入荷できません');qty=disasterQ(qty,'入荷数');if(qty<1)throw Error('1以上で入力してください');const ref=db.collection(DISASTER_MOVEMENTS).doc(id);
  await db.runTransaction(async tx=>{await requireNoActiveReset(tx);const doc=await tx.get(ref);if(!doc.exists||doc.data().kind!=='disaster-purchase-v1'||!['ordered','part_received'].includes(doc.data().status))throw Error('入荷済み・取消済みです');const order=doc.data(),items=order.items.map(i=>({...i})),item=items[index];if(!item||Number(item.receivedQty||0)!==expectedReceived)throw Error('入荷状況が変わりました。再確認してください');if(qty>item.qty-expectedReceived)throw Error('未入荷数を超えています');const productRef=db.collection(COLLECTION).doc(item.productId),product=await tx.get(productRef);if(!product.exists)throw Error('商品がありません');const stock=disasterQ(product.data().currentStock||0,'現在庫')+qty;if(!Number.isSafeInteger(stock))throw Error('数量が大きすぎます');item.receivedQty=expectedReceived+qty;
    tx.update(productRef,{currentStock:stock});tx.set(db.collection(MOVEMENTS_COLLECTION).doc('ds-in-'+id+'-'+index+'-'+item.receivedQty),{productId:item.productId,productName:item.productName,unit:item.unit,type:'in',qty,note:'防災用品入荷 '+order.party,sourceDisasterOrder:id,staff:currentStaffName,createdAt:stamp()});tx.update(ref,{items,status:items.every(i=>i.receivedQty===i.qty)?'received':'part_received',lastReceivedAt:stamp(),lastReceivedBy:currentStaffName});
  });
}
async function cancelDisasterOrder(id){if(!inventoryWritesAllowed())throw Error('取消できません');const ref=db.collection(DISASTER_MOVEMENTS).doc(id);await db.runTransaction(async tx=>{await requireNoActiveReset(tx);const d=await tx.get(ref);if(!d.exists||!['disaster-sale-v1','disaster-purchase-v1'].includes(d.data().kind)||!['ordered','part_received'].includes(d.data().status))throw Error('取消できない状態です');tx.update(ref,{status:'cancelled',cancelledAt:stamp(),cancelledBy:currentStaffName});});}
async function disasterAction(action){if(disasterBusy)return;disasterSetBusy(true);try{await action();disasterStatus('反映しました。通常の在庫一覧にも反映されます。');}catch(e){disasterStatus(e.message||'処理できませんでした',true);}finally{disasterSetBusy(false);renderDisaster();}}
function disasterStockSummary(products,records){return products.map(p=>{const sales=records.filter(r=>r.kind==='disaster-sale-v1'&&r.status==='ordered').flatMap(r=>r.items).filter(i=>i.productId===p.id).reduce((n,i)=>n+i.qty,0),incoming=records.filter(r=>r.kind==='disaster-purchase-v1'&&['ordered','part_received'].includes(r.status)).flatMap(r=>r.items).filter(i=>i.productId===p.id).reduce((n,i)=>n+i.qty-Number(i.receivedQty||0),0),stock=Number(p.currentStock||0),reserved=Number(p.reservedStock||0),available=Math.max(0,stock-reserved);return {...p,stock,reserved,available,sales,incoming,shortage:Math.max(0,sales-available),afterIncoming:Math.max(0,sales-available-incoming)};});}
function renderDisaster(){
  if(!$w('dsProduct'))return;const products=allProducts.filter(disasterEligible),selected=$w('dsProduct').value;$w('dsProduct').innerHTML='<option value="">商品を選択</option>'+products.map(p=>`<option value="${safe(p.id)}">${safe(p.code||'')} ${safe(p.name)}</option>`).join('');$w('dsProduct').value=selected;
  const term=$w('dsSearch').value.normalize('NFKC').trim().toLowerCase(),filter=$w('dsChannelFilter').value;
  const records=disasterRecords.filter(r=>r.kind===`disaster-${disasterMode}-v1`&&(!filter||disasterMode==='purchase'||r.channel===filter)&&(!term||[r.party,r.reference,r.note,...r.items.map(i=>i.productName+' '+i.code)].some(v=>String(v||'').normalize('NFKC').toLowerCase().includes(term))));
  $w('dsLedger').innerHTML=records.map(r=>{const purchase=disasterMode==='purchase',open=['ordered','part_received'].includes(r.status),status=({ordered:purchase?'未入荷':'未出荷',part_received:'一部入荷',received:'入荷済み',shipped:'出荷済み',cancelled:'取消済み'})[r.status]||r.status;return `<tr><td>${safe(dateLabel(r.createdAt))}<br>${safe(r.reference||r.id)}</td><td>${safe(r.channel)}<br>${safe(r.party)}</td><td>${r.items.map((i,n)=>`${safe(i.code)} ${safe(i.productName)}<br>${i.boxQty}箱＋${i.looseQty}${safe(i.unit)}＝${i.qty}${safe(i.unit)}${purchase?`（入荷済${i.receivedQty||0}）`:''}${purchase&&open&&i.receivedQty<i.qty?`<div class="ds-receive-row"><input type="number" min="1" max="${i.qty-i.receivedQty}" step="1" value="${i.qty-i.receivedQty}" aria-label="${safe(i.productName)}の今回入荷数量" data-receive="${safe(r.id)}:${n}"><button type="button" class="btn-secondary-inline ds-receive" data-id="${safe(r.id)}" data-index="${n}">入荷確定</button></div>`:''}`).join('<hr>')}</td><td>¥${Number(r.amount||0).toLocaleString()}<br>${purchase?'予定日 '+safe(r.expectedDate||'未定'):''}</td><td>${safe(status)}<br>${safe(r.note||'')}</td><td>${!purchase&&open?`<button type="button" class="btn-primary ds-ship" data-id="${safe(r.id)}">出荷確定</button>`:''}${open?`<button type="button" class="btn-secondary-inline ds-cancel" data-id="${safe(r.id)}">${purchase?'未入荷分を取消':'注文取消'}</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="6">まだ登録されていません</td></tr>';
  $w('dsLedger').querySelectorAll('.ds-ship').forEach(b=>b.onclick=()=>{const r=disasterRecords.find(r=>r.id===b.dataset.id);if(confirm('出荷を確定し通常在庫から減算しますか？'))disasterAction(()=>shipDisasterOrder(r.id,disasterItemsSignature(r.items)));});
  $w('dsLedger').querySelectorAll('.ds-receive').forEach(b=>b.onclick=()=>{const r=disasterRecords.find(r=>r.id===b.dataset.id),index=Number(b.dataset.index),input=b.parentElement.querySelector('input'),qty=input.value,expected=Number(r.items[index].receivedQty||0);if(confirm('今回の入荷数量を通常在庫へ加算しますか？'))disasterAction(()=>receiveDisasterOrder(r.id,index,qty,expected));});
  $w('dsLedger').querySelectorAll('.ds-cancel').forEach(b=>b.onclick=()=>{if(confirm('未処理分を取り消しますか？ 入荷済みの現在庫は変わりません。'))disasterAction(()=>cancelDisasterOrder(b.dataset.id));});
  $w('dsStock').innerHTML=disasterStockSummary(products,disasterRecords).map(p=>`<tr><td>${safe(p.code)}</td><td>${safe(p.name)}</td><td>${p.stock}${safe(p.unit)}</td><td>${p.reserved}</td><td>${p.available}</td><td>${p.sales}</td><td>${p.incoming}</td><td>${p.shortage}</td><td>${p.afterIncoming}</td></tr>`).join('')||'<tr><td colspan="9">在庫一覧でカテゴリー「防災用品」の商品を登録してください</td></tr>';
  if(disasterBusy)$w('dsLedger').querySelectorAll('button,input').forEach(e=>e.disabled=true);
  $w('dsSummary').innerHTML=disasterChannels.map(c=>{const rows=disasterRecords.filter(r=>r.kind==='disaster-sale-v1'&&r.channel===c&&r.status!=='cancelled');return `<tr><td>${safe(c)}</td><td>${rows.length}</td><td>${rows.filter(r=>r.status==='ordered').length}</td><td>${rows.filter(r=>r.status==='shipped').length}</td><td>¥${rows.reduce((n,r)=>n+Number(r.amount||0),0).toLocaleString()}</td></tr>`;}).join('');
}
function subscribeDisaster(){
  if(disasterUnsubscribe)disasterUnsubscribe();disasterRecords=[];renderDisaster();
  disasterUnsubscribe=db.collection(DISASTER_MOVEMENTS).onSnapshot(snapshot=>{disasterRecords=snapshot.docs.map(d=>({id:d.id,...d.data()})).filter(d=>['disaster-sale-v1','disaster-purchase-v1'].includes(d.kind)).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));renderDisaster();},e=>{console.error(e);disasterStatus('防災斡旋データを取得できません。通信状態・権限を確認してください。',true);});
}
function disasterCsv(){const rows=[['商品コード','商品名','現在庫','月始祭等確保数','利用可能数','未出荷注文数','入荷予定数','不足数','入荷予定考慮後不足数'],...disasterStockSummary(allProducts.filter(disasterEligible),disasterRecords).map(p=>[p.code,p.name,p.stock,p.reserved,p.available,p.sales,p.incoming,p.shortage,p.afterIncoming])];const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(v=>csvCell(/^[=+@\-\t\r]/.test(String(v??''))?"'"+String(v??''):String(v??''))).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='防災用品_在庫集計.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function initDisasterOps(){
  $w('dsProduct').onchange=disasterProductChanged;$w('dsAddLine').onclick=disasterAddLine;$w('dsPackSave').onclick=saveDisasterPack;$w('dsSave').onclick=saveDisasterOrder;$w('dsNew').onclick=disasterNew;$w('dsCsv').onclick=disasterCsv;$w('dsSearch').oninput=$w('dsChannelFilter').onchange=renderDisaster;
  $w('dsMode').onchange=()=>{if(disasterCart.length){$w('dsMode').value=disasterMode;return disasterStatus('明細を保存するか「新しい入力」で消してから切り替えてください。',true);}disasterMode=$w('dsMode').value;$w('dsPartyLabel').textContent=disasterMode==='sale'?'注文者・出荷先':'仕入先';$w('dsSave').textContent=disasterMode==='sale'?'注文を登録':'発注を登録';$w('dsExpectedWrap').hidden=disasterMode!=='purchase';$w('dsChannelWrap').hidden=disasterMode==='purchase';disasterToken=disasterId();$w('dsUnitPriceLabel').textContent=disasterMode==='purchase'?'仕入ばら単価（円・手入力）':'販売ばら単価（円）';$w('dsBoxPriceLabel').textContent=disasterMode==='purchase'?'仕入箱単価（円・手入力）':'販売箱単価（円）';disasterProductChanged();renderDisaster();};
  $w('dsFestival').onclick=()=>{switchTab('festival');$w('festivalMonth').focus();};
  auth.onAuthStateChanged(user=>{clearFestivalExcel();if(!user){if(disasterUnsubscribe)disasterUnsubscribe();disasterUnsubscribe=null;disasterRecords=[];disasterNew();renderDisaster();}});disasterNew();
  $w('festivalExcelPreviewBtn').onclick=previewFestivalExcel;$w('festivalExcelApplyBtn').onclick=applyFestivalExcel;
  for(const id of ['festivalExcelFile','festivalMonth'])$w(id).addEventListener('change',clearFestivalExcel);
}

function clearFestivalExcel(){festivalExcelGeneration++;festivalExcelPlan=null;$w('festivalExcelApplyBtn').disabled=true;$w('festivalExcelPreview').textContent='';}
function festivalDraftState(record){return JSON.stringify(record?[record.status||'draft',record.stockMode||'included',record.items||[],record.excelImports||[]]:null);}
function parseFestivalExcel(book){
  const sheet=book.Sheets['頒布詳細'];if(!sheet)throw Error('「頒布詳細」シートがありません');
  const value=(col,row)=>sheet[col+row]?.v;
  if(!/商品.*コ.*ド|商品.*ｺ.*ﾄﾞ/.test(String(value('A',1)))||String(value('C',1)).normalize('NFKC').replace(/\s/g,'')!=='S1出')throw Error('A列「商品コード」・C列「S1出」の配置を確認してください');
  const range=XLSX.utils.decode_range(sheet['!ref']||'A1:A1');if(range.e.r>10000)throw Error('行数が多すぎます');const rows=[];
  for(let r=2;r<=range.e.r+1;r++){
    const raw=value('C',r),code=disasterCode(value('A',r)),name=String(value('B',r)??'').trim();
    if(raw===undefined||raw===null||raw===''){if(sheet['C'+r]?.f)throw Error(r+'行目のS1出の数式結果がありません。Excelで再計算して保存してください');continue;}
    if(['S1出','列3'].includes(String(raw).normalize('NFKC').replace(/\s/g,''))||/商品.*(?:コード|コート|コ.ド)/.test(code)||code==='列1')continue;
    if(!code)continue;
    if(sheet['C'+r]?.t==='e')throw Error(r+'行目のS1出がエラーです');
    const qty=disasterQ(raw,r+'行目のS1出');if(!qty)continue;
    rows.push({row:r,code,name,qty});
  }
  if(!rows.length)throw Error('C列「S1出」に1以上の準備数量を入力してください');return rows;
}
async function prepareFestivalExcel(book,month,source){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('対象月を選択してください');
  const rows=parseFestivalExcel(book),snapshot=await db.collection(COLLECTION).get({source:'server'}),products=snapshot.docs.map(d=>({id:d.id,...d.data()})),doc=await db.collection(FESTIVALS).doc(month).get({source:'server'}),prior=doc.exists?doc.data():null;
  if(prior&&prior.status!=='draft')throw Error('準備確定済み・精算済みの月へは取り込めません');
  if((prior?.excelImports||[]).includes(source.digest))throw Error('このExcelは同じ月へ取込済みです');
  const errors=[],warnings=[],states={},mapped=new Map();
  for(const row of rows){const matches=products.filter(p=>disasterCode(p.code)===row.code);if(matches.length!==1){errors.push(row.row+'行：'+row.code+' '+row.name+'（'+(matches.length?'コード重複':'未登録')+'）');continue;}const p=matches[0];if(mapped.has(p.id)){errors.push(row.row+'行：同じ商品コードが複数行にあります：'+row.code);continue;}if(disasterCode(row.name).replace(/\s/g,'')!==disasterCode(p.name).replace(/\s/g,''))warnings.push(row.code+'：Excel名「'+row.name+'」→登録名「'+p.name+'」');states[p.id]=disasterMasterState(p);mapped.set(p.id,{productId:p.id,name:p.name,code:String(p.code||''),category:categoryLabel(p.category),unit:p.unit||'個',price:Number(p.price||0),qty:row.qty,extraQty:0,directQty:0,returnedQty:0,damagedQty:0,sampleQty:0});}
  if(errors.length)throw Error('一致しない商品があります。商品一覧を修正してから再度確認してください。\n'+errors.slice(0,60).join('\n')+(errors.length>60?'\nほか'+(errors.length-60)+'行':''));
  const merged=new Map((prior?.items||[]).map(i=>[i.productId,{...i}]));
  for(const [id,item]of mapped){const old=merged.get(id);merged.set(id,{...item,...old,qty:item.qty,name:item.name,code:item.code,category:item.category,unit:item.unit});}
  const items=[...merged.values()];if(items.length>245)throw Error('現在の準備確定は245商品までです。既存の準備案と合わせた件数を確認してください');
  return {month,items,states,priorItems:prior?.items||[],priorState:festivalDraftState(prior),source,warnings,count:mapped.size,quantity:[...mapped.values()].reduce((n,i)=>n+i.qty,0)};
}
async function commitFestivalExcel(plan){
  if(!inventoryWritesAllowed())throw Error('登録できません');const ref=db.collection(FESTIVALS).doc(plan.month);
  await db.runTransaction(async tx=>{await requireNoActiveReset(tx);const doc=await tx.get(ref),old=doc.exists?doc.data():null;if(festivalDraftState(old)!==plan.priorState)throw Error('準備案が変更されています。もう一度取込内容を確認してください');if(old&&old.status!=='draft')throw Error('準備確定済みです');
    for(const [id,state] of Object.entries(plan.states)){const p=await tx.get(db.collection(COLLECTION).doc(id));if(!p.exists||disasterMasterState(p.data())!==state)throw Error('商品情報が変わりました。再確認してください');}
    tx.set(ref,{...(old||{}),month:plan.month,status:'draft',stockMode:'included',items:plan.items,excelImports:[...(old?.excelImports||[]),plan.source.digest],lastExcelSource:plan.source,updatedBy:currentStaffName,updatedAt:stamp()});
  });
}
function festivalExcelSetBusy(busy){festivalExcelBusy=busy;for(const id of ['festivalExcelFile','festivalExcelPreviewBtn','festivalMonth'])$w(id).disabled=busy;$w('festivalExcelApplyBtn').disabled=busy||!festivalExcelPlan;}
function festivalUiSignature(items){return JSON.stringify(items.map(i=>[i.productId,...['qty',...festivalFields,'price'].map(k=>Number(i[k]||0))]).sort((a,b)=>a[0].localeCompare(b[0])));}
async function previewFestivalExcel(){
  if(festivalExcelBusy)return;clearFestivalExcel();const generation=festivalExcelGeneration,file=$w('festivalExcelFile').files[0],month=festivalKey();
  if(!file)return $w('festivalExcelPreview').textContent='Excelを選択してください';if(file.size>20*1024*1024)return $w('festivalExcelPreview').textContent='20MB以下のExcelを選択してください';
  festivalExcelSetBusy(true);
  try{const bytes=await file.arrayBuffer(),digest=await s1Digest(Array.from(new Uint8Array(bytes)).join(',')),book=XLSX.read(bytes,{type:'array'});const plan=await prepareFestivalExcel(book,month,{fileName:file.name,digest,sheet:'頒布詳細',column:'C（S1出）'});if(generation!==festivalExcelGeneration||festivalKey()!==month)return;const uiSignature=festivalUiSignature(collectFestival());if(uiSignature!==festivalUiSignature(plan.priorItems))throw Error('月始祭表の未保存の入力があります。対象月を開き直すか、先に「入力を保存」してください');plan.uiSignature=uiSignature;festivalExcelPlan=plan;
    $w('festivalExcelPreview').textContent=`対象月：${month}\n取込：${plan.count}商品・${plan.quantity}（各商品の基準単位）\nC列「S1出」のみを準備数へ反映します。\n同じ商品の準備数を置換し、その他の既存商品・追加・戻り等は保持します。現在庫は変わりません。\n\n`+plan.items.map(i=>`${i.code} ${i.name}：${i.qty}${i.unit}`).join('\n')+(plan.warnings.length?'\n\n商品名の確認：\n'+plan.warnings.join('\n'):'');
  }catch(e){$w('festivalExcelPreview').textContent=e.message||'読込できませんでした';}finally{festivalExcelSetBusy(false);}
}
async function applyFestivalExcel(){
  if(festivalExcelBusy||!festivalExcelPlan)return;const plan=festivalExcelPlan;if(festivalKey()!==plan.month)return clearFestivalExcel();if(festivalUiSignature(collectFestival())!==plan.uiSignature){clearFestivalExcel();$w('festivalExcelPreview').textContent='準備表の入力が変わりました。先に入力を保存し、取込内容を確認し直してください。';return;}if(!confirm(plan.month+'の準備案へ取り込みます。同じ商品の準備数を置き換えます。よろしいですか？'))return;
  festivalExcelSetBusy(true);try{await commitFestivalExcel(plan);clearFestivalExcel();await loadFestival();$w('festivalExcelPreview').textContent='準備案に取り込みました。数量を確認し「準備を確定」を押してください。現在庫は減りません。';}catch(e){clearFestivalExcel();$w('festivalExcelPreview').textContent=(e.message||'保存できませんでした')+'。保存済みか確認してから再度読み込んでください。';}finally{festivalExcelSetBusy(false);}
}

window.KOBUNSHA_APP_VERSION = "2026-11-13-disaster-ops-jan-v42";
init();

// 店内用EAN-13。商品ID・既存商品コードとは別に、重複しない番号を予約する。
const BARCODE_REGISTRY = "inventory_barcode_registry";
function eanCheckDigit(body) {
  if (!/^\d{12}$/.test(body)) throw Error("バーコード本体は12桁で指定してください");
  const sum = [...body].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
  return String((10 - sum % 10) % 10);
}
function validEan13(code) {
  return typeof code === "string" && /^\d{13}$/.test(code) && eanCheckDigit(code.slice(0, 12)) === code[12];
}
function ean13Bits(code) {
  if (!validEan13(code)) throw Error("13桁のバーコード番号・末尾の検査数字を確認してください");
  const left = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const parity = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"][Number(code[0])];
  const invert = value => [...value].map(bit => bit === "0" ? "1" : "0").join("");
  let bits = "101";
  for (let i = 1; i <= 6; i++) {
    const value = left[Number(code[i])];
    bits += parity[i - 1] === "L" ? value : [...invert(value)].reverse().join("");
  }
  bits += "01010";
  for (let i = 7; i < 13; i++) bits += invert(left[Number(code[i])]);
  return bits + "101";
}
function makeEanSvg(code) {
  const bits = ean13Bits(code), ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  // 95モジュール＋左右各11モジュールの白地。1モジュール0.30mm。
  svg.setAttribute("viewBox", "0 0 117 82");
  svg.setAttribute("width", "35.1mm");
  svg.setAttribute("height", "24.6mm");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "商品バーコード " + code);
  svg.setAttribute("shape-rendering", "crispEdges");
  const white = document.createElementNS(ns, "rect");
  white.setAttribute("width", "117"); white.setAttribute("height", "82"); white.setAttribute("fill", "white");
  svg.appendChild(white);
  [...bits].forEach((bit, i) => {
    if (bit !== "1") return;
    const bar = document.createElementNS(ns, "rect");
    bar.setAttribute("x", String(i + 11)); bar.setAttribute("y", "0");
    bar.setAttribute("width", "1");
    bar.setAttribute("height", (i < 3 || i >= 45 && i < 50 || i >= 92) ? "74.25" : "69.25");
    bar.setAttribute("fill", "black"); svg.appendChild(bar);
  });
  const digits = document.createElementNS(ns, "text");
  digits.setAttribute("x", "58.5"); digits.setAttribute("y", "80");
  digits.setAttribute("text-anchor", "middle"); digits.setAttribute("font-size", "8");
  digits.setAttribute("font-family", "Arial, sans-serif"); digits.setAttribute("fill", "black");
  digits.textContent = code; svg.appendChild(digits);
  return svg;
}
async function ensureProductBarcode(id, requested, changes, transfer) {
  const ref = db.collection(COLLECTION).doc(id);
  const registry = db.collection(BARCODE_REGISTRY);
  const result = await db.runTransaction(async tx => {
    await requireNoActiveReset(tx);
    const doc = await tx.get(ref);
    if (!doc.exists) throw Error("商品が削除されています");
    const product = doc.data();
    if (transfer && barcodeProductState(product) !== transfer.targetState) throw Error("変更先の商品情報が変わりました。編集画面を開き直してください");
    if (transfer && changes && changes.currentStock !== undefined && Number(changes.currentStock) !== Number(product.currentStock || 0)) throw Error("在庫数の変更と番号の付け替えは分けて行ってください。編集画面を開き直して現在庫を確認してください");
    let releaseOwner = null;
    let code = requested === undefined ? product.barcode || "" : String(requested).trim();
    let counter = null, next = null;
    if (!code) {
      // 空欄での編集保存は既存番号を保持。初回だけ20始まりを採番する。
      code = product.barcode || "";
      if (!code) {
        counter = await tx.get(registry.doc("_sequence"));
        next = counter.exists ? counter.data().next : 1;
        if (!Number.isSafeInteger(next) || next < 1 || next > 9999999999) throw Error("採番状態を確認してください");
        let found = false;
        for (let attempt = 0; attempt < 100 && next <= 9999999999; attempt++, next++) {
          const body = "20" + String(next).padStart(10, "0");
          const candidate = body + eanCheckDigit(body);
          const used = await tx.get(registry.doc(candidate));
          if (!used.exists) { code = candidate; found = true; break; }
        }
        if (!found) throw Error("採番できませんでした。管理者に確認してください");
      }
    }
    if (!validEan13(code)) throw Error("バーコードは検査数字を含む正しい13桁で入力してください");
    const allocated = await tx.get(registry.doc(code));
    if(allocated.exists && allocated.data().kind==="inspection")throw Error("この番号は検品専用です。商品用バーコードには設定できません");
    if (allocated.exists && allocated.data().productId !== id) {
      const ownerId = allocated.data().productId;
      if (typeof ownerId !== "string" || !ownerId || ownerId.includes("/")) throw Error("番号台帳の使用先を確認できません。管理者に確認してください");
      const ownerRef = db.collection(COLLECTION).doc(ownerId);
      const ownerDoc = await tx.get(ownerRef);
      const owner = ownerDoc.exists ? ownerDoc.data() : null;
      const kind = !owner ? "orphan" : owner.barcode === code ? "current" : (owner.barcodeAliases || []).includes(code) ? "alias" : "inconsistent";
      if (transfer) {
        if (kind !== "alias" || transfer.fromProductId !== ownerId || barcodeProductState(owner) !== transfer.ownerState || !validEan13(owner.barcode)) throw Error("番号の使用先が変わりました。保存し直して確認してください");
        releaseOwner = {ref:ownerRef,id:ownerId,aliases:owner.barcodeAliases.filter(value=>value!==code)};
      } else {
        const description = owner ? "「"+(owner.name||"商品名未登録")+"」（商品コード "+(owner.code||"未登録")+"）" : "削除済みの商品";
        const message = kind === "alias" ? "番号 "+code+" は "+description+" の旧番号として登録されています。現在番号は "+owner.barcode+" です。"
          : kind === "current" ? "番号 "+code+" は "+description+" が現在使用しています。同じ番号は登録できません。"
          : "番号 "+code+" は "+description+" に予約されていますが、登録状態を確認できません。管理者に確認してください。";
        const error = Error(message);
        error.barcodeConflict = {kind,ownerId,ownerName:owner?.name||"商品名未登録",ownerCode:owner?.code||"未登録",currentBarcode:owner?.barcode||"",ownerState:owner?barcodeProductState(owner):null,targetState:barcodeProductState(product)};
        throw error;
      }
    }
    if (transfer && !releaseOwner) throw Error("番号の関連付けが変わりました。保存し直して確認してください");
    if (next !== null && allocated.exists) throw Error("自動採番の番号が予約済みです。管理者に確認してください");
    const aliases = [...new Set([...(product.barcodeAliases || []), ...(product.barcode && product.barcode !== code ? [product.barcode] : [])])].filter(value=>value!==code);
    if (changes && Number(changes.currentStock) < Number(product.reservedStock || 0)) throw Error("月始祭準備分を下回る在庫数にはできません");
    if (releaseOwner) tx.update(releaseOwner.ref,{barcodeAliases:releaseOwner.aliases});
    tx.set(registry.doc(code), { productId: id });
    if (next !== null) tx.set(registry.doc("_sequence"), { next: next + 1 });
    tx.update(ref, { ...(changes || {}), barcode: code, barcodeAliases: aliases, barcodeFormat: "EAN13" });
    return { id, ...product, ...(changes || {}), barcode: code, barcodeAliases: aliases, _releasedOwner:releaseOwner?{id:releaseOwner.id,aliases:releaseOwner.aliases}:null };
  });
  const {_releasedOwner, ...updated} = result;
  const local = allProducts.find(p => p.id === id);
  if (local) Object.assign(local, updated);
  if (_releasedOwner) {
    const previous = allProducts.find(p=>p.id===_releasedOwner.id);
    if (previous) previous.barcodeAliases = _releasedOwner.aliases;
  }
  return updated;
}
function barcodeError(err) {
  console.error(err);
  showToast(err.code === "permission-denied" ? "バーコード用のFirestoreルール追加が必要です。READMEを確認してください" : err.message || "バーコード処理に失敗しました");
}
// 印字だけで商品名の末尾にある色を分離。商品マスタは変更しない。
function productLabelTextParts(rawName) {
  const full = String(rawName || "商品名未登録").normalize("NFKC").trim();
  const colors = ["ブロンズ", "シルバーグレー", "シルバーグレイ", "シルバー", "ゴールド", "アイボリー", "ベージュ", "オレンジ", "イエロー", "パープル", "グリーン", "ネイビー", "ブラウン", "ブラック", "ホワイト", "ピンク", "ブルー", "レッド", "茜", "翡翠", "葵", "白", "黒", "赤", "青", "緑", "紫", "黄", "金", "銀", "Pink", "Red", "Blue", "Green", "Yellow", "Purple", "White", "Black", "Silver", "Gold"];
  for (const color of colors) {
    const pattern = [...color].join("\\s*");
    const match = full.match(new RegExp("[\\s　:：/／・_-]*[（(]?" + pattern + "[）)]?\\s*$", "i"));
    if (match && match.index > 0) {
      const base = full.slice(0, match.index).trim();
      if (base) return {name:base.replace(/紙製(?=御み霊箱)/, "紙製\n"), color};
    }
  }
  // 色を推測できない場合も商品名の全文を保持する。
  return {name:full.replace(/紙製(?=御み霊箱)/, "紙製\n"), color:""};
}

function appendProductBarcode(grid, product, name) {
  if (!validEan13(product.barcode)) throw Error("商品バーコードが未登録です");
  if (product.price == null || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) throw Error("商品の売価を登録してください：" + product.name);
  const cell = document.createElement("div");
  cell.className = "brother-product-label";
  const info = document.createElement("div"); info.className = "product-label-info";
  const label = document.createElement("div"); label.className = "product-label-name";
  const textParts = productLabelTextParts(name || product.name);
  label.textContent = textParts.name;
  label.title = name || product.name || "商品名未登録";
  const color = document.createElement("div"); color.className = "product-label-color";
  color.textContent = textParts.color;
  color.hidden = !textParts.color;
  if (!textParts.color) cell.classList.add("product-label-no-color");
  const price = document.createElement("div"); price.className = "product-label-price";
  price.textContent = "¥" + Number(product.price).toLocaleString("ja-JP");
  info.appendChild(label); info.appendChild(color); info.appendChild(price); cell.appendChild(info);
  const box = document.createElement("div"); box.className = "product-label-bars";
  box.dataset.barcode = product.barcode;
  renderProductBarcodeBox(box); cell.appendChild(box); grid.appendChild(cell);
}
function showProductLabelPreview(count) {
  productLabelPreviewCount = count;
  document.getElementById("productLabelSizeTools").hidden = false;
  document.getElementById("qrBulkOverlay").classList.add("show");
  return updateProductLabelSize();
}
async function renderProductLabels(requests) {
  const grid = document.getElementById("qrBulkGrid");
  if (productLabelsBusy) return;
  productLabelsBusy = true;
  document.getElementById("productLabelSizeSelect").disabled = true;
  document.getElementById("qrBulkPrintOkBtn").disabled = true;
  grid.replaceChildren();
  let ready = false;
  try {
    const ids = [...new Set(requests.map(r => r.id))];
    const products = new Map();
    for (const id of ids) products.set(id, await ensureProductBarcode(id));
    let total = 0;
    for (const request of requests) {
      const qty = inventoryQuantity(request.qty, "印刷枚数");
      for (let i = 0; i < qty; i++) appendProductBarcode(grid, products.get(request.id), request.name);
      total += qty;
    }
    if (!total) throw Error("印刷する商品シールがありません");
    grid.lastElementChild.classList.add("last-label");
    grid.className = "brother-label-list";
    document.getElementById("qrOverlay").classList.remove("show");
    ready = showProductLabelPreview(total);
  } catch (err) { grid.replaceChildren(); barcodeError(err); }
  finally { productLabelsBusy = false; document.getElementById("productLabelSizeSelect").disabled = false; document.getElementById("qrBulkPrintOkBtn").disabled = !ready; }
}
let productLabelsBusy = false;
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
async function exportPosProducts() {
  const btn = document.getElementById("posCsvBtn"); btn.disabled = true;
  try {
    if (!allProducts.length) throw Error("出力する商品がありません");
    const rows = [["バーコード","商品コード","商品名","売価","単位"]];
    for (const id of allProducts.map(p => p.id)) {
      const p = await ensureProductBarcode(id);
      rows.push([p.barcode, p.code, p.name, p.price ?? "", p.unit]);
    }
    const blob = new Blob(["\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "POS商品マスタ_汎用.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("汎用CSVを出力しました。POSに合わせて列を対応付けてください");
  } catch (err) { barcodeError(err); }
  finally { btn.disabled = false; }
}
