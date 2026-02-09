import { db } from "../../../firebase-config.js";
import {
    collection,
    addDoc,
    getDocs,
    query,
    onSnapshot,
    orderBy,
    serverTimestamp,
    where,
    deleteDoc,
    doc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const MEMBERS_COLLECTION = "employees"; // Using same collection for backward compatibility
const PROJECTS_COLLECTION = "projects";
const ORDERS_COLLECTION = "internal_orders";

// Add a new member (alias for backward compatibility)
export const addMember = async (memberData) => {
    try {
        const docRef = await addDoc(collection(db, MEMBERS_COLLECTION), {
            ...memberData,
            createdAt: serverTimestamp()
        });
        return { id: docRef.id, error: null };
    } catch (error) {
        console.error("Error adding member:", error);
        return { id: null, error: error.message };
    }
};

// Update an existing member
export const updateMember = async (memberId, memberData) => {
    try {
        const docRef = doc(db, MEMBERS_COLLECTION, memberId);
        await updateDoc(docRef, {
            ...memberData,
            updatedAt: serverTimestamp()
        });
        return { id: memberId, error: null };
    } catch (error) {
        console.error("Error updating member:", error);
        return { id: null, error: error.message };
    }
};

// Subscribe to member list updates (Real-time)
export const subscribeToMembers = (callback) => {
    const q = query(collection(db, MEMBERS_COLLECTION), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
        const members = [];
        snapshot.forEach((doc) => {
            members.push({ id: doc.id, ...doc.data() });
        });
        callback(members);
    });
};

// Delete a member
export const deleteMember = async (memberId) => {
    try {
        const docRef = doc(db, MEMBERS_COLLECTION, memberId);
        await deleteDoc(docRef);
        return { success: true, error: null };
    } catch (error) {
        console.error("Error deleting member:", error);
        return { success: false, error: error.message };
    }
};

// Backward compatibility aliases
export const addEmployee = addMember;
export const subscribeToEmployees = subscribeToMembers;

// Get stats
export const getStats = async () => {
    const membersSnap = await getDocs(collection(db, MEMBERS_COLLECTION));
    return {
        totalMembers: membersSnap.size,
        totalEmployees: membersSnap.size, // Backward compatibility
        activeTasks: 12,
        completedTasks: 84,
        departments: 4
    };
};



export const assignTask = async (employeeId, description) => {
    try {
        await addDoc(collection(db, "tasks"), {
            employeeId,
            description,
            status: "In Progress",
            createdAt: serverTimestamp()
        });
        return { success: true };
    } catch (e) {
        console.error("Task assign error:", e);
        return { error: e.message };
    }
};

// Projects
export const addProject = async (projectData) => {
    try {
        const docRef = await addDoc(collection(db, PROJECTS_COLLECTION), {
            ...projectData,
            status: "Planning",
            createdAt: serverTimestamp()
        });
        return { id: docRef.id, error: null };
    } catch (error) {
        console.error("Error adding project:", error);
        return { id: null, error: error.message };
    }
};

export const subscribeToProjects = (callback) => {
    const q = query(collection(db, PROJECTS_COLLECTION), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
        const projects = [];
        snapshot.forEach((doc) => {
            projects.push({ id: doc.id, ...doc.data() });
        });
        callback(projects);
    });
};

export const deleteProject = async (projectId) => {
    try {
        const docRef = doc(db, PROJECTS_COLLECTION, projectId);
        await deleteDoc(docRef);
        return { success: true, error: null };
    } catch (error) {
        console.error("Error deleting project:", error);
        return { success: false, error: error.message };
    }
};

export const addOrder = async (orderData) => {
    try {
        const docRef = await addDoc(collection(db, ORDERS_COLLECTION), {
            ...orderData,
            createdAt: serverTimestamp()
        });
        return { id: docRef.id, error: null };
    } catch (error) {
        console.error("Error adding order:", error);
        return { id: null, error: error.message };
    }
};


export const subscribeToOrders = (callback, showTrash = false) => {
    // Filter by isDeleted status
    // Note: To use multiple where clauses and orderBy, you might need a composite index.
    // For simplicity, we can fetch most and filter client-side if the dataset is small, 
    // BUT correctly we should use where.
    // Let's use where('isDeleted', '==', true/false)

    // If showTrash is true, we want isDeleted == true
    // If showTrash is false, we want isDeleted != true (or false/null)

    const status = showTrash ? true : false;

    // For simple queries without index, we might just query all and filter in JS if the array is small.
    // However, let's try to be robust. 
    // We will order by createdAt desc. Using where and orderBy usually requires index.
    // Let's just fetch all sorted by date and filter client side for this prototype to avoid index creation blocks.

    const q = query(collection(db, ORDERS_COLLECTION), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
        const orders = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            // Client-side filtering to avoid index requirements for now
            const isTrash = !!data.isDeleted;
            if (isTrash === showTrash) {
                orders.push({ id: doc.id, ...data });
            }
        });
        callback(orders);
    });
};

