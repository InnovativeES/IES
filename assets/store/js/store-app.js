import { auth, db } from '../../../firebase-config.js';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, doc, getDocs, getDoc, setDoc, addDoc, updateDoc, query, where, orderBy, serverTimestamp, runTransaction, increment, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const googleProvider = new GoogleAuthProvider();

const $ = id => document.getElementById(id);

// --- STATE ---
let products = [];
let categories = [];
let storeConfig = {};
let cart = JSON.parse(localStorage.getItem('ies_cart') || '[]');
let currentUser = null;
let currentProfile = null;
let appliedCoupon = null;
let customerOrders = [];
let userReviews = [];

const maskName = (name) => {
    if (!name) return 'Anonymous';
    if (name.length <= 2) return name;
    const first = name.substring(0, 2);
    const last = name.substring(name.length - 2);
    return first + '***' + last;
};

// --- AUTH ---

onAuthStateChanged(auth, async user => {
    currentUser = user;
    if (user) {
        // Fetch or create customer profile
        const profileRef = doc(db, 'store_customers', user.uid);
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
            currentProfile = profileSnap.data();
        } else {
            currentProfile = {
                name: user.displayName, email: user.email,
                phone: user.phoneNumber || '',
                shippingAddress: {},
                billingAddress: {},
                createdAt: serverTimestamp()
            };
            await setDoc(profileRef, currentProfile);
        }
        updateAuthUI();
    } else {
        currentProfile = null;
        updateAuthUI();
    }
});

function updateAuthUI() {
    const authBtn = $('nav-auth-btn');
    if (!authBtn) return;
    if (currentUser) {
        authBtn.innerHTML = `
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
            <span style="margin-left: 0.5rem; font-weight: 500">My Account</span>`;
        authBtn.onclick = () => location.hash = '#account';
        const checkoutAuth = $('checkout-auth-prompt');
        if (checkoutAuth) checkoutAuth.style.display = 'none';
        const checkoutForm = $('checkout-form-container');
        if (checkoutForm) {
            checkoutForm.style.display = 'block';
            prefillCheckout();
        }
    } else {
        authBtn.innerHTML = `
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>
            <span style="margin-left: 0.5rem; font-weight: 500">Sign In</span>`;
        authBtn.onclick = loginWithGoogle;
        const checkoutAuth = $('checkout-auth-prompt');
        if (checkoutAuth) checkoutAuth.style.display = 'block';
        const checkoutForm = $('checkout-form-container');
        if (checkoutForm) checkoutForm.style.display = 'none';
    }
}

async function loginWithGoogle() {
    try {
        await signInWithPopup(auth, googleProvider);
        if (location.hash === '#checkout') {
            toast('Successfully logged in!', 'success');
        }
    } catch (e) { toast('Login failed: ' + e.message, 'error'); }
}

// --- INITIALIZATION ---
async function initStore() {
    try {
        const configSnap = await getDoc(doc(db, 'store_config', 'settings'));
        if (configSnap.exists()) {
            storeConfig = configSnap.data();
            categories = storeConfig.categories || [];
        }
        const productsSnap = await getDocs(query(collection(db, 'store_products'), where('status', '==', 'active')));
        products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        products.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        
        updateCartBadges();
        handleRoute(); // initial route

        // Track daily views
        const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local format
        if (!sessionStorage.getItem('ies_store_visited_' + today)) {
            sessionStorage.setItem('ies_store_visited_' + today, 'true');
            setDoc(doc(db, 'store_metrics', today), { views: increment(1), date: today }, { merge: true }).catch(e => console.warn('View tracking failed (likely rules):', e));
        }
    } catch (e) {
        console.error("Error initializing store:", e);
    }
}

// --- ROUTING ---
window.addEventListener('hashchange', handleRoute);

function handleRoute() {
    const hash = location.hash || '#home';
    const views = document.querySelectorAll('.store-view');
    views.forEach(v => v.classList.remove('active'));
    window.scrollTo(0, 0);

    if (hash === '#home' || hash === '') {
        $('view-home').classList.add('active');
        renderHome();
    } else if (hash.startsWith('#products')) {
        $('view-products').classList.add('active');
        const urlParams = new URLSearchParams(hash.split('?')[1]);
        renderProducts(urlParams.get('category'));
    } else if (hash.startsWith('#product/')) {
        $('view-product-detail').classList.add('active');
        const id = hash.split('/')[1];
        renderProductDetail(id);
    } else if (hash === '#cart') {
        // Instead of a separate view, just open the drawer
        if (location.hash === '#cart') {
            history.replaceState(null, null, ' '); // Clear the hash without reloading
        }
        openCartDrawer();
    } else if (hash === '#checkout') {
        $('view-checkout').classList.add('active');
        renderCheckout();
    } else if (hash === '#account') {
        $('view-account').classList.add('active');
        renderAccount();
    } else if (hash.startsWith('#order/')) {
        $('view-order-success').classList.add('active');
        const id = hash.split('/')[1];
        renderOrderSuccess(id);
    } else {
        // Only set home if it's an unrecognized hash
        if (location.hash) location.hash = '#home';
    }
}

// --- HOME VIEW ---
function renderHome() {
    const grid = $('home-featured-grid');
    if (!grid) return;
    // Sort products by sortOrder (ascending)
    products.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const featured = products.filter(p => p.featured).slice(0, 8);
    if (featured.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--store-text-muted)">No featured products currently.</p>';
        return;
    }
    grid.innerHTML = featured.map(createProductCard).join('');
}

// --- PRODUCTS VIEW ---
function renderProducts(category) {
    const grid = $('products-grid');
    const chipContainer = $('category-filters');
    if (!grid || !chipContainer) return;

    // Render chips
    chipContainer.innerHTML = `<button class="chip ${!category ? 'active' : ''}" onclick="location.hash='#products'">All</button>` +
        categories.map(c => `<button class="chip ${category === c ? 'active' : ''}" onclick="location.hash='#products?category=${encodeURIComponent(c)}'">${c}</button>`).join('');

    // Filter and Sort products
    let list = [...products].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    if (category) {
        list = list.filter(p => p.category === category);
    }
    const search = $('store-search-input')?.value?.toLowerCase();
    if (search) {
        list = list.filter(p => p.title.toLowerCase().includes(search) || p.tags?.some(t => t.toLowerCase().includes(search)));
    }

    if (list.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1"><p>No products found.</p></div>';
        return;
    }
    grid.innerHTML = list.map(createProductCard).join('');
}

$('store-search-input')?.addEventListener('input', () => {
    if (location.hash.startsWith('#products')) {
        const urlParams = new URLSearchParams(location.hash.split('?')[1]);
        renderProducts(urlParams.get('category'));
    } else {
        location.hash = '#products';
    }
});

