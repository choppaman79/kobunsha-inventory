// ===================== 設定 =====================
const MEMBERS = ["仙波","山崎","田中","落合","川野","迫","佐藤","二神","森重","小鷹","山根","熊澤"];
const CATEGORIES = ["神具","仏具","神向き用品","チェーン","非常用品","その他"];
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

// ---- Phase3: カメラスキャン関連 ----
let scanStream = null;
let scanRAF = null;
let scanMode = "global"; // "global" または "slip-item"
let pendingHashHandled = false;

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

  document.getElementById("slipDetailCloseBtn").addEventListener("click", closeSlipDetailModal);
  document.getElementById("slipDetailPrintBtn").addEventListener("click", () => window.print());
  document.getElementById("slipDetailCompleteBtn").addEventListener("click", handleSlipComplete);
  document.getElementById("slipDetailOverlay").addEventListener("click", (e) => {
    if (e.target.id === "slipDetailOverlay") closeSlipDetailModal();
  });
  document.getElementById("slipDetailScanBtn").addEventListener("click", () => openScanModal("slip-item"));
  document.getElementById("slipReceivingLabelBtn").addEventListener("click", () => printSlipReceivingLabels(openSlipId));

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
    if (e.key === "Enter") {
      e.preventDefault();
      handleScannerWedgeInput(e.target, "slip-item");
    }
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
  // ハンディスキャナーがすぐ使えるよう、該当タブの入力欄に自動でフォーカス
  if (tab === "list") setTimeout(() => document.getElementById("scannerInput").focus(), 50);
  if (tab === "slips") setTimeout(() => document.getElementById("scannerInputSlips").focus(), 50);
}

// ===================== 商品データ購読 =====================
function subscribeProducts() {
  db.collection(COLLECTION).orderBy("name").onSnapshot(snapshot => {
    allProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderSummary();
    renderProductList();
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
    new QRCode(qrBox, { text: buildProductUrl(p.id), width: 110, height: 110, correctLevel: QRCode.CorrectLevel.M });
  });
  document.getElementById("qrBulkOverlay").classList.add("show");
}

