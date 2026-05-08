import { auth, db, storage } from '/firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

const $ = id => document.getElementById(id);
let products = [], orders = [], coupons = [], reviews = [], config = {}, editingProductId = null, pendingImages = [], existingImages = [];

// ── AUTH ──
onAuthStateChanged(auth, user => {
    if (user) {
        // Enforce Admin Access (Only @iesgroups.com emails)
        if (!user.email || !user.email.endsWith('@iesgroups.com')) {
            $('auth-container').classList.remove('hidden');
            $('dashboard-container').classList.add('hidden');
            const errEl = $('login-error');
            if (errEl) {
                errEl.innerHTML = `Access Denied: <strong>${user.email}</strong> does not have administrator privileges. <a href="#" id="force-logout-btn" style="color:var(--store-primary);text-decoration:underline">Sign out</a>`;
                errEl.classList.remove('hidden');
                $('force-logout-btn')?.addEventListener('click', (e) => { e.preventDefault(); signOut(auth); });
            }
            return;
        }

        $('auth-container').classList.add('hidden');
        $('dashboard-container').classList.remove('hidden');
        $('mobile-menu-btn').classList.remove('hidden');
        $('user-email-display').textContent = user.email;
        loadConfig().then(() => { 
            loadDashboard(); 
            loadProducts(); 
            loadOrders(); 
            loadCustomers();
            loadCoupons();
        });
    } else {
        $('auth-container').classList.remove('hidden');
        $('dashboard-container').classList.add('hidden');
    }
});

$('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = $('login-error');
    errEl.classList.add('hidden');
    $('login-btn').disabled = true;
    $('login-btn').innerHTML = '<span class="loading-spinner"></span> Signing in...';
    try {
        await signInWithEmailAndPassword(auth, $('login-email').value, $('login-password').value);
    } catch (err) {
        errEl.textContent = err.code === 'auth/invalid-credential' ? 'Invalid email or password' : err.message;
        errEl.classList.remove('hidden');
    }
    $('login-btn').disabled = false;
    $('login-btn').innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg> Sign In';
});

$('logout-btn').addEventListener('click', () => signOut(auth));

// ── NAV ──
document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
        $('view-' + link.dataset.view).classList.remove('hidden');
        $('sidebar').classList.remove('open');
    });
});

// ── CONFIG ──
async function loadConfig() {
    try {
        const snap = await getDoc(doc(db, 'store_config', 'settings'));
        config = snap.exists() ? snap.data() : {};
        if (!config.categories) config.categories = ['Kitchen & Dining','Industrial Hardware','Home & Storage','Custom & B2C'];
        if (!config.shippingRates) config.shippingRates = [{name:'Standard',price:60,minDays:5,maxDays:7}];
        if (config.freeShippingThreshold === undefined) config.freeShippingThreshold = 999;
        populateCategories();
    } catch(e) { console.error(e); }
}

function populateCategories() {
    const cats = config.categories || [];
    [$('product-category'), $('product-category-filter')].forEach(sel => {
        if (!sel) return;
        const isFilter = sel.id.includes('filter');
        sel.innerHTML = isFilter ? '<option value="">All Categories</option>' : '';
        cats.forEach(c => { sel.innerHTML += `<option value="${c}">${c}</option>`; });
    });
    const list = $('categories-list');
    if (list) list.innerHTML = cats.map(c => `<span class="tag">${c}<span class="tag-remove" onclick="window.storeAdmin.removeCategory('${c}')">&times;</span></span>`).join('');
}

// ── DASHBOARD ──
async function loadDashboard() {
    $('stat-total-products').textContent = products.length;
    const active = orders.filter(o => !['delivered','cancelled','deleted'].includes(o.status));
    $('stat-active-orders').textContent = active.length;
    const pv = orders.filter(o => o.paymentStatus === 'pending_verification' && o.status !== 'deleted');
    const pb = $('stat-pending-badge');
    if (pb) pb.textContent = pv.length > 0 ? pv.length + ' awaiting verification' : '';
    const now = new Date(), ms = new Date(now.getFullYear(), now.getMonth(), 1);
    const rev = orders.filter(o => o.paymentStatus === 'paid' && o.status !== 'deleted' && o.createdAt?.toDate?.() >= ms).reduce((s,o) => s + (o.total||0), 0);
    $('stat-revenue').textContent = '₹' + rev.toLocaleString('en-IN');
    $('stat-low-stock').textContent = products.filter(p => p.stock <= 5 && p.status === 'active').length;
    
    try {
        const todayStr = new Date().toLocaleDateString('en-CA');
        const metricSnap = await getDoc(doc(db, 'store_metrics', todayStr));
        const views = metricSnap.exists() ? metricSnap.data().views || 0 : 0;
        const vEl = $('stat-views-today');
        if (vEl) vEl.textContent = views;
    } catch(e) { console.warn('Could not load views:', e); }

    const tbody = $('dashboard-recent-orders');
    const validOrders = orders.filter(o => o.status !== 'deleted');
    if (!validOrders.length) { tbody.innerHTML = '<tr><td colspan="7" class="table-loading">No orders yet</td></tr>'; return; }
    tbody.innerHTML = validOrders.slice(0,5).map(o => `<tr>
        <td><strong>${o.orderNumber||o.id.slice(0,8)}</strong></td>
        <td>${o.customer?.name||'—'}</td><td>${o.items?.length||0}</td>
        <td class="text-right">₹${(o.total||0).toLocaleString('en-IN')}</td>
        <td><span class="badge badge-${o.paymentStatus||'pending'}">${(o.paymentStatus||'pending').replace(/_/g,' ')}</span></td>
        <td><span class="badge badge-${o.status||'pending'}">${(o.status||'pending').replace(/_/g,' ')}</span></td>
        <td>${o.createdAt?.toDate?.().toLocaleDateString('en-IN')||'—'}</td></tr>`).join('');
}

// ── PRODUCTS ──
async function loadProducts() {
    try {
        const snap = await getDocs(query(collection(db,'store_products'), orderBy('createdAt','desc')));
        products = snap.docs.map(d => ({id:d.id,...d.data()}));
    } catch(e) { console.error(e); products = []; }
    renderProducts();
}