function createProductCard(p) {
    const img = p.images?.[0] || 'assets/placeholder.png'; // Make sure placeholder exists or use empty string
    const formattedPrice = (p.price || 0).toLocaleString();
    const formattedMRP = p.compareAtPrice ? p.compareAtPrice.toLocaleString() : '';
    const mrp = p.compareAtPrice > p.price ? `<span class="mrp">₹${formattedMRP}</span>` : '';

    let badge = '';
    if (p.stock <= 0) badge = '<div class="product-badge" style="color: #dc2626">Out of Stock</div>';
    else if (p.stock <= 5) badge = '<div class="product-badge" style="color: #d97706">Low Stock</div>';
    else if (p.compareAtPrice > p.price) {
        const percent = Math.round(((p.compareAtPrice - p.price) / p.compareAtPrice) * 100);
        badge = `<div class="product-badge" style="color: #059669">${percent} % OFF</div>`;
    }
    
    const disabled = p.stock <= 0 ? 'disabled' : '';

    const cartItem = cart.find(i => i.productId === p.id);
    let actionElement;
    if (cartItem && cartItem.quantity > 0) {
        actionElement = `
            <div class="qty-selector" style="margin:0; height: 40px; font-size: 0.875rem">
                <button class="qty-btn" style="width: 32px" onclick="window.storeApp.updateCartItemQty('${p.id}', -1)">-</button>
                <span class="qty-input" style="display:inline-block; width: 30px; line-height: 40px; text-align: center; color: var(--store-primary); font-weight: 700">${cartItem.quantity}</span>
                <button class="qty-btn" style="width: 32px" onclick="window.storeApp.updateCartItemQty('${p.id}', 1)">+</button>
            </div>
        `;
    } else {
        actionElement = `
            <button class="add-cart-icon-btn" onclick="window.storeApp.addToCart('${p.id}')" ${disabled} title="${disabled ? 'Out of stock' : 'Add to Cart'}">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
            </button>
        `;
    }

    const cardRating = (p.avgRating && p.avgRating > 0) ? `
        <div style="display:flex; align-items:center; gap:0.25rem; margin-top:0.25rem;">
            <span style="color:#f59e0b; font-size:0.8125rem; letter-spacing:1px">${'★'.repeat(Math.max(0, Math.min(5, Math.round(p.avgRating))))}${'☆'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, Math.round(p.avgRating)))))}</span>
            <span style="font-size:0.75rem; color:var(--store-text-muted)">(${p.reviewCount || 0})</span>
        </div>` : '';

    return `
    <div class="product-card">
        ${badge}
        <a href="#product/${p.id}" class="product-image-wrap">
            <img src="${img}" alt="${p.title}" loading="lazy">
        </a>
        <div class="product-info">
            <div class="product-cat">${p.category || 'General'}</div>
            <a href="#product/${p.id}" class="product-title">${p.title}</a>
            ${cardRating}
            <div class="product-pricing-row">
                <div class="product-pricing">
                    <span class="price">₹${formattedPrice}</span>
                    ${mrp}
                </div>
                ${actionElement}
            </div>
        </div>
    </div>`;
}

// --- PRODUCT DETAIL ---
function renderProductDetail(id) {
    const p = products.find(x => x.id === id);
    if (!p) { location.hash = '#products'; return; }

    const container = $('product-detail-container');
    if (!container) return;

    const images = p.images?.length > 0 ? p.images : ['assets/placeholder.png'];
    const mrp = p.compareAtPrice > p.price ? `<span class="mrp" style="font-size: 1.2rem">₹${p.compareAtPrice.toLocaleString()}</span>` : '';
    
    let stockStatus = '';
    if (p.stock > 5) stockStatus = '<span class="stock-status in-stock"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> In Stock</span>';
    else if (p.stock > 0) stockStatus = `<span class="stock-status low-stock"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Only ${p.stock} left in stock</span>`;
    else stockStatus = '<span class="stock-status out-stock"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Out of Stock</span>';

    // Rating display
    const avgRating = p.avgRating || 0;
    const reviewCount = p.reviewCount || 0;
    const safeRating = Math.max(0, Math.min(5, Math.round(avgRating)));
    const ratingStars = avgRating > 0 ? `
        <div style="display:flex; align-items:center; gap:0.5rem; margin-top:0.5rem;">
            <div style="color:#f59e0b; font-size:1.1rem; letter-spacing:1px">${'★'.repeat(safeRating)}${'☆'.repeat(5 - safeRating)}</div>
            <span style="font-size:0.875rem; color:var(--store-text-muted)">${avgRating} (${reviewCount} review${reviewCount !== 1 ? 's' : ''})</span>
        </div>` : '';

    container.innerHTML = `
        <div class="detail-gallery">
            <div class="main-image"><img src="${images[0]}" id="pd-main-img" alt="${p.title}"></div>
            ${images.length > 1 ? `
            <div class="thumb-list">
                ${images.map((img, i) => `<div class="thumb-item ${i===0?'active':''}" onclick="window.storeApp.setMainImage(this, '${img}')"><img src="${img}" alt="Thumbnail"></div>`).join('')}
            </div>` : ''}
        </div>
        <div class="detail-info">
            <div class="product-cat">${p.category || ''}</div>
            <h1>${p.title}</h1>
            ${stockStatus}
            ${ratingStars}
            <div class="detail-price-wrap">
                <span class="detail-price">₹${(p.price || 0).toLocaleString()}</span>
                ${p.compareAtPrice > p.price ? `<span class="mrp" style="font-size: 1.2rem">₹${p.compareAtPrice.toLocaleString()}</span>` : ''}
            </div>
            <div class="detail-desc">${p.description || 'No description available.'}</div>
            
            <div class="qty-selector">
                        <button class="qty-btn" onclick="window.storeApp.updateQtyInput(-1)">-</button>
                        <span id="pd-qty" class="qty-input" style="display:inline-block; width: 40px; line-height: 48px; text-align: center; color: var(--store-primary); font-weight: 700" data-value="1">1</span>
                        <button class="qty-btn" onclick="window.storeApp.updateQtyInput(1)">+</button>
            </div>
            
            <button class="s-btn s-btn-primary s-btn-full" style="padding: 1rem; font-size: 1.1rem" onclick="window.storeApp.addToCartFromDetail('${p.id}')" ${p.stock <= 0 ? 'disabled' : ''}>
                Add to Cart
            </button>
            <div style="margin-top: 2rem; border-top: 1px solid var(--store-border); padding-top: 1rem;">
                <p style="font-size: 0.875rem; color: var(--store-text-muted)"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align: middle; margin-right: 4px"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg> Secure checkout with UPI</p>
                <p style="font-size: 0.875rem; color: var(--store-text-muted)"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align: middle; margin-right: 4px"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12l-4 9H8l-4-9h4m0 0V3m0 4l-2 9m6-9v13m4-13l2 9"/></svg> Fast delivery across India</p>
            </div>
        </div>
    `;

    // Load and render reviews below the product detail
    loadProductReviews(id, p.title);
}

