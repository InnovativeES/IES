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



// Member management logic...
export const assignTask = async (employeeId, description) => {
    // This function is no longer used for Internal Orders as "tasks" is a separate concept
};

// --- Project Management Functions ---

export const generateProjectId = async () => {
    const year = new Date().getFullYear();
    const q = query(collection(db, PROJECTS_COLLECTION), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    let count = 1;
    if (!snapshot.empty) {
        const lastProject = snapshot.docs[0].data().projectId;
        if (lastProject && lastProject.startsWith(`IES-${year}`)) {
            count = parseInt(lastProject.split('-')[2]) + 1;
        }
    }
    return `IES-${year}-${count.toString().padStart(5, '0')}`;
};

export const addProject = async (projectData) => {
    try {
        // Use custom projectId if provided (e.g. from Internal Order), else auto-generate
        const projectId = projectData.projectId || await generateProjectId();
        const docRef = await addDoc(collection(db, PROJECTS_COLLECTION), {
            ...projectData,
            projectId: projectId,
            revision: 0,
            status: "Draft",
            currentStage: "Intake",
            progress: 0,
            isLocked: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // Initial Audit Log
        await addAuditLog(docRef.id, "Project Created", `Project ${projectId} initialized.`);

        return { id: docRef.id, projectId: projectId, error: null };
    } catch (error) {
        console.error("Error adding project:", error);
        return { id: null, error: error.message };
    }
};

export const updateProject = async (projectId, updates, userAction = "Updated") => {
    try {
        const ref = doc(db, PROJECTS_COLLECTION, projectId);
        // Check if revision increase is needed (e.g., if status was 'Approved')
        // This logic will be more detailed in the UI/App layer, 
        // but we ensure updatedAt is always set.

        await updateDoc(ref, {
            ...updates,
            updatedAt: serverTimestamp()
        });

        await addAuditLog(projectId, userAction, JSON.stringify(updates));

        return { success: true };
    } catch (error) {
        console.error("Error updating project:", error);
        return { error: error.message };
    }
};

export const addAuditLog = async (projectId, action, details) => {
    try {
        await addDoc(collection(db, PROJECTS_COLLECTION, projectId, "audit_logs"), {
            action,
            details,
            timestamp: serverTimestamp(),
            user: "System/Admin" // Should be passed from actual user session later
        });
    } catch (error) {
        console.error("Audit log error:", error);
    }
};

export const addProjectFile = async (projectId, fileData) => {
    try {
        const docRef = await addDoc(collection(db, PROJECTS_COLLECTION, projectId, "files"), {
            ...fileData,
            uploadedAt: serverTimestamp(),
            isApproved: false
        });
        return { id: docRef.id, error: null };
    } catch (error) {
        console.error("Error adding project file:", error);
        return { id: null, error: error.message };
    }
};

export const uploadProjectFile = async (projectId, file, uploadedBy) => {
    try {
        const fileRef = ref(storage, `projects/${projectId}/files/${Date.now()}_${file.name}`);
        const metadata = {
            contentType: file.type,
        };
        const snapshot = await uploadBytes(fileRef, file, metadata);
        const url = await getDownloadURL(snapshot.ref);

        const fileData = {
            name: file.name,
            url: url,
            size: file.size,
            type: file.type,
            category: 'General', // Default category
            uploadedBy: uploadedBy || 'Admin',
            version: 1
        };

        return await addProjectFile(projectId, fileData);
    } catch (error) {
        console.error("Error uploading project file:", error);
        return { id: null, error: error.message };
    }
};

export const deleteProjectFile = async (projectId, fileId, fileUrl) => {
    try {
        // 1. Delete from Firebase Storage if URL is provided
        if (fileUrl && fileUrl !== '#') {
            try {
                // Extracts the storage path from the URL
                const storageRef = ref(storage, fileUrl);
                await deleteObject(storageRef);
            } catch (storageError) {
                console.warn("Storage deletion failed or file not found:", storageError);
                // Continue with Firestore deletion even if storage fails
            }
        }

        // 2. Delete metadata from Firestore
        await deleteDoc(doc(db, PROJECTS_COLLECTION, projectId, "files", fileId));
        return { success: true, error: null };
    } catch (error) {
        console.error("Error deleting project file:", error);
        return { success: false, error: error.message };
    }
};

export const submitApproval = async (projectId, stage, approverData) => {
    try {
        await addDoc(collection(db, PROJECTS_COLLECTION, projectId, "approvals"), {
            ...approverData,
            stage,
            timestamp: serverTimestamp()
        });

        // If approved, update project stage/status
        if (approverData.status === 'Approved') {
            await updateProject(projectId, {
                status: 'Approved',
                isLocked: true
            }, `Stage ${stage} Approved`);
        }

        return { success: true };
    } catch (error) {
        console.error("Approval error:", error);
        return { error: error.message };
    }
};

export const subscribeToProjects = (callback) => {
    const q = query(collection(db, PROJECTS_COLLECTION), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
        const projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

export const softDeleteProject = async (projectId) => {
    try {
        const ref = doc(db, PROJECTS_COLLECTION, projectId);
        await updateDoc(ref, { isDeleted: true, deletedAt: serverTimestamp() });
        await addAuditLog(projectId, "Moved to Trash", "Project soft-deleted.");
        return { success: true };
    } catch (error) {
        console.error("Error soft-deleting project:", error);
        return { error: error.message };
    }
};

export const restoreProject = async (projectId) => {
    try {
        const ref = doc(db, PROJECTS_COLLECTION, projectId);
        await updateDoc(ref, { isDeleted: false, restoredAt: serverTimestamp() });
        await addAuditLog(projectId, "Restored from Trash", "Project restored.");
        return { success: true };
    } catch (error) {
        console.error("Error restoring project:", error);
        return { error: error.message };
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
        const updates = { status: newStatus };

        // Auto-file contract for certain statuses
        const milestoneStatuses = ['Approved', 'In Progress', 'Completed'];
        if (milestoneStatuses.includes(newStatus)) {
            updates.contractFiled = true;
        }

        await updateDoc(ref, updates);
        return { success: true };
    } catch (error) {
        console.error("Error updating project:", error);
        return { error: error.message };
    }
};


// === CONTRACT REVIEW ===
export const saveContractReview = async (projectDocId, reviewData) => {
    try {
        const ref = doc(db, PROJECTS_COLLECTION, projectDocId, 'contractReview', 'review');
        await setDoc(ref, { ...reviewData, updatedAt: serverTimestamp() }, { merge: true });
        return { success: true };
    } catch (error) {
        console.error("Error saving contract review:", error);
        return { error: error.message };
    }
};

export const getContractReview = async (projectDocId) => {
    try {
        const ref = doc(db, PROJECTS_COLLECTION, projectDocId, 'contractReview', 'review');
        const snap = await getDoc(ref);
        if (snap.exists()) {
            return { data: snap.data(), error: null };
        }
        return { data: null, error: null };
    } catch (error) {
        console.error("Error getting contract review:", error);
        return { data: null, error: error.message };
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

// --- Real-time Project Detail Subscriptions ---

export const subscribeToProjectFiles = (projectId, callback) => {
    const q = query(collection(db, PROJECTS_COLLECTION, projectId, "files"), orderBy("version", "desc"));
    return onSnapshot(q, (snapshot) => {
        const files = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(files);
    });
};

export const subscribeToProjectAuditLogs = (projectId, callback) => {
    const q = query(collection(db, PROJECTS_COLLECTION, projectId, "audit_logs"), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(logs);
    });
};

// === DAILY ROSTER MANAGEMENT ===
const DAILY_ROSTER_COLLECTION = "daily_workflows";

/**
 * Save or update a daily workflow for a specific date + department.
 * Uses composite ID "YYYY-MM-DD_Department" for fast lookups.
 */
export const saveWorkflow = async (date, department, assignments, supervisorNotes = '') => {
    try {
        const docId = `${date}_${department}`;
        const docRef = doc(db, DAILY_ROSTER_COLLECTION, docId);
        const existing = await getDoc(docRef);

        const payload = {
            date,
            department,
            assignments,
            supervisorNotes,
            updatedAt: serverTimestamp()
        };

        if (existing.exists()) {
            await updateDoc(docRef, payload);
        } else {
            await setDoc(docRef, { ...payload, createdAt: serverTimestamp() });
        }

        return { success: true, id: docId };
    } catch (error) {
        console.error("Error saving workflow:", error);
        return { error: error.message };
    }
};

/**
 * Get a single workflow document for a date + department.
 */
export const getWorkflow = async (date, department) => {
    try {
        const docId = `${date}_${department}`;
        const docRef = doc(db, DAILY_ROSTER_COLLECTION, docId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            return { data: { id: snap.id, ...snap.data() }, error: null };
        }
        return { data: null, error: null };
    } catch (error) {
        console.error("Error getting workflow:", error);
        return { data: null, error: error.message };
    }
};

/**
 * Subscribe to all workflow documents for a given date (all departments).
 */
export const subscribeToWorkflows = (date, callback) => {
    const q = query(
        collection(db, DAILY_ROSTER_COLLECTION),
        where("date", "==", date)
    );
    return onSnapshot(q, (snapshot) => {
        const workflows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(workflows);
    });
};

/**
 * Get all workflow documents for a given date (all departments) synchronously.
 */
export const getWorkflowsForDate = async (date) => {
    try {
        const q = query(
            collection(db, DAILY_ROSTER_COLLECTION),
            where("date", "==", date)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        console.error("Error getting workflows for date:", error);
        return [];
    }
};

/**
 * Remove a specific employee's assignment from a workflow document.
 */
export const deleteWorkflowAssignment = async (workflowId, employeeId) => {
    try {
        const docRef = doc(db, DAILY_ROSTER_COLLECTION, workflowId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return { error: "Workflow not found" };

        const data = snap.data();
        const updatedAssignments = (data.assignments || []).filter(a => a.employeeId !== employeeId);

        await updateDoc(docRef, { assignments: updatedAssignments, updatedAt: serverTimestamp() });
        return { success: true };
    } catch (error) {
        console.error("Error deleting assignment:", error);
        return { error: error.message };
    }
};