function renderProducts(filter) {
    let list = [...products];
    const search = $('product-search')?.value?.toLowerCase() || '';
    const cat = $('product-category-filter')?.value || '';
    const status = $('product-status-filter')?.value || '';
    if (search) list = list.filter(p => p.title?.toLowerCase().includes(search) || p.sku?.toLowerCase().includes(search));
    if (cat) list = list.filter(p => p.category === cat);
    if (status) list = list.filter(p => p.status === status);
    const tbody = $('products-table-body');
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" class="table-loading">No products found</td></tr>'; return; }
    tbody.innerHTML = list.map(p => {
        const img = p.images?.[0] ? `<img src="${p.images[0]}" class="product-thumb" alt="">` : `<div class="product-thumb-placeholder"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>`;
        return `<tr>
            <td>${img}</td><td><strong>${p.title||''}</strong></td><td>${p.sku||'—'}</td>
            <td>${p.category||'—'}</td><td class="text-right">₹${(p.price||0).toLocaleString('en-IN')}</td>
            <td class="text-center">${p.stock??'—'}</td>
            <td><span class="badge badge-${p.status||'draft'}">${p.status||'draft'}</span></td>
            <td class="text-center">
                <div class="action-btns">
                    <button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.editProduct('${p.id}')" title="Edit">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.deleteProduct('${p.id}')" title="Delete">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </td></tr>`;
    }).join('');
}

$('product-search')?.addEventListener('input', () => renderProducts());
$('product-category-filter')?.addEventListener('change', () => renderProducts());
$('product-status-filter')?.addEventListener('change', () => renderProducts());

// Product Modal
function openProductModal(product) {
    editingProductId = product?.id || null;
    $('product-modal-title').textContent = product ? 'Edit Product' : 'Add Product';
    $('product-id').value = product?.id || '';
    $('product-title').value = product?.title || '';
    $('product-sku').value = product?.sku || '';
    $('product-category').value = product?.category || '';
    $('product-price').value = product?.price || '';
    $('product-compare-price').value = product?.compareAtPrice || '';
    $('product-stock').value = product?.stock ?? '';
    $('product-gst').value = product?.gstRate ?? 18;
    $('product-sort-order').value = product?.sortOrder ?? 0;
    $('product-amazon-link').value = product?.amazonLink || '';
    $('product-weight').value = product?.weight || '';
    $('product-description').value = product?.description || '';
    $('product-tags').value = (product?.tags || []).join(', ');
    $('product-featured').checked = product?.featured || false;
    $('product-status').value = product?.status || 'active';
    existingImages = product?.images ? [...product.images] : [];
    pendingImages = [];
    renderImagePreviews();
    $('product-modal').classList.remove('hidden');
    setTimeout(() => $('product-modal').classList.add('show'), 10);
}

function closeProductModal() {
    $('product-modal').classList.remove('show');
    setTimeout(() => $('product-modal').classList.add('hidden'), 200);
    pendingImages = []; existingImages = [];
}

function renderImagePreviews() {
    const container = $('product-image-preview');
    let html = existingImages.map((url, i) => `<div class="image-preview-item"><img src="${url}" alt=""><button type="button" class="image-preview-remove" onclick="window.storeAdmin.removeExistingImage(${i})">&times;</button></div>`).join('');
    html += pendingImages.map((f, i) => `<div class="image-preview-item"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="image-preview-remove" onclick="window.storeAdmin.removePendingImage(${i})">&times;</button></div>`).join('');
    container.innerHTML = html;
}

// Image drop zone
const dropZone = $('product-image-drop');
const fileInput = $('product-images');
if (dropZone) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); addFiles(e.dataTransfer.files); });
}
if (fileInput) fileInput.addEventListener('change', e => addFiles(e.target.files));
function addFiles(files) { pendingImages.push(...Array.from(files)); renderImagePreviews(); }

// Save product
$('product-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('product-save-btn');
    btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
    try {
        const productId = editingProductId || doc(collection(db,'store_products')).id;
        let imageUrls = [...existingImages];
        for (const file of pendingImages) {
            const ext = file.name.split('.').pop();
            const fname = `${Date.now()}_${Math.random().toString(36).substr(2,6)}.${ext}`;
            const sRef = ref(storage, `store/products/${productId}/${fname}`);
            const snap = await uploadBytes(sRef, file);
            imageUrls.push(await getDownloadURL(snap.ref));
        }
        const data = {
            title: $('product-title').value, sku: $('product-sku').value,
            category: $('product-category').value, price: parseFloat($('product-price').value) || 0,
            compareAtPrice: parseFloat($('product-compare-price').value) || 0,
            stock: parseInt($('product-stock').value) || 0,
            gstRate: parseFloat($('product-gst').value) || 18,
            sortOrder: parseInt($('product-sort-order').value) || 0,
            amazonLink: $('product-amazon-link').value || '',
            weight: parseFloat($('product-weight').value) || 0,
            description: $('product-description').value,
            tags: $('product-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
            featured: $('product-featured').checked, status: $('product-status').value,
            images: imageUrls, updatedAt: serverTimestamp()
        };
        if (editingProductId) {
            await updateDoc(doc(db,'store_products',editingProductId), data);
        } else {
            data.createdAt = serverTimestamp();
            data.slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g,'-');
            await setDoc(doc(db,'store_products',productId), data);
        }
        closeProductModal();
        toast('Product saved!','success');
        await loadProducts(); loadDashboard();
    } catch(err) { console.error(err); toast('Error: '+err.message,'error'); }
    btn.disabled = false; btn.textContent = 'Save Product';
});

async function deleteProduct(id) {
    if (!confirm('Delete this product?')) return;
    try {
        await deleteDoc(doc(db,'store_products',id));
        toast('Product deleted','success');
        await loadProducts(); loadDashboard();
    } catch(e) { toast('Error: '+e.message,'error'); }
}

$('btn-add-product')?.addEventListener('click', () => openProductModal(null));

// ── ORDERS ──
async function loadOrders() {
    try {
        const snap = await getDocs(query(collection(db,'store_orders'), orderBy('createdAt','desc')));
        orders = snap.docs.map(d => ({id:d.id,...d.data()}));
    } catch(e) { console.error(e); orders = []; }
    renderOrders(); loadDashboard();
    const pv = orders.filter(o => o.paymentStatus === 'pending_verification' && o.status !== 'deleted').length;
    const badge = $('nav-orders-badge');
    if (badge) { badge.textContent = pv; badge.classList.toggle('hidden', pv === 0); }
}