async function loadProductReviews(productId, productTitle) {
    const detailContainer = $('product-detail-container');
    if (!detailContainer) return;

    // Add review section below the detail layout
    let reviewSection = document.getElementById('product-reviews-section');
    if (!reviewSection) {
        reviewSection = document.createElement('div');
        reviewSection.id = 'product-reviews-section';
        reviewSection.style.cssText = 'grid-column: 1 / -1; margin-top: 2.5rem; border-top: 2px solid var(--store-border); padding-top: 2rem;';
        detailContainer.parentElement.appendChild(reviewSection);
    }

    // Load reviews - gracefully handle if collection doesn't exist yet
    let productReviews = [];
    try {
        const snap = await getDocs(query(
            collection(db, 'store_reviews'),
            where('productId', '==', productId)
        ));
        productReviews = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(r => r.status === 'approved')
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } catch(e) {
        console.warn('Reviews collection may not exist yet:', e.message);
        // Continue with empty reviews - don't block the page
    }

    // Check if current user has already reviewed (check ALL reviews, not just approved)
    let allUserReviews = [];
    try {
        const allSnap = await getDocs(query(
            collection(db, 'store_reviews'),
            where('productId', '==', productId)
        ));
        allUserReviews = allSnap.docs.map(d => d.data());
    } catch(e) { /* collection doesn't exist yet, that's fine */ }
    const alreadyReviewed = currentUser && allUserReviews.some(r => r.customerId === currentUser.uid);

    // Check if current user has purchased this product - ONLY BUYERS CAN REVIEW
    let hasPurchased = false;
    if (currentUser) {
        try {
            const orderSnap = await getDocs(query(collection(db, 'store_orders'), where('customer.uid', '==', currentUser.uid)));
            hasPurchased = orderSnap.docs.some(d => {
                const data = d.data();
                // Allow reviews if status is shipped, out_for_delivery, or delivered
                const eligibleStatus = ['shipped', 'out_for_delivery', 'delivered'];
                return eligibleStatus.includes(data.status) && data.items?.some(it => it.productId === productId);
            });
        } catch(e) { /* ignore */ }
    }

    // Build review form - ONLY for verified buyers
    let reviewForm = '';
    if (!currentUser) {
        reviewForm = `
            <div style="background: var(--store-bg); border: 1px solid var(--store-border); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; text-align: center;">
                <p style="color:var(--store-text-muted); margin-bottom:0.75rem">Sign in to leave a review</p>
                <button class="s-btn s-btn-outline" onclick="window.storeApp.loginWithGoogle()">Sign in with Google</button>
            </div>`;
    } else if (alreadyReviewed) {
        reviewForm = `
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 1rem 1.5rem; margin-bottom: 2rem; display:flex; align-items:center; gap:0.5rem;">
                <svg width="18" height="18" fill="none" stroke="#16a34a" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                <span style="color:#166534; font-size:0.9375rem; font-weight:500">You have already submitted a review for this product.</span>
            </div>`;
    } else if (hasPurchased) {
        reviewForm = `
            <div class="review-form-card" style="background: var(--store-bg); border: 1px solid var(--store-border); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem;">
                <h4 style="margin-bottom: 1rem; font-size: 1.05rem">Write a Review</h4>
                <div class="star-selector" id="star-selector" style="display:flex; gap:0.25rem; margin-bottom: 1rem; cursor: pointer;">
                    ${[1,2,3,4,5].map(i => `<span class="star-pick" data-value="${i}" style="font-size: 2rem; color: #d1d5db; transition: color 0.15s; cursor: pointer;">★</span>`).join('')}
                    <span id="star-label" style="margin-left: 0.75rem; font-size: 0.875rem; color: var(--store-text-muted); align-self: center;">Select rating</span>
                </div>
                <textarea id="review-text" placeholder="Share your experience with this product..." style="width:100%; min-height:100px; border:1px solid var(--store-border); border-radius: 8px; padding: 0.75rem; font-family:inherit; font-size:0.9375rem; resize:vertical; background: white; color: var(--store-text); margin-bottom: 1rem;"></textarea>
                <button class="s-btn s-btn-primary" id="submit-review-btn" onclick="window.storeApp.submitReview('${productId}', '${productTitle.replace(/'/g, "\\\\'")}')">Submit Review</button>
            </div>`;
    } else {
        reviewForm = `
            <div style="background: var(--store-bg); border: 1px solid var(--store-border); border-radius: 12px; padding: 1rem 1.5rem; margin-bottom: 2rem; display:flex; align-items:center; gap:0.5rem;">
                <svg width="18" height="18" fill="none" stroke="var(--store-text-muted)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span style="color:var(--store-text-muted); font-size:0.9375rem">Only customers who have purchased and received this product can write a review.</span>
            </div>`;
    }

    // Build reviews list
    let reviewsList = '';
    if (productReviews.length > 0) {
        reviewsList = productReviews.map(r => {
            const safeRating = Math.max(0, Math.min(5, Math.round(r.rating || 0)));
            const stars = '★'.repeat(safeRating) + '☆'.repeat(5 - safeRating);
            const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '';
            return `
            <div style="border-bottom: 1px solid var(--store-border); padding: 1.25rem 0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.5rem;">
                    <div>
                        <span style="color:#f59e0b; font-size:1rem; letter-spacing:1px">${stars}</span>
                        <span style="background:#dcfce7; color:#166534; padding:0.125rem 0.5rem; border-radius:100px; font-size:0.75rem; font-weight:600; margin-left:0.5rem">✓ Verified Purchase</span>
                    </div>
                    <span style="font-size:0.8125rem; color:var(--store-text-muted)">${date}</span>
                </div>
                <p style="margin-bottom:0.375rem; line-height:1.6">${r.reviewText || ''}</p>
                <span style="font-size:0.8125rem; font-weight:600; color:var(--store-text-muted)">${maskName(r.customerName)}</span>
            </div>`;
        }).join('');
    } else {
        reviewsList = '<p style="color:var(--store-text-muted); padding: 1rem 0;">No reviews yet. Be the first to review this product!</p>';
    }

    reviewSection.innerHTML = `
        <h3 style="font-size: 1.25rem; margin-bottom: 1.5rem; display:flex; align-items:center; gap:0.5rem;">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
            Customer Reviews (${productReviews.length})
        </h3>
        ${reviewForm}
        ${reviewsList}
    `;

    // Initialize star selector interactivity
    initStarSelector();
}

let selectedRating = 0;
function initStarSelector() {
    const stars = document.querySelectorAll('.star-pick');
    const label = $('star-label');
    const labels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
    stars.forEach(star => {
        star.addEventListener('mouseenter', () => {
            const val = parseInt(star.dataset.value);
            stars.forEach(s => s.style.color = parseInt(s.dataset.value) <= val ? '#f59e0b' : '#d1d5db');
        });
        star.addEventListener('click', () => {
            selectedRating = parseInt(star.dataset.value);
            stars.forEach(s => s.style.color = parseInt(s.dataset.value) <= selectedRating ? '#f59e0b' : '#d1d5db');
            if (label) label.textContent = labels[selectedRating] || '';
        });
    });
    const selector = $('star-selector');
    if (selector) {
        selector.addEventListener('mouseleave', () => {
            stars.forEach(s => s.style.color = parseInt(s.dataset.value) <= selectedRating ? '#f59e0b' : '#d1d5db');
        });
    }
}

async function submitReview(productId, productTitle) {
    if (!currentUser) { toast('Please sign in first.', 'error'); return; }
    if (selectedRating === 0) { toast('Please select a star rating.', 'error'); return; }

    const reviewText = $('review-text')?.value?.trim() || '';
    const btn = $('submit-review-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

    try {
        // Check if user purchased this product
        let verified = false;
        try {
            const orderSnap = await getDocs(query(collection(db, 'store_orders'), where('customer.uid', '==', currentUser.uid)));
            verified = orderSnap.docs.some(d => d.data().items?.some(it => it.productId === productId));
        } catch(e) { /* ignore */ }

        await addDoc(collection(db, 'store_reviews'), {
            productId,
            productTitle,
            customerId: currentUser.uid,
            customerName: currentProfile?.name || currentUser.displayName || 'Customer',
            customerEmail: currentUser.email,
            rating: selectedRating,
            reviewText,
            verified,
            status: 'pending',
            createdAt: serverTimestamp()
        });

        selectedRating = 0;
        toast('Thank you! Your review has been submitted for approval.', 'success');
        loadProductReviews(productId, productTitle);
    } catch(e) {
        console.error(e);
        toast('Error submitting review: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Submit Review'; }
    }
}

window.storeApp = {
    setMainImage: (el, src) => {
        $('pd-main-img').src = src;
        document.querySelectorAll('.thumb-item').forEach(t => t.classList.remove('active'));
        el.classList.add('active');
    },
    updateQtyInput: (change) => {
        const input = $('pd-qty');
        if (!input) return;
        let val = (parseInt(input.dataset.value) || 1) + change;
        if (val < 1) val = 1;
        input.dataset.value = val;
        input.textContent = val;
    },
    addToCart: (id) => addToCart(id, 1),
    addToCartFromDetail: (id) => addToCart(id, parseInt($('pd-qty').dataset.value) || 1),
    updateCartItemQty: (id, change) => {
        const item = cart.find(i => i.productId === id);
        if (item) {
            item.quantity += change;
            if (item.quantity <= 0) cart = cart.filter(i => i.productId !== id);
            else {
                const p = products.find(x => x.id === id);
                if (p && item.quantity > p.stock) item.quantity = p.stock;
            }
            saveCart(); renderCartDrawer();
        }
    },
    removeFromCart: (id) => {
        cart = cart.filter(i => i.productId !== id);
        saveCart(); renderCartDrawer();
    },
    openCartDrawer: openCartDrawer,
    closeCartDrawer: closeCartDrawer,
    loginWithGoogle: async () => {
        await loginWithGoogle();
    },
    logout: async () => {
        await signOut(auth);
        location.hash = '#home';
    },
    applyCoupon: () => applyCoupon(),
    submitReview
};

async function applyCoupon() {
    console.log('Applying coupon...');
    const input = $('coupon-input');
    const msg = $('coupon-message');
    const code = input.value.toUpperCase().trim();
    if (!code) return;

    try {
        const q = query(collection(db, 'store_coupons'), where('code', '==', code));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            msg.textContent = 'Invalid coupon code.';
            msg.style.color = '#dc2626';
            appliedCoupon = null;
        } else {
            const coupon = { id: snap.docs[0].id, ...snap.docs[0].data() };
            const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

            if (coupon.status !== 'active') {
                msg.textContent = 'This coupon is currently inactive.';
                msg.style.color = '#dc2626';
                appliedCoupon = null;
            } else if (coupon.expiry && (coupon.expiry.toDate ? coupon.expiry.toDate() : new Date(coupon.expiry)) < new Date()) {
                msg.textContent = 'This coupon has expired.';
                msg.style.color = '#dc2626';
                appliedCoupon = null;
            } else if (subtotal < coupon.minOrder) {
                msg.textContent = `Minimum order of ₹${coupon.minOrder.toLocaleString()} required.`;
                msg.style.color = '#dc2626';
                appliedCoupon = null;
            } else {
                // Check per-user limit
                if (coupon.limitPerUser > 0 && currentUser) {
                    const ordersSnap = await getDocs(query(collection(db, 'store_orders'), 
                        where('customer.uid', '==', currentUser.uid),
                        where('couponCode', '==', code)
                    ));
                    if (ordersSnap.size >= coupon.limitPerUser) {
                        msg.textContent = `You have already used this coupon ${coupon.limitPerUser} time(s).`;
                        msg.style.color = '#dc2626';
                        appliedCoupon = null;
                        return;
                    }
                }

                appliedCoupon = coupon;
                const discountText = coupon.type === 'percentage' ? `${coupon.value}%` : `₹${coupon.value}`;
                msg.textContent = `${discountText} discount applied successfully!`;
                msg.style.color = '#059669';
            }
        }
        renderCheckout();
    } catch (e) {
        console.error(e);
        msg.textContent = 'Error verifying coupon.';
        toast('Failed to apply coupon: ' + e.message, 'error');
    }
}