export const updateOrder = async (orderId, updates) => {
    try {
        const ref = doc(db, ORDERS_COLLECTION, orderId);
        await updateDoc(ref, updates);
        return { success: true };
    } catch (error) {
        console.error("Error updating order:", error);
        return { error: error.message };
    }
};

export const softDeleteOrder = async (orderId) => {
    return updateOrder(orderId, { isDeleted: true, deletedAt: serverTimestamp() });
};

export const restoreOrder = async (orderId) => {
    return updateOrder(orderId, { isDeleted: false, restoredAt: serverTimestamp() });
};

export const permanentDeleteOrder = async (orderId) => {
    try {
        await deleteDoc(doc(db, ORDERS_COLLECTION, orderId));
        return { success: true };
    } catch (error) {
        console.error("Error deleting order:", error);
        return { error: error.message };
    }
};

export const updateProjectStatus = async (projectId, newStatus) => {
    try {
        const ref = doc(db, PROJECTS_COLLECTION, projectId);
        await updateDoc(ref, { status: newStatus });
        return { success: true };
    } catch (error) {
        console.error("Error updating project:", error);
        return { error: error.message };
    }
};

// === DAILY STATS (For Delivery Report) ===
const STATS_COLLECTION = "daily_stats";

export const getDailyStats = async (startDate, endDate) => {
    try {
        const q = query(
            collection(db, STATS_COLLECTION),
            where("date", ">=", startDate),
            where("date", "<=", endDate)
        );
        const snapshot = await getDocs(q);
        const stats = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            stats[data.date] = { id: doc.id, ...data };
        });
        return stats;
    } catch (error) {
        console.error("Error fetching daily stats:", error);
        return {};
    }
};

export const saveDailyStat = async (date, field, value) => {
    try {
        const q = query(collection(db, STATS_COLLECTION), where("date", "==", date));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            await addDoc(collection(db, STATS_COLLECTION), {
                date: date,
                [field]: value,
                createdAt: serverTimestamp()
            });
        } else {
            const docId = snapshot.docs[0].id;
            const ref = doc(db, STATS_COLLECTION, docId);
            await updateDoc(ref, {
                [field]: value,
                updatedAt: serverTimestamp()
            });
        }
        return { success: true };
    } catch (error) {
        console.error("Error saving daily stat:", error);
        return { error: error.message };
    }
};

export const getTrashOrders = async () => {
    try {
        const q = query(collection(db, ORDERS_COLLECTION), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        const orders = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            if (!!data.isDeleted) {
                orders.push({ id: doc.id, ...data });
            }
        });
        return orders;
    } catch (e) {
        console.error("Error fetching trash orders:", e);
        return [];
    }
};

export const emptyTrash = async (type) => {
    try {
        const q = query(collection(db, ORDERS_COLLECTION), where("isDeleted", "==", true));
        const snapshot = await getDocs(q);

        let deletedCount = 0;
        const promises = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const isDelivery = data.entryType === 'delivery_report';

            if (type === 'delivery' && isDelivery) {
                promises.push(deleteDoc(docSnap.ref));
                deletedCount++;
            } else if (type === 'internal' && !isDelivery) {
                promises.push(deleteDoc(docSnap.ref));
                deletedCount++;
            }
        });

        await Promise.all(promises);
        return { success: true, deletedCount };
    } catch (error) {
        console.error("Error emptying trash:", error);
        return { error: error.message };
    }
};

// === DAILY REPORTS (Pending Orders Auto-Save) ===
const REPORTS_COLLECTION = "daily_reports";

export const saveReport = async (reportData) => {
    try {
        // Use date string as document ID for easy lookup
        const dateId = reportData.date; // Format: YYYY-MM-DD
        const docRef = doc(db, REPORTS_COLLECTION, dateId);

        // Check if report exists for this date
        const { getDoc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const existingDoc = await getDoc(docRef);

        if (existingDoc.exists()) {
            // Update existing
            await updateDoc(docRef, {
                ...reportData,
                updatedAt: serverTimestamp()
            });
        } else {
            // Create new
            await setDoc(docRef, {
                ...reportData,
                createdAt: serverTimestamp()
            });
        }

        return { success: true, id: dateId };
    } catch (error) {
        console.error("Error saving report:", error);
        return { error: error.message };
    }
};

export const getReports = async (limit = 30) => {
    try {
        const q = query(
            collection(db, REPORTS_COLLECTION),
            orderBy("date", "desc")
        );
        const snapshot = await getDocs(q);
        const reports = [];
        snapshot.forEach(doc => {
            reports.push({ id: doc.id, ...doc.data() });
        });
        // Return most recent reports (limit)
        return reports.slice(0, limit);
    } catch (error) {
        console.error("Error fetching reports:", error);
        return [];
    }
};

export const checkTodayReport = async (dateStr) => {
    try {
        const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const docRef = doc(db, REPORTS_COLLECTION, dateStr);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
        console.error("Error checking today's report:", error);
        return null;
    }
};