// ===================== Phase3.5: 入荷分のQRラベル印刷 =====================
function printSlipReceivingLabels(slipId) {
  const s = allSlips.find(x => x.id === slipId);
  if (!s) return;
  const items = s.items || [];
  if (items.length === 0) {
    showToast("印刷対象の品目がありません");
    return;
  }
  const grid = document.getElementById("qrBulkGrid");
  grid.innerHTML = "";
  items.forEach(item => {
    // 実際に入荷（検品）した数量ぶんラベルを発行する
    const qty = Math.max(1, Number(item.checkedQty ?? item.plannedQty) || 1);
    for (let i = 1; i <= qty; i++) {
      const cell = document.createElement("div");
      cell.className = "qr-label";
      const qrBox = document.createElement("div");
      cell.appendChild(qrBox);
      const label = document.createElement("div");
      label.className = "qr-label-text";
      label.innerHTML = `${escapeHtml(item.productName || "")}${item.code ? "<br>" + escapeHtml(item.code) : ""}${qty > 1 ? `<br>(${i}/${qty})` : ""}`;
      cell.appendChild(label);
      grid.appendChild(cell);
      new QRCode(qrBox, { text: buildProductUrl(item.productId), width: 110, height: 110, correctLevel: QRCode.CorrectLevel.M });
    }
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
  return String(k).normalize("NFKC").replace(/[\s　]/g, "");
}

function mapExcelRow(row) {
  // 列名の表記ゆれを吸収（商品ｺｰﾄﾞ/商品コード/コード/品番、商品名/名称、種別/分類、売上単価/売価/単価 など）
  const get = (keys) => {
    for (const k of Object.keys(row)) {
      const norm = normalizeHeader(k);
      if (keys.some(kw => norm.includes(kw))) return row[k];
    }
    return "";
  };

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
    category,
    unit: String(get(["単位", "unit"]) || "個").trim(),
    price: Number(get(["売上単価", "売価", "価格", "単価", "price"])) || 0,
    minStock: Number(get(["在庫僅少ライン", "僅少ライン", "minStock"])) || 3,
    stock: Number(get(["現在庫数", "在庫数", "stock"])) || 0,
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
  document.getElementById("slipCreateTitle").textContent = type === "in" ? "入荷伝票を作成" : "出荷伝票を作成";
  const badge = document.getElementById("slipCreateTypeBadge");
  badge.textContent = type === "in" ? "入荷伝票" : "出荷伝票";
  badge.className = "slip-type-badge " + type;
  document.getElementById("slipPartner").value = "";
  document.getElementById("slipMemo").value = "";
  document.getElementById("slipItemCodeInput").value = "";
  document.getElementById("slipItemCodeError").textContent = "";
  const productSelect = document.getElementById("slipItemProduct");
  productSelect.innerHTML = `<option value="">商品を選択...</option>` +
    allProducts.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.code ? "（" + escapeHtml(p.code) + "）" : ""}</option>`).join("");
  document.getElementById("slipItemQty").value = 1;
  clearSelectedProductCard();
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
}

function clearSelectedProductCard() {
  document.getElementById("slipItemSelectedCard").style.display = "none";
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
  const p = allProducts.find(x => x.id === productId);
  if (!p) { showToast("商品コードを入力するか、商品名から選択してください"); return; }
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
  showToast(`${p.name} を追加しました`);
  // 次の品目をすぐ入力できるようリセットしてコード欄にフォーカスを戻す
  document.getElementById("slipItemQty").value = 1;
  document.getElementById("slipItemCodeInput").value = "";
  document.getElementById("slipItemProduct").value = "";
  clearSelectedProductCard();
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

  const qrBox = document.getElementById("slipQrBox");
  qrBox.innerHTML = "";
  new QRCode(qrBox, { text: buildSlipUrl(id), width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M });
  const qrLabel = document.createElement("div");
  qrLabel.style.cssText = "font-size:11px;color:#8a8272;";
  qrLabel.textContent = s.slipNumber || "";
  qrBox.appendChild(qrLabel);

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

  const labelWrap = document.getElementById("slipReceivingLabelWrap");
  labelWrap.style.display = (isDone && s.type === "in") ? "block" : "none";

  document.getElementById("slipDetailOverlay").classList.add("show");
  if (!isDone) {
    setTimeout(() => document.getElementById("slipItemScannerInput").focus(), 50);
  }
}

function closeSlipDetailModal() {
  openSlipId = null;
  document.getElementById("slipDetailOverlay").classList.remove("show");
}

// ===================== Phase3: カメラでのQRスキャン =====================
function openScanModal(mode) {
  scanMode = mode;
  document.getElementById("scanModalTitle").textContent =
    mode === "slip-item" ? "商品QRをスキャン（検品）" : "QRコードをスキャン";
  document.getElementById("scanHint").textContent =
    mode === "slip-item" ? "この伝票に含まれる商品のQRにカメラを向けてください" : "商品または伝票のQRコードにカメラを向けてください";
  document.getElementById("scanError").textContent = "";
  document.getElementById("scanOverlay").classList.add("show");
  startScanCamera();
}

function closeScanModal() {
  stopScanCamera();
  document.getElementById("scanOverlay").classList.remove("show");
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
    handleSlipItemScan(parsed.id);
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
function handleSlipItemScan(productId) {
  const s = allSlips.find(x => x.id === openSlipId);
  if (!s) { showToast("伝票が開かれていません"); return; }
  const idx = (s.items || []).findIndex(it => it.productId === productId);

  if (idx === -1) {
    playWarningAlert();
    showToast("⚠️ この伝票に含まれない商品です");
    return;
  }

  const qtyInput = document.querySelector(`.slip-check-qty[data-idx="${idx}"]`);
  const checkBox = document.querySelector(`.slip-check-box[data-idx="${idx}"]`);
  const planned = s.items[idx].plannedQty;
  const name = s.items[idx].productName;
  const unit = s.items[idx].unit || "";
  if (!qtyInput) return;

  const current = Number(qtyInput.value) || 0;

  if (current >= planned) {
    // 数量超過（規定数に達しているのにさらにスキャンされた）
    playWarningAlert();
    showToast(`⚠️ 数量超過：${name} は既に${planned}${unit}に達しています`);
    return;
  }

  const next = current + 1;
  qtyInput.value = next;
  if (checkBox) checkBox.checked = next >= planned;
  playSuccessBeep();
  showToast(`${name}：${next}/${planned}${unit} 確認`);
}

// ===================== Phase3.5: ハンディスキャナー（キーボード入力）対応 =====================
function handleScannerWedgeInput(inputEl, mode) {
  const text = inputEl.value.trim();
  inputEl.value = "";
  if (!text) return;

  const parsed = extractScannedId(text);

  if (mode === "slip-item") {
    handleSlipItemScan(parsed.id);
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