// --- CART ---
function addToCart(productId, quantity) {
    const p = products.find(x => x.id === productId);
    if (!p || p.stock < 1) return;

    const existing = cart.find(i => i.productId === productId);
    if (existing) {
        existing.quantity += quantity;
        if (existing.quantity > p.stock) existing.quantity = p.stock;
    } else {
        cart.push({
            productId,
            title: p.title,
            price: p.price,
            image: p.images?.[0] || '',
            quantity: Math.min(quantity, p.stock)
        });
    }
    saveCart();
    toast('Added to cart', 'success');
}

function saveCart() {
    localStorage.setItem('ies_cart', JSON.stringify(cart));
    updateCartBadges();
    
    // Re-render product grids to update qty selectors if visible
    if (location.hash === '' || location.hash === '#home') renderHome();
    if (location.hash.startsWith('#products')) {
        const urlParams = new URLSearchParams(location.hash.split('?')[1]);
        renderProducts(urlParams.get('category'));
    }
}

function updateCartBadges() {
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    document.querySelectorAll('.cart-badge').forEach(el => {
        el.textContent = count;
        el.style.display = count > 0 ? 'flex' : 'none';
    });
    
    // Update cart bar (Floating Bottom Bar)
    const mBar = $('mobile-cart-bar');
    if (mBar) {
        if (count > 0 && !location.hash.startsWith('#checkout')) {
            mBar.classList.add('active');
            $('mc-price').textContent = `₹${total.toLocaleString()}`;
            $('mc-items').textContent = `${count} item${count > 1 ? 's' : ''}`;
        } else {
            mBar.classList.remove('active');
        }
    }
}

// --- SLIDE-OUT CART DRAWER ---
function openCartDrawer() {
    $('cart-overlay').classList.add('active');
    $('cart-drawer').classList.add('active');
    renderCartDrawer();
}
function closeCartDrawer() {
    $('cart-overlay').classList.remove('active');
    $('cart-drawer').classList.remove('active');
}
// Attach events
setTimeout(() => {
    $('nav-cart-btn')?.addEventListener('click', openCartDrawer);
    $('cart-close-btn')?.addEventListener('click', closeCartDrawer);
    $('cart-overlay')?.addEventListener('click', closeCartDrawer);
}, 500);

function renderCartDrawer() {
    const container = $('cart-drawer-items');
    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 2rem 1rem">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                <h3 style="margin-top: 1rem">Your cart is empty</h3>
                <button class="s-btn s-btn-primary s-btn-full" style="margin-top: 1rem" onclick="window.storeApp.closeCartDrawer()">Continue Shopping</button>
            </div>`;
        $('cart-drawer-checkout').style.display = 'none';
        $('cart-drawer-total').textContent = '₹0';
        return;
    }

    $('cart-drawer-checkout').style.display = 'flex';
    
    // Ensure latest prices
    let cartModified = false;
    cart.forEach(item => {
        const p = products.find(x => x.id === item.productId);
        if (p) {
            if (item.price !== p.price) { item.price = p.price; cartModified = true; }
            if (item.quantity > p.stock) { item.quantity = p.stock; cartModified = true; }
        }
    });
    if (cartModified) saveCart();

    container.innerHTML = cart.map(item => `
        <div class="c-item">
            <img src="${item.image || 'assets/placeholder.png'}" class="c-item-img" alt="${item.title}">
            <div class="c-item-info">
                <a href="#product/${item.productId}" class="c-item-title" onclick="window.storeApp.closeCartDrawer()">${item.title}</a>
                <div class="c-item-price">₹${item.price.toLocaleString()}</div>
                <div class="c-item-actions">
                    <div class="qty-selector" style="margin:0; height: 32px">
                        <button class="qty-btn" style="width: 32px" onclick="window.storeApp.updateCartItemQty('${item.productId}', -1)">-</button>
                        <span class="qty-input" style="display:inline-block; width: 30px; line-height: 32px; text-align: center; color: var(--store-primary); font-weight: 700">${item.quantity}</span>
                        <button class="qty-btn" style="width: 32px" onclick="window.storeApp.updateCartItemQty('${item.productId}', 1)">+</button>
                    </div>
                    <button class="remove-btn" onclick="window.storeApp.removeFromCart('${item.productId}')">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    $('cart-drawer-total').textContent = `₹${subtotal.toLocaleString()}`;
    
    // Add free shipping tip
    const tipContainerId = 'cart-drawer-tip';
    let tipEl = $(tipContainerId);
    if (!tipEl) {
        tipEl = document.createElement('div');
        tipEl.id = tipContainerId;
        tipEl.style.padding = '0.75rem';
        tipEl.style.marginBottom = '1rem';
        tipEl.style.borderRadius = '6px';
        tipEl.style.fontSize = '0.8125rem';
        container.prepend(tipEl);
    }
    updateFreeShippingTip(subtotal, tipContainerId);
}

