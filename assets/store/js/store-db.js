import { db, storage } from '../../../firebase-config.js';
import {
    collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp,
    runTransaction, increment
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    ref, uploadBytes, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

// ─── PRODUCTS ───
export async function getProducts(filters = {}) {
    let q = collection(db, 'store_products');
    const constraints = [];
    if (filters.status) constraints.push(where('status', '==', filters.status));
    if (filters.category) constraints.push(where('category', '==', filters.category));
    constraints.push(orderBy('createdAt', 'desc'));
    q = query(q, ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getProduct(id) {
    const snap = await getDoc(doc(db, 'store_products', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function addProduct(data) {
    data.createdAt = serverTimestamp();
    data.updatedAt = serverTimestamp();
    const ref_ = await addDoc(collection(db, 'store_products'), data);
    return ref_.id;
}

export async function updateProduct(id, data) {
    data.updatedAt = serverTimestamp();
    await updateDoc(doc(db, 'store_products', id), data);
}

export async function deleteProduct(id) {
    await deleteDoc(doc(db, 'store_products', id));
}

export function subscribeProducts(callback) {
    const q = query(collection(db, 'store_products'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

// ─── ORDERS ───
export async function getOrders(filters = {}) {
    let constraints = [];
    if (filters.status && filters.status !== 'all') {
        constraints.push(where('status', '==', filters.status));
    } else {
        // By default, don't show deleted orders unless status is 'deleted'
        constraints.push(where('status', '!=', 'deleted'));
    }
    constraints.push(orderBy('status')); // Status is first for the != query requirement
    constraints.push(orderBy('createdAt', 'desc'));
    if (filters.limit) constraints.push(limit(filters.limit));
    const q = query(collection(db, 'store_orders'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getOrder(id) {
    const snap = await getDoc(doc(db, 'store_orders', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createOrder(data) {
    data.createdAt = serverTimestamp();
    data.updatedAt = serverTimestamp();
    const ref_ = await addDoc(collection(db, 'store_orders'), data);
    return ref_.id;
}

export async function updateOrder(id, data) {
    data.updatedAt = serverTimestamp();
    await updateDoc(doc(db, 'store_orders', id), data);
}

export function subscribeOrders(callback) {
    const q = query(collection(db, 'store_orders'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

// ─── CUSTOMERS ───
export async function getCustomer(uid) {
    const snap = await getDoc(doc(db, 'store_customers', uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveCustomer(uid, data) {
    await setDoc(doc(db, 'store_customers', uid), data, { merge: true });
}

// ─── STORE CONFIG ───
export async function getStoreConfig() {
    const snap = await getDoc(doc(db, 'store_config', 'settings'));
    if (snap.exists()) return snap.data();
    // Return defaults if no config exists
    const defaults = {
        storeName: 'IES Store',
        currency: 'INR',
        categories: ['Kitchen & Dining', 'Industrial Hardware', 'Home & Storage', 'Custom & B2C'],
        shippingRates: [
            { name: 'Standard Shipping', price: 60, minDays: 5, maxDays: 7 },
            { name: 'Express Shipping', price: 120, minDays: 2, maxDays: 3 }
        ],
        freeShippingThreshold: 999,
        taxRate: 0,
        upiId: '',
        upiQrImage: '',
        storeActive: true
    };
    await setDoc(doc(db, 'store_config', 'settings'), defaults);
    return defaults;
}

export async function saveStoreConfig(data) {
    await setDoc(doc(db, 'store_config', 'settings'), data, { merge: true });
}

// ─── IMAGE UPLOAD (Firebase Storage) ───
export async function uploadProductImage(file, productId) {
    const ext = file.name.split('.').pop();
    const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
    const storageRef = ref(storage, `store/products/${productId || 'temp'}/${filename}`);
    const snap = await uploadBytes(storageRef, file);
    return await getDownloadURL(snap.ref);
}

export async function deleteProductImage(url) {
    try {
        const imageRef = ref(storage, url);
        await deleteObject(imageRef);
    } catch (err) {
        console.warn('Could not delete image:', err);
    }
}

// ─── STATS HELPERS ───
export async function getDashboardStats() {
    const [products, orders] = await Promise.all([
        getDocs(collection(db, 'store_products')),
        getDocs(collection(db, 'store_orders'))
    ]);

    const allProducts = products.docs.map(d => d.data());
    const allOrders = orders.docs.map(d => ({ id: d.id, ...d.data() }));

    const activeProducts = allProducts.filter(p => p.status === 'active').length;
    const totalProducts = allProducts.length;
    const lowStock = allProducts.filter(p => p.stock !== undefined && p.stock <= 5 && p.status === 'active').length;

    const activeOrders = allOrders.filter(o => !['delivered', 'cancelled'].includes(o.status)).length;
    const pendingVerification = allOrders.filter(o => o.paymentStatus === 'pending_verification').length;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthRevenue = allOrders
        .filter(o => o.paymentStatus === 'paid' && o.createdAt && o.createdAt.toDate() >= monthStart)
        .reduce((sum, o) => sum + (o.total || 0), 0);

    return {
        totalProducts, activeProducts, lowStock,
        activeOrders, pendingVerification,
        monthRevenue,
        recentOrders: allOrders.slice(0, 5)
    };
}

// ─── UTILS ───
export async function getNextOrderNumber() {
    const counterRef = doc(db, 'store_config', 'counters');
    return await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        let next = 1;
        if (!counterDoc.exists()) {
            transaction.set(counterRef, { lastOrder: 1 });
        } else {
            next = (counterDoc.data().lastOrder || 0) + 1;
            transaction.update(counterRef, { lastOrder: next });
        }
        return next;
    });
}

export async function getCustomers() {
    const snap = await getDocs(collection(db, 'store_customers'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
