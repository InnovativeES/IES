import { db, storage } from "../../../firebase-config.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import {
    collection,
    addDoc,
    getDocs,
    getDoc,
    setDoc,
    query,
    onSnapshot,
    orderBy,
    serverTimestamp,
    where,
    deleteDoc,
    doc,
    updateDoc,
    increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const INVENTORY_COLLECTION = "inventory";
const TRANSACTIONS_COLLECTION = "inventory_transactions";

/**
 * Get all inventory items with real-time updates
 */
export const getInventory = (callback) => {
    const q = query(collection(db, INVENTORY_COLLECTION), orderBy("name", "asc"));
    return onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(items);
    }, (error) => {
        console.error("Error fetching inventory:", error);
    });
};

/**
 * Add a new inventory item
 */
export const addInventoryItem = async (itemData) => {
    try {
        const data = {
            ...itemData,
            currentStock: itemData.currentStock || 0,
            minimumLevel: itemData.minimumLevel || 0,
            price: itemData.price || 0,
            isDeleted: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        // Auto-generate ID
        const docRef = await addDoc(collection(db, INVENTORY_COLLECTION), data);

        // Record initial stock as a transaction if > 0
        if (itemData.currentStock > 0) {
            await recordTransaction({
                itemId: docRef.id,
                itemName: itemData.name,
                category: itemData.category,
                type: 'IN',
                quantity: itemData.currentStock,
                unitPrice: itemData.price || 0,
                totalCost: (itemData.currentStock || 0) * (itemData.price || 0),
                reason: 'Initial Stock',
                orderId: itemData.orderId || null,
                performedBy: 'System',
                timestamp: serverTimestamp()
            });
        }

        return { id: docRef.id, error: null };
    } catch (error) {
        console.error("Error adding inventory item:", error);
        return { id: null, error: error.message };
    }
};

/**
 * Update an existing inventory item's details
 */
export const updateInventoryItem = async (itemId, updatedData) => {
    try {
        const itemRef = doc(db, INVENTORY_COLLECTION, itemId);
        await updateDoc(itemRef, {
            ...updatedData,
            updatedAt: serverTimestamp()
        });
        return { success: true, error: null };
    } catch (error) {
        console.error("Error updating inventory item:", error);
        return { success: false, error: error.message };
    }
};

/**
 * Update stock level and record transaction
 */
export const updateStock = async (itemId, itemName, type, quantity, reason, orderId = null, unitPrice = 0, performedBy = 'Admin', category = 'Unknown') => {
    try {
        const itemRef = doc(db, INVENTORY_COLLECTION, itemId);
        const stockChange = type === 'IN' ? quantity : -quantity;
        const totalCost = quantity * unitPrice;

        // Atomic update of current stock + tracking last reason for search
        await updateDoc(itemRef, {
            currentStock: increment(stockChange),
            lastReason: reason || '',
            updatedAt: serverTimestamp()
        });

        // Record the transaction
        await recordTransaction({
            itemId,
            itemName,
            category,
            type,
            quantity,
            unitPrice,
            totalCost,
            reason,
            orderId,
            performedBy,
            timestamp: serverTimestamp()
        });

        return { success: true, error: null };
    } catch (error) {
        console.error("Error updating stock:", error);
        return { success: false, error: error.message };
    }
};

/**
 * Get transaction history (Fixed implementation)
 */
export const getInventoryTransactions = (callback) => {
    const q = query(collection(db, TRANSACTIONS_COLLECTION), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snapshot) => {
        const transactions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(transactions);
    }, (error) => {
        console.error("Error fetching transactions:", error);
    });
};

/**
 * Soft delete inventory item
 */