// --- CHECKOUT ---
function renderCheckout() {
    if (cart.length === 0) { location.hash = '#cart'; return; }
    updateAuthUI();
    
    // Render order summary
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    updateFreeShippingTip(subtotal, 'free-shipping-tip');
    
    const isFreeShipping = (storeConfig.freeShippingThreshold > 0 && subtotal >= storeConfig.freeShippingThreshold);
    const shipping = isFreeShipping ? 0 : (storeConfig.shippingRates?.[0]?.price || 0);
    
    let discount = 0;
    if (appliedCoupon) {
        if (appliedCoupon.type === 'percentage') {
            discount = subtotal * (appliedCoupon.value / 100);
        } else {
            discount = appliedCoupon.value;
        }
        discount = Math.min(discount, subtotal);
    }

    // Exclusive GST Calculation
    let totalGst = 0;
    let mainGstRate = 18;
    cart.forEach(item => {
        const p = products.find(x => x.id === item.productId);
        const rate = p?.gstRate || 18;
        mainGstRate = rate;
        const itemTotal = item.price * item.quantity;
        // If discount exists, we apply it to the taxable amount proportionally
        const ratio = discount > 0 ? (1 - (discount / subtotal)) : 1;
        totalGst += (itemTotal * ratio) * (rate / 100);
    });

    const total = subtotal + shipping + totalGst - discount;

    $('checkout-subtotal').textContent = `₹${subtotal.toLocaleString()}`;
    $('checkout-shipping').textContent = isFreeShipping ? 'Free' : `₹${shipping.toLocaleString()}`;
    
    if (discount > 0) {
        $('checkout-discount-row').style.display = 'flex';
        $('applied-coupon-code').textContent = appliedCoupon.code;
        $('checkout-discount').textContent = `- ₹${discount.toLocaleString()}`;
    } else {
        $('checkout-discount-row').style.display = 'none';
    }

    $('checkout-gst-label').textContent = `${mainGstRate}% GST`;
    $('checkout-gst').textContent = `₹${Math.round(totalGst).toLocaleString()}`;
    $('gst-bracket-text').textContent = `(inclusive of ${mainGstRate}% GST)`;
    $('checkout-total').textContent = `₹${Math.round(total).toLocaleString()}`;
    $('checkout-items-list').innerHTML = cart.map(i => `<div style="display:flex; justify-content:space-between; margin-bottom:0.5rem; font-size:0.875rem"><span style="color:var(--store-text-muted)">${i.quantity}x ${i.title.slice(0,30)}...</span><span>₹${(i.price*i.quantity).toLocaleString()}</span></div>`).join('');
    
    // Setup Payment info
    const btnPlaceOrder = $('btn-place-order');
    if (storeConfig.razorpayKeyId) {
        if(btnPlaceOrder) {
            btnPlaceOrder.disabled = false;
            btnPlaceOrder.querySelector('span').textContent = 'Place Order';
        }
    } else {
        if(btnPlaceOrder) {
            btnPlaceOrder.disabled = true;
            btnPlaceOrder.querySelector('span').textContent = 'Online Payment Disabled';
        }
    }

    // Toggle Billing Address
    const billingToggle = $('billing-same-as-shipping');
    const billingFields = $('billing-address-fields');
    if (billingToggle && billingFields) {
        billingToggle.addEventListener('change', () => {
            const isSame = billingToggle.checked;
            billingFields.style.display = isSame ? 'none' : 'block';
            
            // Toggle required attributes
            ['line1', 'city', 'state', 'pincode'].forEach(field => {
                $(`billing-${field}`).required = !isSame;
            });
        });
    }
}

function prefillCheckout() {
    if (!currentProfile || !currentUser) return;
    
    const emailBanner = $('checkout-current-email');
    if (emailBanner) emailBanner.textContent = currentUser.email;

    if ($('checkout-name').value === '') $('checkout-name').value = currentProfile.name || currentUser.displayName || '';
    // Always prioritize currentUser.email for the checkout field to avoid admin@ hardcoding issues
    if ($('checkout-email').value === '' || $('checkout-email').value === 'admin@iesgroups.com') {
        $('checkout-email').value = currentUser.email || currentProfile.email || '';
    }
    if ($('checkout-phone').value === '') $('checkout-phone').value = currentProfile.phone || '';
    
    // Fill Shipping
    if (currentProfile.shippingAddress && $('checkout-line1').value === '') {
        const addr = currentProfile.shippingAddress;
        $('checkout-line1').value = addr.line1 || '';
        $('checkout-landmark').value = addr.landmark || '';
        $('checkout-city').value = addr.city || '';
        $('checkout-state').value = addr.state || '';
        $('checkout-pincode').value = addr.pincode || '';
    } else if (currentProfile.addresses?.length > 0 && $('checkout-line1').value === '') {
        // Fallback for legacy data
        const addr = currentProfile.addresses[0];
        $('checkout-line1').value = addr.line1 || '';
        $('checkout-city').value = addr.city || '';
        $('checkout-state').value = addr.state || '';
        $('checkout-pincode').value = addr.pincode || '';
    }

    // Fill Billing
    if (currentProfile.billingAddress && $('billing-line1').value === '') {
        const baddr = currentProfile.billingAddress;
        $('billing-line1').value = baddr.line1 || '';
        $('billing-landmark').value = baddr.landmark || '';
        $('billing-city').value = baddr.city || '';
        $('billing-state').value = baddr.state || '';
        $('billing-pincode').value = baddr.pincode || '';
        
        // If billing is different, uncheck the toggle
        const shipping = currentProfile.shippingAddress || (currentProfile.addresses?.[0]);
        const isSame = shipping && 
                      shipping.line1 === baddr.line1 && 
                      shipping.city === baddr.city && 
                      shipping.pincode === baddr.pincode;
        
        const toggle = $('billing-same-as-shipping');
        if (toggle) {
            toggle.checked = isSame;
            toggle.dispatchEvent(new Event('change'));
        }
    }
}

$('btn-place-order')?.addEventListener('click', e => {
    e.preventDefault();
    const form = $('checkout-form');
    if (form && form.reportValidity()) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
});