function renderOrders() {
    let list = [...orders];
    const search = $('order-search')?.value?.toLowerCase() || '';
    const status = $('order-status-filter')?.value || 'all';
    
    if (search) {
        list = list.filter(o => (o.orderNumber || o.id).toLowerCase().includes(search) || o.customer?.name?.toLowerCase().includes(search));
    }
    
    if (status !== 'all') {
        list = list.filter(o => o.status === status);
    } else {
        // By default hide deleted unless strictly filtering for them
        list = list.filter(o => o.status !== 'deleted');
    }

    const tbody = $('orders-list');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-loading">No orders found ${status === 'all' ? '' : 'in this category'}</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(o => `<tr>
        <td><strong>${o.orderNumber || o.id.slice(0, 8)}</strong></td>
        <td>${o.customer?.name || 'Guest'}<br><small style="color:var(--slate-400)">${o.customer?.email || ''}</small></td>
        <td>${o.items?.length || 0} items</td>
        <td class="text-right">₹${(o.total || 0).toLocaleString('en-IN')}</td>
        <td><span class="badge badge-${o.paymentStatus || 'pending'}">${(o.paymentStatus || 'pending').replace(/_/g, ' ')}</span></td>
        <td><span class="badge badge-${o.status || 'pending'}">${(o.status || 'pending').replace(/_/g, ' ')}</span></td>
        <td>${o.createdAt?.toDate?.().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) || '—'}</td>
        <td class="text-center">
            <div class="action-btns">
                <button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.viewOrder('${o.id}')" title="View Details">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                </button>
                <button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.printInvoice('${o.id}')" title="Print Invoice">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                </button>
                <button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.printShippingLabel('${o.id}')" title="Print Shipping Label">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
                </button>
                ${o.status === 'deleted' ? 
                    `<button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.restoreOrder('${o.id}')" title="Restore">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    </button>` : 
                    `<button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.softDeleteOrder('${o.id}')" title="Move to Trash">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>`
                }
            </div>
        </td>
    </tr>`).join('');
}

$('order-search')?.addEventListener('input', () => renderOrders());
$('order-status-filter')?.addEventListener('change', () => renderOrders());

let currentOrderId = null;
function viewOrder(id) {
    const o = orders.find(x => x.id === id);
    if (!o) return;
    currentOrderId = id;
    $('order-modal-title').textContent = 'Order ' + (o.orderNumber || o.id.slice(0,8));
    $('order-modal-body').innerHTML = `
        <div class="order-section"><div class="order-section-title">Customer & Addresses</div>
            <div class="order-info-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
                <div>
                    <span class="order-info-label">Name</span><span class="order-info-value">${o.customer?.name||'—'}</span>
                    <span class="order-info-label">Email</span><span class="order-info-value">${o.customer?.email||'—'}</span>
                    <span class="order-info-label">Phone</span><span class="order-info-value">${o.customer?.phone||'—'}</span>
                </div>
                <div>
                    <span class="order-info-label">Shipping Address</span>
                    <span class="order-info-value">
                        ${o.customer?.shippingAddress ? 
                            `${o.customer.shippingAddress.line1}${o.customer.shippingAddress.landmark ? `, ${o.customer.shippingAddress.landmark}` : ''}<br>${o.customer.shippingAddress.city}, ${o.customer.shippingAddress.state} - ${o.customer.shippingAddress.pincode}` : 
                            (o.customer?.address ? `${o.customer.address.line1}, ${o.customer.address.city} ${o.customer.address.pincode}` : '—')
                        }
                    </span>
                </div>
                <div>
                    <span class="order-info-label">Billing Address</span>
                    <span class="order-info-value">
                        ${o.customer?.billingAddress ? 
                            `${o.customer.billingAddress.line1}${o.customer.billingAddress.landmark ? `, ${o.customer.billingAddress.landmark}` : ''}<br>${o.customer.billingAddress.city}, ${o.customer.billingAddress.state} - ${o.customer.billingAddress.pincode}` : 
                            'Same as Shipping'
                        }
                    </span>
                </div>
            </div></div>
        <div class="order-section"><div class="order-section-title">Items</div>
            <div class="order-items-list">${(o.items||[]).map(it => `<div class="order-item-row">
                ${it.image ? `<img src="${it.image}" class="order-item-img">` : ''}
                <div class="order-item-info"><div class="order-item-title">${it.title}</div><div class="order-item-meta">Qty: ${it.quantity} × ₹${it.price}</div></div>
                <strong>₹${(it.price*it.quantity).toLocaleString('en-IN')}</strong>
            </div>`).join('')}</div>
            <div style="text-align:right;margin-top:.75rem;font-size:.875rem">
                <div>Subtotal: ₹${(o.subtotal||0).toLocaleString('en-IN')}</div>
                ${o.discountAmount ? `<div style="color:#059669">Discount (${o.couponCode||'Coupon'}): - ₹${o.discountAmount.toLocaleString('en-IN')}</div>` : ''}
                <div>Shipping: ₹${(o.shippingCost||0).toLocaleString('en-IN')}</div>
                <div style="font-weight:700;font-size:1rem;margin-top:.25rem">Total: ₹${(o.total||0).toLocaleString('en-IN')}</div>
            </div></div>
        ${o.utrNumber ? `<div class="order-section"><div class="order-section-title">Payment</div><div class="order-info-grid"><span class="order-info-label">UTR Number</span><span class="order-info-value" style="font-weight:600">${o.utrNumber}</span></div></div>` : ''}
        <div class="order-section"><div class="order-section-title">Update Status</div>
            <div class="form-row">
                <div class="form-group"><label class="form-label">Payment Status</label>
                    <select class="form-select" id="modal-payment-status">
                        ${['pending','pending_verification','paid','failed','refunded'].map(s => `<option value="${s}" ${o.paymentStatus===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('')}
                    </select></div>
                <div class="form-group"><label class="form-label">Order Status</label>
                    <select class="form-select" id="modal-order-status">
                        ${['pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled'].map(s => `<option value="${s}" ${o.status===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('')}
                    </select></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label class="form-label">Tracking Number</label><input class="form-input" id="modal-tracking" value="${o.trackingNumber||''}"></div>
                <div class="form-group"><label class="form-label">Carrier</label><input class="form-input" id="modal-carrier" value="${o.shippingCarrier||''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Est. Delivery Date</label>
                    <input type="date" class="form-input" id="modal-delivery-date" value="${(o.estimatedDelivery||'').split('T')[0] || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Est. Delivery Time</label>
                    <select class="form-select" id="modal-delivery-time">
                        <option value="">Select Time</option>
                        ${Array.from({length: 24}).map((_, h) => {
                            const hh = h.toString().padStart(2,'0');
                            return ['00','15','30','45'].map(mm => {
                                const time = `${hh}:${mm}`;
                                const isSel = (o.estimatedDelivery||'').split('T')[1] === time;
                                return `<option value="${time}" ${isSel?'selected':''}>${time}</option>`;
                            }).join('');
                        }).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group"><label class="form-label">Admin Notes</label><textarea class="form-textarea" id="modal-notes" rows="2">${o.notes||''}</textarea></div>
        </div>
        <div class="order-section"><div class="order-section-title">Order Timeline</div>
            <div style="font-size: .8125rem; line-height: 1.6;">
                <div style="display:flex; justify-content:space-between; padding: .25rem 0; border-bottom: 1px solid var(--surface-border);">
                    <span style="color:var(--text-muted)">Order Received</span>
                    <strong>${o.createdAt?.toDate?.().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) || '—'}</strong>
                </div>
                ${(o.statusHistory || []).map(h => `
                    <div style="padding: .5rem 0; border-bottom: 1px solid var(--surface-border);">
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:var(--primary-600); font-weight:600;">${h.toStatus.replace(/_/g, ' ').toUpperCase()}</span>
                            <span style="color:var(--text-muted); font-size: .75rem;">${new Date(h.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
                        </div>
                        <div style="font-size: .75rem; color: var(--text-muted);">By: ${h.admin}</div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    $('order-modal').classList.remove('hidden');
    setTimeout(() => $('order-modal').classList.add('show'), 10);
}

function closeOrderModal() {
    $('order-modal').classList.remove('show');
    setTimeout(() => $('order-modal').classList.add('hidden'), 200);
    currentOrderId = null;
}

async function deleteOrder(id) {
    if (!confirm('Are you sure you want to delete this order? This action cannot be undone.')) return;
    try {
        await deleteDoc(doc(db, 'store_orders', id));
        toast('Order deleted successfully', 'success');
        if (currentOrderId === id) closeOrderModal();
        await loadOrders();
    } catch(e) {
        toast('Error deleting order: ' + e.message, 'error');
    }
}

function printShippingLabel(id) {
    const o = orders.find(x => x.id === id);
    if (!o) return;

    document.body.classList.add('printing-label');
    document.body.classList.remove('printing-invoice');

    $('lbl-order-id').textContent = o.orderNumber || o.id.slice(0, 8).toUpperCase();
    $('lbl-print-date').textContent = new Date().toLocaleDateString('en-IN');

    // Recipient
    const s = o.shippingAddress || o.customer?.address || {};
    $('lbl-to-name').textContent = s.name || o.customer?.name || 'Customer';
    $('lbl-to-address').innerHTML = `${s.line1 || ''}${s.landmark ? ', ' + s.landmark : ''}<br>${s.city || ''}, ${s.state || ''} - ${s.pincode || ''}`;
    $('lbl-to-phone').textContent = s.phone || o.customer?.phone || 'N/A';

    // Packing List
    const itemsTbody = $('lbl-items');
    itemsTbody.innerHTML = (o.items || []).map(it => `
        <tr>
            <td><strong>${it.title}</strong></td>
            <td class="text-center">${it.quantity}</td>
        </tr>
    `).join('');

    window.print();
}

function printInvoice(id) {
    const o = orders.find(x => x.id === id);
    if (!o) return;

    document.body.classList.add('printing-invoice');
    document.body.classList.remove('printing-label');

    // Fill Invoice Template
    $('inv-from-address').textContent = config.companyAddress || 'Innovative Engineering Solutions, Plot 19, Self Help Industrial Estate, Echangadu, Chennai - 600117';
    $('inv-from-gst').textContent = config.gstNumber || '33AOMPM0883R1Z7';
    
    // Meta
    $('inv-number').textContent = o.orderNumber || o.id.slice(0, 8).toUpperCase();
    $('inv-date').textContent = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
    $('inv-supply-place').textContent = o.customer?.address?.state || 'Tamil Nadu';
    $('inv-payment').textContent = (o.paymentStatus || 'pending').toUpperCase();

    // Customer
    const custAddr = o.billingAddress || o.customer?.address || {};
    $('inv-to-name').textContent = custAddr.name || o.customer?.name || 'Customer';
    $('inv-to-address').innerHTML = `${custAddr.line1 || ''}${custAddr.landmark ? ', ' + custAddr.landmark : ''}<br>${custAddr.city || ''}, ${custAddr.state || ''} - ${custAddr.pincode || ''}`;
    $('inv-to-phone').textContent = 'Phone: ' + (custAddr.phone || o.customer?.phone || 'N/A');

    // Shipping
    const shipAddr = o.shippingAddress || o.customer?.address || {};
    $('inv-ship-name').textContent = shipAddr.name || o.customer?.name || 'Customer';
    $('inv-ship-address').innerHTML = `${shipAddr.line1 || ''}${shipAddr.landmark ? ', ' + shipAddr.landmark : ''}<br>${shipAddr.city || ''}, ${shipAddr.state || ''} - ${shipAddr.pincode || ''}`;

    // Items
    const itemsTbody = $('inv-items');
    itemsTbody.innerHTML = (o.items || []).map((it, idx) => `
        <tr>
            <td class="text-center">${idx + 1}</td>
            <td><strong>${it.title}</strong></td>
            <td class="text-center">${it.quantity}</td>
            <td class="text-right">₹${it.price.toLocaleString('en-IN')}</td>
            <td class="text-right">₹${(it.price * it.quantity).toLocaleString('en-IN')}</td>
        </tr>
    `).join('');

    // Totals
    const grossTotal = o.subtotal || 0;
    const discount = o.discountAmount || 0;
    const taxableValue = grossTotal - discount;
    const shipping = o.shippingCost || 0;
    
    const cgstRate = 9;
    const sgstRate = 9;
    const cgstAmount = Math.round(taxableValue * (cgstRate / 100) * 100) / 100;
    const sgstAmount = Math.round(taxableValue * (sgstRate / 100) * 100) / 100;
    
    $('inv-gross').textContent = '₹' + grossTotal.toLocaleString('en-IN');
    
    if (discount > 0) {
        $('inv-discount-row').style.display = 'flex';
        $('inv-coupon').textContent = o.couponCode || 'Discount';
        $('inv-discount').textContent = '- ₹' + discount.toLocaleString('en-IN');
    } else {
        $('inv-discount-row').style.display = 'none';
    }

    $('inv-taxable').textContent = '₹' + taxableValue.toLocaleString('en-IN');
    $('inv-cgst-amount').textContent = '₹' + cgstAmount.toLocaleString('en-IN');
    $('inv-sgst-amount').textContent = '₹' + sgstAmount.toLocaleString('en-IN');
    $('inv-shipping').textContent = '₹' + shipping.toLocaleString('en-IN');
    
    const total = o.total || (taxableValue + cgstAmount + sgstAmount + shipping);
    $('inv-total').textContent = '₹' + total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    const wholeNumber = Math.floor(total);
    const paise = Math.round((total - wholeNumber) * 100);
    let words = numberToWords(wholeNumber);
    if (paise > 0) words += ' and ' + numberToWords(paise) + ' Paise';
    $('inv-total-words').textContent = 'Amount in Words: ' + words + ' Only';

    window.print();
}

function numberToWords(number) {
    const first = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const mad = ['', 'Thousand', 'Lakh', 'Crore'];
    
    let word = '';
    
    const splitNumber = (num) => {
        let n = num.toString().split('');
        let groups = [];
        if (n.length > 3) {
            groups.push(n.splice(-3).join(''));
            while (n.length > 0) {
                groups.push(n.splice(-2).join(''));
            }
        } else {
            groups.push(n.join(''));
        }
        return groups;
    };

    const convertGroup = (g) => {
        let n = parseInt(g);
        if (n === 0) return '';
        let res = '';
        if (n >= 100) {
            res += first[Math.floor(n / 100)] + ' Hundred ';
            n %= 100;
        }
        if (n >= 20) {
            res += tens[Math.floor(n / 10)] + ' ';
            n %= 10;
        }
        if (n > 0) {
            res += first[n] + ' ';
        }
        return res;
    };

    let groups = splitNumber(number);
    for (let i = 0; i < groups.length; i++) {
        let gWords = convertGroup(groups[i]);
        if (gWords) {
            word = gWords + (mad[i] ? mad[i] + ' ' : '') + word;
        }
    }
    
    return word.trim() || 'Zero';
}

$('btn-save-order')?.addEventListener('click', async () => {
    if (!currentOrderId) return;
    const o = orders.find(x => x.id === currentOrderId);
    if (!o) return;

    const newStatus = $('modal-order-status').value;
    const newPaymentStatus = $('modal-payment-status').value;
    
    try {
        const updateData = {
            paymentStatus: newPaymentStatus,
            status: newStatus,
            trackingNumber: $('modal-tracking').value,
            shippingCarrier: $('modal-carrier').value,
            estimatedDelivery: ($('modal-delivery-date').value && $('modal-delivery-time').value) ? ($('modal-delivery-date').value + 'T' + $('modal-delivery-time').value) : ($('modal-delivery-date').value || ''),
            notes: $('modal-notes').value,
            updatedAt: serverTimestamp()
        };

        // Log status change if it's different
        if (newStatus !== o.status || newPaymentStatus !== o.paymentStatus) {
            const historyEntry = {
                fromStatus: o.status,
                toStatus: newStatus,
                fromPayment: o.paymentStatus,
                toPayment: newPaymentStatus,
                timestamp: new Date().toISOString(), // Use client date for immediate display, but it's okay
                admin: auth.currentUser?.email || 'System'
            };
            
            // Using arrayUnion would be safer but let's just push to local then save
            const history = o.statusHistory || [];
            history.push(historyEntry);
            updateData.statusHistory = history;
        }

        await updateDoc(doc(db, 'store_orders', currentOrderId), updateData);
        toast('Order updated!', 'success');
        closeOrderModal();
        await loadOrders();
    } catch (err) { console.error(err); toast('Error: ' + err.message, 'error'); }
});

async function softDeleteOrder(id) {
    if (!confirm('Move this order to Trash?')) return;
    try {
        await updateDoc(doc(db, 'store_orders', id), { status: 'deleted', updatedAt: serverTimestamp() });
        toast('Order moved to Trash', 'success');
        await loadOrders();
    } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function restoreOrder(id) {
    try {
        await updateDoc(doc(db, 'store_orders', id), { status: 'pending', updatedAt: serverTimestamp() });
        toast('Order restored', 'success');
        await loadOrders();
    } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ── SHIPPING & UPI ──
$('btn-save-shipping')?.addEventListener('click', async () => {
    try {
        config.freeShippingThreshold = parseFloat($('free-shipping-threshold').value) || 0;
        config.razorpayKeyId = $('razorpay-key-id').value;
        await setDoc(doc(db,'store_config','settings'), config, {merge:true});
        toast('Shipping settings saved!','success');
    } catch(e) { toast('Error: '+e.message,'error'); }
});

// ── CUSTOMERS ──
let allCustomers = [];
function loadCustomers() {
    const tbody = $('customers-list');
    if (!tbody) return;
    
    const q = query(collection(db, 'store_customers'), orderBy('createdAt', 'desc'));
    
    return onSnapshot(q, (snap) => {
        allCustomers = snap.docs.map(d => ({id:d.id, ...d.data()}));
        renderCustomers(allCustomers);
    });
}

function renderCustomers(customers) {
    const tbody = $('customers-list');
    if (!tbody) return;

    if (!customers.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-loading">No customers found</td></tr>';
        return;
    }

    const searchTerm = $('customer-search')?.value.toLowerCase() || '';
    const filtered = customers.filter(c => 
        (c.name || '').toLowerCase().includes(searchTerm) || 
        (c.email || '').toLowerCase().includes(searchTerm)
    );

    tbody.innerHTML = filtered.map(c => {
        const customerOrders = orders.filter(o => o.customer?.uid === c.id || o.customer?.email === c.email);
        return `<tr>
            <td><strong>${c.name || '—'}</strong></td>
            <td>${c.email || '—'}</td>
            <td>${c.phone || '—'}</td>
            <td><span class="badge badge-paid">${customerOrders.length} orders</span></td>
            <td>${c.createdAt?.toDate?.().toLocaleDateString('en-IN') || '—'}</td>
            <td class="text-center">
                <div class="action-btns">
                    <button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.viewCustomer('${c.id}')" title="View Profile">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

$('customer-search')?.addEventListener('input', () => renderCustomers(allCustomers));

let customersList = [];

async function viewCustomer(id) {
    const snap = await getDoc(doc(db, 'store_customers', id));
    if (!snap.exists()) return;
    const c = snap.data();
    
    const customerOrders = orders.filter(o => o.customer?.uid === id || o.customer?.email === c.email);
    const ltv = customerOrders.filter(o => o.paymentStatus === 'paid' || o.status === 'delivered').reduce((s, o) => s + (o.total || 0), 0);

    $('customer-modal-title').textContent = 'Customer Profile';
    
    const renderAddr = (a) => {
        if (!a || !a.line1) return '<span style="color:var(--text-muted)">Not saved</span>';
        return `${a.line1}${a.landmark ? `, ${a.landmark}` : ''}<br>${a.city}, ${a.state} - ${a.pincode}`;
    };

    $('customer-modal-body').innerHTML = `
        <div class="order-section">
            <div class="order-section-title">Details</div>
            <div class="order-info-grid">
                <span class="order-info-label">Name</span><span class="order-info-value">${c.name || '—'}</span>
                <span class="order-info-label">Email</span><span class="order-info-value">${c.email || '—'}</span>
                <span class="order-info-label">Phone</span><span class="order-info-value">${c.phone || '—'}</span>
                <span class="order-info-label">Joined</span><span class="order-info-value">${c.createdAt?.toDate?.().toLocaleDateString('en-IN') || '—'}</span>
            </div>
            <div class="order-info-grid" style="margin-top: 1rem; border-top: 1px solid var(--surface-border); padding-top: 1rem;">
                <div>
                    <span class="order-info-label">Shipping Address</span>
                    <div class="order-info-value" style="font-size: 0.8125rem; line-height: 1.5; margin-top: 0.25rem;">
                        ${renderAddr(c.shippingAddress || (c.addresses?.[0]))}
                    </div>
                </div>
                <div>
                    <span class="order-info-label">Billing Address</span>
                    <div class="order-info-value" style="font-size: 0.8125rem; line-height: 1.5; margin-top: 0.25rem;">
                        ${renderAddr(c.billingAddress)}
                    </div>
                </div>
            </div>
        </div>
        <div class="order-section">
            <div class="order-section-title">Metrics</div>
            <div class="stats-grid" style="grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 0;">
                <div class="stat-card" style="padding:1rem">
                    <div class="stat-content">
                        <h3 style="margin-bottom:0">Total Orders</h3>
                        <p style="font-size:1.25rem">${customerOrders.length}</p>
                    </div>
                </div>
                <div class="stat-card" style="padding:1rem">
                    <div class="stat-content">
                        <h3 style="margin-bottom:0">Lifetime Value</h3>
                        <p style="font-size:1.25rem">₹${ltv.toLocaleString('en-IN')}</p>
                    </div>
                </div>
            </div>
        </div>
        <div class="order-section">
            <div class="order-section-title">Order History</div>
            <div class="order-items-list" style="max-height: 250px; overflow-y: auto;">
                ${customerOrders.length ? customerOrders.map(o => `
                <div class="order-item-row" style="cursor:pointer" onclick="window.storeAdmin.viewOrder('${o.id}')">
                    <div class="order-item-info">
                        <div class="order-item-title">Order ${o.orderNumber || o.id.slice(0,8)}</div>
                        <div class="order-item-meta">${o.createdAt?.toDate?.().toLocaleDateString('en-IN')} • ${o.items?.length || 0} items</div>
                    </div>
                    <div style="text-align:right">
                        <span class="badge badge-${o.status}">${(o.status||'').replace('_',' ')}</span>
                        <div style="font-weight:600; margin-top:0.25rem">₹${(o.total||0).toLocaleString('en-IN')}</div>
                    </div>
                </div>`).join('') : '<div style="padding:1rem;text-align:center;color:var(--text-muted)">No orders placed yet.</div>'}
            </div>
        </div>
    `;

    $('customer-modal').classList.remove('hidden');
    setTimeout(() => $('customer-modal').classList.add('show'), 10);
}

function closeCustomerModal() {
    $('customer-modal').classList.remove('show');
    setTimeout(() => $('customer-modal').classList.add('hidden'), 200);
}


function loadShippingView() {
    $('free-shipping-threshold').value = config.freeShippingThreshold || 0;
    $('razorpay-key-id').value = config.razorpayKeyId || '';
    const container = $('shipping-rates-container');
    container.innerHTML = (config.shippingRates||[]).map((r,i) => `<div class="shipping-rate-card">
        <button class="btn btn-ghost btn-sm ship-remove-btn" onclick="window.storeAdmin.removeShippingRate(${i})" title="Remove Rate">🗑️</button>
        <div class="form-row"><div class="form-group"><label class="form-label">Name</label><input class="form-input ship-name" value="${r.name}" data-idx="${i}"></div>
        <div class="form-group"><label class="form-label">Price (₹)</label><input type="number" class="form-input ship-price" value="${r.price}" data-idx="${i}"></div></div>
        <div class="form-row"><div class="form-group"><label class="form-label">Min Days</label><input type="number" class="form-input ship-min" value="${r.minDays}" data-idx="${i}"></div>
        <div class="form-group"><label class="form-label">Max Days</label><input type="number" class="form-input ship-max" value="${r.maxDays}" data-idx="${i}"></div></div>
    </div>`).join('') + '<button class="btn btn-secondary btn-sm" style="margin-top:.75rem" onclick="window.storeAdmin.addShippingRate()">+ Add Rate</button>';
    container.querySelectorAll('.ship-name,.ship-price,.ship-min,.ship-max').forEach(inp => {
        inp.addEventListener('change', () => {
            const i = parseInt(inp.dataset.idx);
            if (inp.classList.contains('ship-name')) config.shippingRates[i].name = inp.value;
            if (inp.classList.contains('ship-price')) config.shippingRates[i].price = parseFloat(inp.value)||0;
            if (inp.classList.contains('ship-min')) config.shippingRates[i].minDays = parseInt(inp.value)||0;
            if (inp.classList.contains('ship-max')) config.shippingRates[i].maxDays = parseInt(inp.value)||0;
        });
    });
}

// ── COUPONS ──
async function loadCoupons() {
    try {
        const snap = await getDocs(query(collection(db, 'store_coupons'), orderBy('createdAt', 'desc')));
        coupons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error(e); coupons = []; }
    renderCoupons();
}

function renderCoupons() {
    const tbody = $('coupons-list');
    if (!tbody) return;
    if (!coupons.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="table-loading">No coupons found</td></tr>';
        return;
    }
    tbody.innerHTML = coupons.map(c => `<tr>
        <td><strong>${c.code}</strong></td>
        <td>${c.value}${c.type === 'percentage' ? '%' : '₹'}</td>
        <td class="text-capitalize">${c.type}</td>
        <td>₹${c.minOrder || 0}</td>
        <td>${c.expiry ? (c.expiry.toDate ? c.expiry.toDate().toLocaleDateString('en-IN') : new Date(c.expiry).toLocaleDateString('en-IN')) : 'Never'}</td>
        <td class="text-center">${c.usageCount || 0}</td>
        <td class="text-center">${c.limitPerUser ? c.limitPerUser : '∞'}</td>
        <td><span class="badge badge-${c.status === 'active' ? 'emerald' : 'slate'}">${c.status}</span></td>
        <td class="text-center"><div class="action-btns">
            <button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.editCoupon('${c.id}')" title="Edit">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
            <button class="btn btn-ghost btn-sm" onclick="window.storeAdmin.deleteCoupon('${c.id}')" title="Delete">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
        </div></td></tr>`).join('');
}

let editingCouponId = null;
function openCouponModal(coupon) {
    editingCouponId = coupon?.id || null;
    $('coupon-modal-title').textContent = coupon ? 'Edit Coupon' : 'Add Coupon';
    $('coupon-id').value = coupon?.id || '';
    $('coupon-code').value = coupon?.code || '';
    $('coupon-type').value = coupon?.type || 'percentage';
    $('coupon-value').value = coupon?.value || '';
    $('coupon-min-order').value = coupon?.minOrder || 0;
    $('coupon-limit-per-user').value = coupon?.limitPerUser || 0;
    
    let expiryVal = '';
    if (coupon?.expiry) {
        const d = coupon.expiry.toDate ? coupon.expiry.toDate() : new Date(coupon.expiry);
        expiryVal = d.toISOString().split('T')[0];
    }
    $('coupon-expiry').value = expiryVal;
    $('coupon-status').value = coupon?.status || 'active';
    $('coupon-modal').classList.remove('hidden');
    setTimeout(() => $('coupon-modal').classList.add('show'), 10);
}

function closeCouponModal() {
    $('coupon-modal').classList.remove('show');
    setTimeout(() => $('coupon-modal').classList.add('hidden'), 200);
}

$('coupon-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('coupon-save-btn');
    btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
    try {
        const data = {
            code: $('coupon-code').value.toUpperCase(),
            type: $('coupon-type').value,
            value: parseFloat($('coupon-value').value) || 0,
            minOrder: parseFloat($('coupon-min-order').value) || 0,
            limitPerUser: parseInt($('coupon-limit-per-user').value) || 0,
            expiry: $('coupon-expiry').value ? new Date($('coupon-expiry').value) : null,
            status: $('coupon-status').value,
            updatedAt: serverTimestamp()
        };
        if (editingCouponId) {
            await updateDoc(doc(db, 'store_coupons', editingCouponId), data);
        } else {
            data.createdAt = serverTimestamp();
            data.usageCount = 0;
            await addDoc(collection(db, 'store_coupons'), data);
        }
        closeCouponModal();
        toast('Coupon saved!', 'success');
        await loadCoupons();
    } catch (err) { console.error(err); toast('Error: ' + err.message, 'error'); }
    btn.disabled = false; btn.textContent = 'Save Coupon';
});

async function deleteCoupon(id) {
    if (!confirm('Delete this coupon?')) return;
    try {
        await deleteDoc(doc(db, 'store_coupons', id));
        toast('Coupon deleted', 'success');
        await loadCoupons();
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

$('btn-add-coupon')?.addEventListener('click', () => openCouponModal(null));

// ── SETTINGS ──
$('btn-save-settings')?.addEventListener('click', async () => {
    try {
        config.storeName = $('setting-store-name').value;
        config.taxRate = parseFloat($('setting-tax-rate').value) || 0;
        config.gstNumber = $('setting-gst-number').value;
        config.companyAddress = $('setting-company-address').value;
        config.storeActive = $('setting-store-active').checked;
        await setDoc(doc(db,'store_config','settings'), config, {merge:true});
        toast('Settings saved!','success');
    } catch(e) { toast('Error: '+e.message,'error'); }
});

$('btn-add-category')?.addEventListener('click', () => {
    const val = $('new-category-input').value.trim();
    if (!val || config.categories.includes(val)) return;
    config.categories.push(val);
    populateCategories();
    $('new-category-input').value = '';
});

function loadSettingsView() {
    $('setting-store-name').value = config.storeName || 'IES Store';
    $('setting-tax-rate').value = config.taxRate || 0;
    $('setting-gst-number').value = config.gstNumber || '';
    $('setting-company-address').value = config.companyAddress || '';
    $('setting-store-active').checked = config.storeActive !== false;
}

// ── REVIEWS ──
let reviewsLoaded = false;
async function loadReviews() {
    try {
        const snap = await getDocs(query(collection(db, 'store_reviews'), orderBy('createdAt', 'desc')));
        reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderReviews();
        // Update badge count
        const pending = reviews.filter(r => r.status === 'pending').length;
        const badge = $('nav-reviews-badge');
        if (badge) { badge.textContent = pending; badge.classList.toggle('hidden', pending === 0); }
        reviewsLoaded = true;
    } catch(e) { console.error('Error loading reviews:', e); }
}

function renderReviews() {
    const container = $('reviews-list-container');
    if (!container) return;
    const search = $('review-search')?.value?.toLowerCase() || '';
    const statusFilter = $('review-status-filter')?.value || 'all';

    let list = [...reviews];
    if (search) list = list.filter(r => (r.customerName||'').toLowerCase().includes(search) || (r.reviewText||'').toLowerCase().includes(search) || (r.productTitle||'').toLowerCase().includes(search));
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter);

    if (!list.length) {
        container.innerHTML = '<div class="card"><div class="card-body" style="text-align:center; padding:2rem; color:var(--text-muted)">No reviews found</div></div>';
        return;
    }

    container.innerHTML = list.map(r => {
        const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
        const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';
        const statusColors = { pending: 'var(--warning)', approved: 'var(--success)', rejected: 'var(--error)' };
        const statusColor = statusColors[r.status] || 'var(--text-muted)';
        return `<div class="card" style="border-left: 3px solid ${statusColor}">
            <div class="card-body" style="padding: 1.25rem">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 0.75rem">
                    <div>
                        <strong style="font-size: 1rem">${r.productTitle || 'Unknown Product'}</strong>
                        <div style="color: #f59e0b; font-size: 1.1rem; letter-spacing: 2px; margin-top: 0.25rem">${stars}</div>
                    </div>
                    <span class="badge badge-${r.status}" style="text-transform: capitalize">${r.status || 'pending'}</span>
                </div>
                <p style="color: var(--text-main); margin-bottom: 0.75rem; line-height: 1.6; font-size: 0.9375rem">${r.reviewText || '<em>No written review</em>'}</p>
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap: wrap; gap: 0.5rem">
                    <div style="font-size: 0.8125rem; color: var(--text-muted)">
                        <strong style="color: var(--text-main)">${r.customerName || 'Anonymous'}</strong> · ${date}
                        ${r.verified ? ' · <span style="color: var(--success); font-weight:600">✓ Verified Purchase</span>' : ''}
                    </div>
                    <div class="action-btns" style="display:flex; gap:0.375rem">
                        ${r.status !== 'approved' ? `<button class="btn btn-sm" style="background:var(--success);color:#fff;padding:.375rem .75rem" onclick="window.storeAdmin.approveReview('${r.id}')" title="Approve">Approve</button>` : ''}
                        ${r.status !== 'rejected' ? `<button class="btn btn-sm" style="background:var(--warning);color:#000;padding:.375rem .75rem" onclick="window.storeAdmin.rejectReview('${r.id}')" title="Reject">Reject</button>` : ''}
                        <button class="btn btn-sm" style="background:var(--error);color:#fff;padding:.375rem .75rem" onclick="window.storeAdmin.deleteReview('${r.id}')" title="Delete">Delete</button>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

$('review-search')?.addEventListener('input', () => renderReviews());
$('review-status-filter')?.addEventListener('change', () => renderReviews());

async function approveReview(id) {
    try {
        await updateDoc(doc(db, 'store_reviews', id), { status: 'approved', moderatedAt: serverTimestamp() });
        const r = reviews.find(x => x.id === id);
        if (r) r.status = 'approved';
        renderReviews();
        // Update product average rating
        if (r?.productId) updateProductRating(r.productId);
        toast('Review approved!', 'success');
    } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function rejectReview(id) {
    try {
        await updateDoc(doc(db, 'store_reviews', id), { status: 'rejected', moderatedAt: serverTimestamp() });
        const r = reviews.find(x => x.id === id);
        if (r) r.status = 'rejected';
        renderReviews();
        if (r?.productId) updateProductRating(r.productId);
        toast('Review rejected.', 'warning');
    } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteReview(id) {
    if (!confirm('Permanently delete this review?')) return;
    try {
        const r = reviews.find(x => x.id === id);
        await deleteDoc(doc(db, 'store_reviews', id));
        reviews = reviews.filter(x => x.id !== id);
        renderReviews();
        if (r?.productId) updateProductRating(r.productId);
        toast('Review deleted.', 'success');
    } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function updateProductRating(productId) {
    try {
        const approvedForProduct = reviews.filter(r => r.productId === productId && r.status === 'approved');
        const count = approvedForProduct.length;
        const avg = count > 0 ? Math.round((approvedForProduct.reduce((s, r) => s + (r.rating || 0), 0) / count) * 10) / 10 : 0;
        await updateDoc(doc(db, 'store_products', productId), { avgRating: avg, reviewCount: count });
    } catch(e) { console.error('Error updating product rating:', e); }
}

// ── VIEW SWITCHING HOOK ──
document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    link.addEventListener('click', () => {
        const v = link.dataset.view;
        if (v === 'shipping') loadShippingView();
        if (v === 'settings') loadSettingsView();
        if (v === 'customers') loadCustomers();
        if (v === 'coupons') loadCoupons();
        if (v === 'reviews') loadReviews();
    });
});

// ── TOAST ──
function toast(msg, type='info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    $('toast-container').appendChild(el);
    setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }, 3000);
}


// ── ANALYTICS ──
async function viewAnalytics() {
    $('analytics-modal').classList.remove('hidden');
    setTimeout(() => $('analytics-modal').classList.add('show'), 10);
    const tbody = $('analytics-table-body');
    tbody.innerHTML = '<tr><td colspan="2" class="table-loading">Loading data...</td></tr>';
    
    try {
        const snap = await getDocs(query(collection(db, 'store_metrics'), orderBy('date', 'desc')));
        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="2" class="table-loading">No history found</td></tr>';
            return;
        }
        tbody.innerHTML = snap.docs.map(d => {
            const data = d.data();
            // Try to parse the date nicely
            let displayDate = data.date;
            try {
                const dateObj = new Date(data.date);
                if (!isNaN(dateObj)) displayDate = dateObj.toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
            } catch(e){}
            return `<tr>
                <td><strong>${displayDate}</strong></td>
                <td class="text-right">${data.views || 0}</td>
            </tr>`;
        }).join('');
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="2" style="color:var(--error);text-align:center;padding:1rem">Error: ${e.message}</td></tr>`;
    }
}

function closeAnalyticsModal() {
    $('analytics-modal').classList.remove('show');
    setTimeout(() => $('analytics-modal').classList.add('hidden'), 200);
}

// ── GLOBAL API ──
window.storeAdmin = {
    editProduct: id => openProductModal(products.find(p=>p.id===id)),
    deleteProduct,
    closeProductModal,
    removeExistingImage: i => { existingImages.splice(i,1); renderImagePreviews(); },
    removePendingImage: i => { pendingImages.splice(i,1); renderImagePreviews(); },
    viewOrder,
    closeOrderModal,
    deleteOrder,
    softDeleteOrder,
    restoreOrder,
    printInvoice,
    printShippingLabel,
    removeCategory: c => { config.categories = config.categories.filter(x=>x!==c); populateCategories(); },
    addShippingRate: () => { config.shippingRates.push({name:'New Rate',price:0,minDays:3,maxDays:5}); loadShippingView(); },
    removeShippingRate: i => { config.shippingRates.splice(i,1); loadShippingView(); },
    editCoupon: id => openCouponModal(coupons.find(c => c.id === id)),
    deleteCoupon,
    closeCouponModal,
    viewCustomer,
    closeCustomerModal,
    approveReview,
    rejectReview,
    deleteReview,
    viewAnalytics,
    closeAnalyticsModal,
    unlockRazorpay: () => {
        const pw = prompt('Enter Admin Password to Unlock:');
        if (pw === 'IES2013') {
            $('razorpay-key-id').disabled = false;
            $('razorpay-key-id').type = 'text';
            $('btn-unlock-razorpay').style.display = 'none';
            toast('Razorpay settings unlocked!', 'success');
        } else if (pw !== null) {
            toast('Incorrect password!', 'error');
        }
    }
};

document.addEventListener('click', e => {
    if (e.target && e.target.id === 'btn-unlock-razorpay') window.storeAdmin.unlockRazorpay();
});