export const softDeleteInventoryItem = async (itemId) => {
    try {
        const itemRef = doc(db, INVENTORY_COLLECTION, itemId);
        await updateDoc(itemRef, {
            isDeleted: true,
            updatedAt: serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        console.error("Error deleting item:", error);
        return { success: false, error: error.message };
    }
};

/**
 * Restore inventory item
 */
export const restoreInventoryItem = async (itemId) => {
    try {
        const itemRef = doc(db, INVENTORY_COLLECTION, itemId);
        await updateDoc(itemRef, {
            isDeleted: false,
            updatedAt: serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        console.error("Error restoring item:", error);
        return { success: false, error: error.message };
    }
};

/**
 * Permanently delete inventory item
 */
export const permanentDeleteInventoryItem = async (itemId) => {
    try {
        // Fetch item first to check for photoUrl
        const itemSnap = await getDoc(doc(db, INVENTORY_COLLECTION, itemId));
        if (itemSnap.exists()) {
            const item = itemSnap.data();
            if (item.photoUrl) {
                try {
                    // Extract path from URL or use a structured approach
                    // If your URL is https://firebasestorage.googleapis.com/v0/b/.../o/inventory%2FITEM_ID%2Fphoto_DATE?alt=media
                    // The refFromURL is useful but often easier to just store the path or reconstruct it.
                    // For now, let's try to delete if we can get the ref. 
                    const fileRef = ref(storage, item.photoUrl);
                    await deleteObject(fileRef);
                } catch (storageErr) {
                    console.warn("Could not delete photo from storage (might already be gone):", storageErr);
                }
            }
        }

        await deleteDoc(doc(db, INVENTORY_COLLECTION, itemId));
        return { success: true };
    } catch (error) {
        console.error("Error permanent deleting item:", error);
        return { success: false, error: error.message };
    }
};

/**
 * Record a movement transaction
 */
const recordTransaction = async (transactionData) => {
    try {
        await addDoc(collection(db, TRANSACTIONS_COLLECTION), {
            ...transactionData,
            category: transactionData.category || 'General',
            user: transactionData.performedBy || 'Admin',
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Error recording transaction:", error);
    }
};

/**
 * Delete a transaction and reverse the stock change
 */
export const deleteTransaction = async (transactionId) => {
    try {
        const txRef = doc(db, TRANSACTIONS_COLLECTION, transactionId);
        const txSnap = await getDoc(txRef);

        if (!txSnap.exists()) {
            return { success: false, error: 'Transaction not found.' };
        }

        const txData = txSnap.data();

        // Reverse the stock change on the inventory item
        if (txData.itemId) {
            const itemRef = doc(db, INVENTORY_COLLECTION, txData.itemId);
            const itemSnap = await getDoc(itemRef);
            if (itemSnap.exists()) {
                // If it was IN, we subtract; if it was OUT, we add back
                const reverseChange = txData.type === 'IN' ? -(txData.quantity || 0) : (txData.quantity || 0);
                await updateDoc(itemRef, {
                    currentStock: increment(reverseChange),
                    updatedAt: serverTimestamp()
                });
            }
        }

        // Delete the transaction document
        await deleteDoc(txRef);

        return { success: true };
    } catch (error) {
        console.error("Error deleting transaction:", error);
        return { success: false, error: error.message };
    }
};

/**
 * Upload tool photo (1MB Limit)
 */
export const uploadToolPhoto = async (itemId, file) => {
    try {
        // Double check size limit (1MB = 1048576 bytes)
        if (file.size > 1048576) {
            throw new Error("File size exceeds 1MB limit.");
        }

        const storageRef = ref(storage, `inventory/${itemId}/photo_${Date.now()}`);
        const metadata = { contentType: file.type };
        const snapshot = await uploadBytes(storageRef, file, metadata);
        const photoUrl = await getDownloadURL(snapshot.ref);

        // Update item with photo URL
        await updateDoc(doc(db, INVENTORY_COLLECTION, itemId), {
            photoUrl: photoUrl,
            updatedAt: serverTimestamp()
        });

        return { url: photoUrl, error: null };
    } catch (error) {
        console.error("Error uploading tool photo:", error);
        return { url: null, error: error.message };
    }
};