$('checkout-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentUser) { toast('Please log in first', 'error'); return; }
    if (cart.length === 0) return;

    const btn = $('btn-place-order');
    btn.disabled = true;
    btn.innerHTML = 'Processing...';

    try {
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const shippingCost = (storeConfig.freeShippingThreshold > 0 && subtotal >= storeConfig.freeShippingThreshold) ? 0 : (storeConfig.shippingRates?.[0]?.price || 0);
        
        let discount = 0;
        if (appliedCoupon) {
            if (appliedCoupon.type === 'percentage') discount = subtotal * (appliedCoupon.value / 100);
            else discount = appliedCoupon.value;
            discount = Math.min(discount, subtotal);
        }
        
        // Check stock availability
        for (const item of cart) {
            const p = products.find(x => x.id === item.productId);
            if (!p || p.stock < item.quantity) {
                throw new Error(`Item ${item.title} is out of stock or insufficient quantity.`);
            }
        }

        let totalGst = 0;
        cart.forEach(item => {
            const p = products.find(x => x.id === item.productId);
            const rate = p?.gstRate || 18;
            const itemTotal = item.price * item.quantity;
            const ratio = discount > 0 ? (1 - (discount / subtotal)) : 1;
            totalGst += (itemTotal * ratio) * (rate / 100);
        });

        const shippingAddress = {
            line1: $('checkout-line1').value,
            landmark: $('checkout-landmark')?.value || '',
            city: $('checkout-city').value,
            state: $('checkout-state').value,
            pincode: $('checkout-pincode').value
        };

        let billingAddress = shippingAddress;
        if (!$('billing-same-as-shipping').checked) {
            billingAddress = {
                line1: $('billing-line1').value,
                landmark: $('billing-landmark')?.value || '',
                city: $('billing-city').value,
                state: $('billing-state').value,
                pincode: $('billing-pincode').value
            };
        }

        const finalTotal = subtotal + shippingCost + totalGst - discount;

        // Get sequential order number via transaction with timeout fallback
        const counterRef = doc(db, 'store_config', 'counters');
        let nextNum;
        try {
            nextNum = await Promise.race([
                runTransaction(db, async (transaction) => {
                    const counterDoc = await transaction.get(counterRef);
                    let next = 1;
                    if (!counterDoc.exists()) {
                        transaction.set(counterRef, { lastOrder: 1 });
                    } else {
                        next = (counterDoc.data().lastOrder || 0) + 1;
                        transaction.update(counterRef, { lastOrder: next });
                    }
                    return next;
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 3000))
            ]);
        } catch (e) {
            console.warn("Could not get sequential order number, falling back to random:", e);
            nextNum = Math.floor(Math.random() * 9000) + 1000;
        }

        // Calculate Indian Financial Year (April to March)
        const now = new Date();
        const currentMonth = now.getMonth(); // 0-indexed, 3 is April
        const year1 = currentMonth >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const year2 = year1 + 1;
        const fyCode = (year1 % 100).toString() + (year2 % 100).toString();

        const orderData = {
            orderNumber: `IESSTORE-${fyCode}-${String(nextNum).padStart(4, '0')}`,
            customer: {
                uid: currentUser.uid,
                name: $('checkout-name').value,
                email: $('checkout-email').value,
                phone: $('checkout-phone').value,
                shippingAddress,
                billingAddress,
                address: shippingAddress // Maintain legacy support
            },
            items: cart,
            subtotal,
            shippingCost,
            totalGst,
            discountAmount: discount,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            total: finalTotal,
            status: 'pending',
            paymentStatus: 'pending',
            paymentMethod: 'razorpay',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        // --- RAZORPAY INTEGRATION ---
        if (!storeConfig.razorpayKeyId) {
            throw new Error("Online payment is not configured. Please contact the administrator.");
        }

        btn.innerHTML = 'Waiting for Payment...';
            const options = {
                "key": storeConfig.razorpayKeyId,
                "amount": Math.round(orderData.total * 100), // amount in paise
                "currency": "INR",
                "name": storeConfig.storeName || "IES Store",
                "description": "Order " + orderData.orderNumber,
                "image": "assets/logo.png",
                "handler": async function (response) {
                    orderData.paymentMethod = 'razorpay';
                    orderData.paymentStatus = 'paid';
                    orderData.status = 'confirmed';
                    orderData.razorpayPaymentId = response.razorpay_payment_id;
                    
                    await completeOrder(orderData, btn);
                },
                "prefill": {
                    "name": orderData.customer.name,
                    "email": orderData.customer.email,
                    "contact": orderData.customer.phone
                },
                "theme": { "color": "#7048e8" },
                "modal": {
                    "ondismiss": function() {
                        btn.disabled = false;
                        btn.innerHTML = 'Place Order';
                        toast('Payment cancelled', 'info');
                    }
                }
            };
            const rzp = new Razorpay(options);
            rzp.open();
            return; // Wait for handler
        
        await completeOrder(orderData, btn);

    } catch (e) {
        toast('Error placing order: ' + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = 'Place Order';
    }
});

async function completeOrder(orderData, btn) {
    try {
        const orderRef = await addDoc(collection(db, 'store_orders'), orderData);

        // Update product stock
        for (const item of cart) {
            const p = products.find(x => x.id === item.productId);
            if (p) {
                try {
                    await updateDoc(doc(db, 'store_products', p.id), {
                        stock: p.stock - item.quantity
                    });
                } catch (stockErr) {
                    console.warn('Could not update stock:', stockErr);
                }
            }
        }

        // Save address to profile
        if (currentProfile) {
            const customerData = {
                name: orderData.customer.name,
                email: orderData.customer.email,
                phone: orderData.customer.phone,
                shippingAddress: orderData.customer.shippingAddress,
                billingAddress: orderData.customer.billingAddress,
                updatedAt: serverTimestamp()
            };
            
            // For legacy support, also update the 'addresses' array if empty
            if (!currentProfile.addresses || currentProfile.addresses.length === 0) {
                customerData.addresses = [orderData.customer.shippingAddress];
            }

            await setDoc(doc(db, 'store_customers', currentUser.uid), customerData, { merge: true });
            currentProfile = { ...currentProfile, ...customerData };
        }

        // Increment coupon usage count
        if (appliedCoupon) {
            try {
                const couponRef = doc(db, 'store_coupons', appliedCoupon.id);
                await updateDoc(couponRef, {
                    usageCount: (appliedCoupon.usageCount || 0) + 1
                });
            } catch (couponErr) {
                console.warn('Could not update coupon usage count:', couponErr);
            }
        }

        // Clear cart
        cart = [];
        appliedCoupon = null;
        saveCart();
        updateCartBadges();

        btn.innerHTML = 'Order Placed!';
        toast('Order placed successfully!', 'success');
        
        setTimeout(() => {
            location.hash = '#home';
            btn.disabled = false;
            btn.innerHTML = 'Place Order';
        }, 2000);

    } catch (e) {
        console.error(e);
        btn.disabled = false;
        btn.innerHTML = 'Place Order';
        toast('Error creating order: ' + e.message, 'error');
    }
}

function renderOrderSuccess(id) {
    // Basic success view
    // In a real app we would fetch the order to show the order number
}

// --- HELPERS ---
const INDIAN_STATES = [
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", 
    "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", 
    "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", 
    "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", 
    "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", 
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
];

// --- ACCOUNT VIEW ---
function renderAccount() {
    if (!currentUser) { location.hash = '#home'; return; }
    const container = $('account-container');
    if (!container) return;

    const s = currentProfile?.shippingAddress || {};
    const b = currentProfile?.billingAddress || {};

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 2rem; border-bottom: 1px solid var(--store-border); padding-bottom: 1rem">
            <div>
                <h1 style="margin:0">My Account</h1>
                <p style="color:var(--store-text-muted); margin:0">${currentUser.email}</p>
            </div>
            <button class="s-btn s-btn-outline" onclick="window.storeApp.logout()">Sign Out</button>
        </div>

        <div class="cart-layout">
            <div class="account-main">
                <div class="checkout-section">
                    <div id="pending-reviews-dashboard"></div>
                    <h3 style="margin-top:0">Order History</h3>
                    <div id="account-orders-list">Loading orders...</div>
                </div>
            </div>
            
            <div class="account-sidebar">
                <div class="checkout-section">
                    <h3 style="margin-top:0">My Profile</h3>
                    <form id="profile-form">
                        <div class="form-group"><label class="form-label">Full Name</label><input type="text" id="prof-name" class="store-input" value="${currentProfile?.name||''}"></div>
                        <div class="form-group"><label class="form-label">Phone</label><input type="tel" id="prof-phone" class="store-input" value="${currentProfile?.phone||''}"></div>
                        
                        <div style="margin-top: 1.5rem">
                            <h4 style="margin-bottom: 1rem; font-size: 0.9rem; color: var(--store-text-muted); text-transform: uppercase; letter-spacing: 0.05em">Default Shipping Address</h4>
                            <div class="form-group"><label class="form-label">Street Address</label><input type="text" id="prof-ship-line1" class="store-input" value="${s.line1||''}"></div>
                            <div class="form-group"><label class="form-label">Landmark</label><input type="text" id="prof-ship-landmark" class="store-input" value="${s.landmark||''}"></div>
                            <div class="form-grid">
                                <div class="form-group"><label class="form-label">City</label><input type="text" id="prof-ship-city" class="store-input" value="${s.city||''}" autocomplete="address-level2"></div>
                                <div class="form-group">
                                    <label class="form-label">State</label>
                                    <input type="text" id="prof-ship-state" class="store-input" value="${s.state||''}" autocomplete="address-level1" placeholder="State">
                                </div>
                            </div>
                            <div class="form-group"><label class="form-label">Pincode</label><input type="text" id="prof-ship-pincode" class="store-input" value="${s.pincode||''}"></div>
                        </div>

                        <div style="margin-top: 1.5rem">
                            <h4 style="margin-bottom: 1rem; font-size: 0.9rem; color: var(--store-text-muted); text-transform: uppercase; letter-spacing: 0.05em">Default Billing Address</h4>
                            <div class="form-group"><label class="form-label">Street Address</label><input type="text" id="prof-bill-line1" class="store-input" value="${b.line1||''}"></div>
                            <div class="form-group"><label class="form-label">Landmark</label><input type="text" id="prof-bill-landmark" class="store-input" value="${b.landmark||''}"></div>
                            <div class="form-grid">
                                <div class="form-group"><label class="form-label">City</label><input type="text" id="prof-bill-city" class="store-input" value="${b.city||''}" autocomplete="address-level2"></div>
                                <div class="form-group">
                                    <label class="form-label">State</label>
                                    <input type="text" id="prof-bill-state" class="store-input" value="${b.state||''}" autocomplete="address-level1" placeholder="State">
                                </div>
                            </div>
                            <div class="form-group"><label class="form-label">Pincode</label><input type="text" id="prof-bill-pincode" class="store-input" value="${b.pincode||''}"></div>
                        </div>

                        <button type="submit" class="s-btn s-btn-primary s-btn-full" style="margin-top: 1.5rem">Save Profile Changes</button>
                    </form>
                </div>
            </div>
        </div>
    `;

    $('profile-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        
        try {
            const data = {
                name: $('prof-name').value,
                phone: $('prof-phone').value,
                shippingAddress: {
                    line1: $('prof-ship-line1').value,
                    landmark: $('prof-ship-landmark').value,
                    city: $('prof-ship-city').value,
                    state: $('prof-ship-state').value,
                    pincode: $('prof-ship-pincode').value
                },
                billingAddress: {
                    line1: $('prof-bill-line1').value,
                    landmark: $('prof-bill-landmark').value,
                    city: $('prof-bill-city').value,
                    state: $('prof-bill-state').value,
                    pincode: $('prof-bill-pincode').value
                },
                updatedAt: serverTimestamp()
            };
            
            await updateDoc(doc(db, 'store_customers', currentUser.uid), data);
            currentProfile = { ...currentProfile, ...data };
            toast('Profile updated successfully!', 'success');
        } catch(err) {
            toast('Error updating profile: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save Profile Changes';
        }
    });

    loadAccountOrders();
    initNotificationListener();
}

function initNotificationListener() {
    if (!currentUser) return;
    
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    const q = query(collection(db, 'store_orders'), where('customer.uid', '==', currentUser.uid));
    
    // Track previous statuses to avoid duplicate notifications
    const orderStatuses = JSON.parse(localStorage.getItem('orderStatuses') || '{}');

    onSnapshot(q, (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === "modified") {
                const order = { id: change.doc.id, ...change.doc.data() };
                const prevStatus = orderStatuses[order.id];
                const newStatus = order.status;

                // Notify if changed to out_for_delivery
                if (newStatus === 'out_for_delivery' && prevStatus !== 'out_for_delivery') {
                    showStatusNotification(order);
                }

                orderStatuses[order.id] = newStatus;
                localStorage.setItem('orderStatuses', JSON.stringify(orderStatuses));
                
                // Refresh list if account is open
                if ($('view-account') && !$('view-account').classList.contains('hidden')) {
                    loadAccountOrders();
                }
            } else if (change.type === "added") {
                const order = { id: change.doc.id, ...change.doc.data() };
                orderStatuses[order.id] = order.status;
                localStorage.setItem('orderStatuses', JSON.stringify(orderStatuses));
            }
        });
    });
}

function showStatusNotification(order) {
    const title = "📦 Out for Delivery!";
    const body = `Order ${order.orderNumber || order.id.slice(0,8)} is out for delivery. Get ready!`;
    
    // System Notification
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body, icon: '/favicon.ico' });
    }
    
    // In-app Toast
    toast(body, 'info');
}



window.printOrderInvoice = function(orderId) {
    const o = customerOrders.find(x => x.id === orderId);
    if (!o) {
        console.error('Order not found:', orderId);
        return;
    }
    try {
        // Meta
        $('inv-number').textContent = o.orderNumber || o.id.slice(0, 8).toUpperCase();
        $('inv-date').textContent = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
        $('inv-supply-place').textContent = o.shippingAddress?.state || o.customer?.address?.state || 'Tamil Nadu';
        $('inv-payment').textContent = (o.paymentStatus || 'pending').toUpperCase();

        // Addresses
        const s = o.shippingAddress || o.customer?.address || {};
        const b = o.billingAddress || s;

        $('inv-to-name').textContent = b.name || o.customer?.name || 'Customer';
        $('inv-to-address').innerHTML = `${b.line1 || ''}${b.landmark ? ', ' + b.landmark : ''}<br>${b.city || ''}, ${b.state || ''} - ${b.pincode || ''}`;
        $('inv-to-phone').textContent = 'Phone: ' + (b.phone || o.customer?.phone || 'N/A');

        $('inv-ship-name').textContent = s.name || o.customer?.name || 'Customer';
        $('inv-ship-address').innerHTML = `${s.line1 || ''}${s.landmark ? ', ' + s.landmark : ''}<br>${s.city || ''}, ${s.state || ''} - ${s.pincode || ''}`;

        // Items
        const itemsTbody = $('inv-items');
        itemsTbody.innerHTML = (o.items || []).map((it, idx) => `
            <tr>
                <td class="text-center">${idx + 1}</td>
                <td><strong>${it.title}</strong></td>
                <td class="text-center">${it.quantity}</td>
                <td class="text-right">₹${(it.price || 0).toLocaleString('en-IN')}</td>
                <td class="text-right">₹${((it.price || 0) * it.quantity).toLocaleString('en-IN')}</td>
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
    } catch (err) {
        console.error('Print Error:', err);
        toast('Error generating invoice. Please try again.', 'error');
    }
}

