// ===================== 設定 =====================
const MEMBERS = ["仙波","山崎","田中","落合","川野","迫","佐藤","二神","森重","小鷹","山根","熊澤"];
const CATEGORIES = ["神具","仏具","神向き用品","防災用品","その他"];
const COLLECTION = "inventory_products"; // 予定管理アプリのコレクションとは別名にして衝突を防止

const auth = firebase.auth();
const db = firebase.firestore();
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

let allProducts = [];
let activeCategory = "すべて";
let editingId = null;

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
  document.getElementById("whoAmI").textContent = `${name} さん`;
  subscribeProducts();
}

// ===================== タブ切り替え =====================
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("tabList").style.display = tab === "list" ? "block" : "none";
  document.getElementById("tabRegister").style.display = tab === "register" ? "block" : "none";
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
        <div class="product-meta">単位：${escapeHtml(p.unit || "-")}　/　僅少ライン：${p.minStock ?? 0}${p.note ? "　/　" + escapeHtml(p.note) : ""}</div>
      </div>
      <div class="stock-control">
        <button class="stock-btn" data-action="dec" data-id="${p.id}">−</button>
        <div class="stock-num ${isLow ? "low" : ""}">${p.currentStock ?? 0}</div>
        <button class="stock-btn" data-action="inc" data-id="${p.id}">＋</button>
      </div>
      <a class="edit-link" data-id="${p.id}">編集</a>
    `;
    listEl.appendChild(row);
  });

  listEl.querySelectorAll(".stock-btn").forEach(btn => {
    btn.addEventListener("click", () => adjustStock(btn.dataset.id, btn.dataset.action));
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

// ===================== 在庫増減 =====================
function adjustStock(id, action) {
  const product = allProducts.find(p => p.id === id);
  if (!product) return;
  const delta = action === "inc" ? 1 : -1;
  const newStock = Math.max(0, Number(product.currentStock || 0) + delta);
  db.collection(COLLECTION).doc(id).update({ currentStock: newStock })
    .catch(err => { console.error(err); showToast("更新に失敗しました"); });
}

// ===================== 商品登録 =====================
function handleRegisterSubmit() {
  const name = document.getElementById("regName").value.trim();
  const category = document.getElementById("regCategory").value;
  const unit = document.getElementById("regUnit").value.trim() || "個";
  const stock = Number(document.getElementById("regStock").value) || 0;
  const minStock = Number(document.getElementById("regMinStock").value) || 0;
  const note = document.getElementById("regNote").value.trim();

  if (!name) {
    showToast("商品名を入力してください");
    return;
  }

  db.collection(COLLECTION).add({
    name, category, unit,
    currentStock: stock,
    minStock: minStock,
    note,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    showToast("商品を登録しました");
    document.getElementById("regName").value = "";
    document.getElementById("regUnit").value = "個";
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
  document.getElementById("editCategory").value = p.category || CATEGORIES[0];
  document.getElementById("editUnit").value = p.unit || "";
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
    category: document.getElementById("editCategory").value,
    unit: document.getElementById("editUnit").value.trim(),
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