async function loadAccountOrders() {
    try {
        // Fetch user reviews first to know what is already reviewed
        const reviewSnap = await getDocs(query(collection(db, 'store_reviews'), where('customerId', '==', currentUser.uid)));
        userReviews = reviewSnap.docs.map(d => d.data());

        const q = query(collection(db, 'store_orders'), where('customer.uid', '==', currentUser.uid));
        const snap = await getDocs(q);
        const list = $('account-orders-list');
        if (snap.empty) {
            list.innerHTML = '<p style="color:var(--store-text-muted)">No orders found.</p>';
            return;
        }
        
        customerOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(o => o.status !== 'deleted');
        customerOrders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        
        list.innerHTML = customerOrders.map(o => {
            const isEligible = ['shipped', 'out_for_delivery', 'delivered'].includes(o.status);
            const itemsHtml = (o.items || []).map(it => {
                const alreadyReviewed = userReviews.some(r => r.productId === it.productId);
                return `
                <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:0.75rem; padding-bottom:0.75rem; border-bottom:1px solid #f8fafc">
                    <img src="${it.image || 'assets/store/img/placeholder.png'}" style="width:40px; height:40px; border-radius:4px; object-fit:cover">
                    <div style="flex:1">
                        <div style="font-size:0.875rem; font-weight:500">${it.title}</div>
                        <div style="font-size:0.75rem; color:var(--store-text-muted)">Qty: ${it.quantity} • ₹${(it.price||0).toLocaleString('en-IN')}</div>
                    </div>
                    ${isEligible && !alreadyReviewed ? `
                        <a href="#product/${it.productId}" class="s-btn" style="padding:0.375rem 0.75rem; font-size:0.75rem; background:#f0fdf4; color:#166534; border:1px solid #bbf7d0">Rate & Review</a>
                    ` : alreadyReviewed ? `
                        <span style="font-size:0.75rem; color:#16a34a; font-weight:600">✓ Reviewed</span>
                    ` : ''}
                </div>`;
            }).join('');

            return `
            <div style="border:1px solid var(--store-border); border-radius:12px; padding:1.25rem; margin-bottom:1rem; background:white; box-shadow: 0 1px 3px rgba(0,0,0,0.05)">
                <div style="display:flex; justify-content:space-between; margin-bottom:0.75rem; align-items:center">
                    <strong style="font-size:1.1rem">Order ${o.orderNumber || o.id.slice(0,8)}</strong>
                    <span style="font-weight:700; color:var(--store-primary); font-size:1.1rem">₹${(o.total||0).toLocaleString('en-IN')}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:0.875rem; color:var(--store-text-muted); margin-bottom:1rem">
                    <span>${o.createdAt?.toDate?.().toLocaleDateString('en-IN') || ''} • ${o.items?.length||0} items</span>
                    <span class="badge" style="background:var(--store-bg); color:var(--store-primary); padding:0.25rem 0.75rem; border-radius:20px; font-weight:600; text-transform:capitalize">
                        ${(o.status||'pending').replace(/_/g,' ')}
                    </span>
                </div>
                ${o.estimatedDelivery ? `
                <div style="margin-bottom:1rem; padding: 0.75rem; background: #f0f9ff; border-radius: 8px; border: 1px solid #e0f2fe; display: flex; align-items: center; gap: 0.5rem;">
                    <svg width="16" height="16" fill="none" stroke="#0369a1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2v12a2 2 0 002 2z"/></svg>
                    <span style="font-size: 0.8125rem; color: #0369a1; font-weight: 600;">Est. Delivery: ${new Date(o.estimatedDelivery).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>` : ''}
                
                <div style="margin-bottom:1rem">${itemsHtml}</div>

                <div style="display:flex; gap:0.5rem; border-top:1px solid var(--store-border); padding-top:1rem">
                    ${o.status === 'delivered' ? `
                    <button class="s-btn s-btn-secondary print-inv-btn" style="flex:1; padding:0.5rem; font-size:0.8125rem" data-id="${o.id}">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin-right:4px; vertical-align:middle"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                        View Invoice
                    </button>` : `
                    <div style="flex:1; padding:0.5rem; font-size:0.75rem; color:var(--store-text-muted); text-align:center; background:var(--store-bg); border-radius:6px">
                        Invoice will be available after delivery
                    </div>
                    `}
                </div>
            </div>`;
        }).join('');

        renderPendingReviews();

        // Add event listeners to buttons
        list.querySelectorAll('.print-inv-btn').forEach(btn => {
            btn.addEventListener('click', () => window.printOrderInvoice(btn.dataset.id));
        });
    } catch(e) { console.error(e); }
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
            while (n.length > 0) groups.push(n.splice(-2).join(''));
        } else groups.push(n.join(''));
        return groups;
    };
    const convertGroup = (g) => {
        let n = parseInt(g); if (n === 0) return '';
        let res = '';
        if (n >= 100) { res += first[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
        if (n >= 20) { res += tens[Math.floor(n / 10)] + ' '; n %= 10; }
        if (n > 0) res += first[n] + ' ';
        return res;
    };
    let groups = splitNumber(number);
    for (let i = 0; i < groups.length; i++) {
        let gWords = convertGroup(groups[i]);
        if (gWords) word = gWords + (mad[i] ? mad[i] + ' ' : '') + word;
    }
    return word.trim() || 'Zero';
}

function renderPendingReviews() {
    const dashboard = $('pending-reviews-dashboard');
    if (!dashboard) return;

    // Collect all unreviewed items from shipped/delivered orders
    const pendingItems = [];
    const seenProductIds = new Set();

    customerOrders.forEach(o => {
        if (!['shipped', 'out_for_delivery', 'delivered'].includes(o.status)) return;
        (o.items || []).forEach(it => {
            if (seenProductIds.has(it.productId)) return;
            const alreadyReviewed = userReviews.some(r => r.productId === it.productId);
            if (!alreadyReviewed) {
                pendingItems.push(it);
                seenProductIds.add(it.productId);
            }
        });
    });

    if (pendingItems.length === 0) {
        dashboard.innerHTML = '';
        return;
    }

    dashboard.innerHTML = `
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 1.25rem; margin-bottom: 2rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem">
                <h3 style="margin:0; font-size:1.1rem; color:#166534">Pending Feedback</h3>
                <span style="background:#166534; color:white; font-size:0.75rem; padding:2px 8px; border-radius:10px; font-weight:600">${pendingItems.length}</span>
            </div>
            <p style="color:#166534; font-size:0.875rem; margin-bottom:1rem">How was your experience with these products? Your feedback helps others!</p>
            <div style="display:flex; gap:1rem; overflow-x:auto; padding-bottom:0.5rem; scrollbar-width: thin;">
                ${pendingItems.map(it => `
                    <div style="flex:0 0 200px; background:white; border:1px solid #bbf7d0; border-radius:8px; padding:0.75rem; display:flex; flex-direction:column; align-items:center; text-align:center">
                        <img src="${it.image || 'assets/store/img/placeholder.png'}" style="width:60px; height:60px; border-radius:4px; object-fit:cover; margin-bottom:0.5rem">
                        <div style="font-size:0.8125rem; font-weight:600; margin-bottom:0.75rem; height:2.4rem; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${it.title}</div>
                        <a href="#product/${it.productId}" class="s-btn s-btn-primary" style="padding:0.4rem 0.8rem; font-size:0.75rem; width:100%; text-decoration:none; display:inline-block">Rate Now</a>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}


// --- TOAST ---
function toast(msg, type='info') {
    let container = $('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed; top:1.5rem; right:1.5rem; z-index:200; display:flex; flex-direction:column; gap:0.5rem;';
        document.body.appendChild(container);
    }
    const el = document.createElement('div');
    const colors = { success: '#059669', error: '#dc2626', info: '#2563eb' };
    const bgColors = { success: '#ecfdf5', error: '#fef2f2', info: '#eff6ff' };
    el.style.cssText = `padding: 0.875rem 1.25rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); font-size: 0.875rem; font-weight: 500; background: ${bgColors[type]}; color: ${colors[type]}; border-left: 4px solid ${colors[type]}; min-width: 280px; transition: transform 0.3s, opacity 0.3s; transform: translateX(100%); opacity: 0;`;
    el.textContent = msg;
    container.appendChild(el);
    
    requestAnimationFrame(() => { el.style.transform = 'translateX(0)'; el.style.opacity = '1'; });
    setTimeout(() => { 
        el.style.transform = 'translateX(100%)'; el.style.opacity = '0'; 
        setTimeout(() => el.remove(), 300); 
    }, 3000);
}
// --- PINCODE AUTOFILL ---
document.addEventListener('input', async (e) => {
    if (e.target.id && e.target.id.endsWith('pincode')) {
        const pincode = e.target.value.trim();
        if (pincode.length === 6 && /^\d+$/.test(pincode)) {
            const prefix = e.target.id.replace('-pincode', '');
            const cityEl = document.getElementById(prefix + '-city');
            const stateEl = document.getElementById(prefix + '-state');
            
            if (cityEl && stateEl) {
                try {
                    // Show a subtle loading state if possible
                    const originalCity = cityEl.value;
                    if (!originalCity) cityEl.placeholder = 'Loading...';
                    
                    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
                    const data = await res.json();
                    
                    if (data && data[0] && data[0].Status === 'Success') {
                        const postOffice = data[0].PostOffice[0];
                        cityEl.value = postOffice.District;
                        stateEl.value = postOffice.State;
                        // Trigger input events for potential validation/storage
                        cityEl.dispatchEvent(new Event('input', { bubbles: true }));
                        stateEl.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                } catch (err) {
                    console.warn('Pincode lookup failed:', err);
                } finally {
                    cityEl.placeholder = '';
                }
            }
        }
    }
});

// Start
initStore();
function updateFreeShippingTip(subtotal, containerId) {
    const el = $(containerId);
    if (!el || !storeConfig.freeShippingThreshold || storeConfig.freeShippingThreshold <= 0) {
        if (el) el.style.display = 'none';
        return;
    }

    if (subtotal >= storeConfig.freeShippingThreshold) {
        el.style.display = 'block';
        el.style.background = '#f0fdf4';
        el.style.color = '#166534';
        el.style.border = '1px solid #bbf7d0';
        el.innerHTML = `✨ <strong>You've got Free Shipping!</strong>`;
    } else {
        const remaining = storeConfig.freeShippingThreshold - subtotal;
        el.style.display = 'block';
        el.style.background = '#fffbeb';
        el.style.color = '#92400e';
        el.style.border = '1px solid #fde68a';
        el.innerHTML = `🚚 Add <strong>₹${remaining.toLocaleString()}</strong> more for <strong>Free Shipping!</strong>`;
    }
}
