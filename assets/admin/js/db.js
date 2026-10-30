import { getCollectionName } from "./units.js";
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

const getMembersCol = () => getCollectionName("employees");
const getProjectsCol = () => getCollectionName("projects");
const getOrdersCol = () => getCollectionName("internal_orders");

// Add a new member (alias for backward compatibility)
export const addMember = async (memberData) => {
    try {
        const docRef = await addDoc(collection(db, getMembersCol()), {
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
        const docRef = doc(db, getMembersCol(), memberId);
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

// Get all members (synchronous fetch)
export const getMembers = async () => {
    try {
        const snapshot = await getDocs(collection(db, getMembersCol()));
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Error fetching members:", error);
        return [];
    }
};

// Subscribe to member list updates (Real-time)
export const subscribeToMembers = (callback) => {
    const q = query(collection(db, getMembersCol()), orderBy("createdAt", "desc"));
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
        const docRef = doc(db, getMembersCol(), memberId);
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
    const membersSnap = await getDocs(collection(db, getMembersCol()));
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
    const q = query(collection(db, getProjectsCol()), orderBy("createdAt", "desc"));
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
        const normalized = normalizeProjectRecord(projectData);
        // Use custom projectId if provided (e.g. from Internal Order), else auto-generate
        const projectId = normalized.projectId || await generateProjectId();
        const docRef = await addDoc(collection(db, getProjectsCol()), {
            ...normalized,
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
        const ref = doc(db, getProjectsCol(), projectId);
        const normalized = normalizeProjectRecord(updates);
        // Check if revision increase is needed (e.g., if status was 'Approved')
        // This logic will be more detailed in the UI/App layer, 
        // but we ensure updatedAt is always set.

        await updateDoc(ref, {
            ...normalized,
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
        await addDoc(collection(db, getProjectsCol(), projectId, "audit_logs"), {
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
        const docRef = await addDoc(collection(db, getProjectsCol(), projectId, "files"), {
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
        await deleteDoc(doc(db, getProjectsCol(), projectId, "files", fileId));
        return { success: true, error: null };
    } catch (error) {
        console.error("Error deleting project file:", error);
        return { success: false, error: error.message };
    }
};

export const submitApproval = async (projectId, stage, approverData) => {
    try {
        await addDoc(collection(db, getProjectsCol(), projectId, "approvals"), {
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

// Helper to normalize Order / Project text fields to ALL CAPS across the entire admin panel
const normalizeOrderRecord = (data) => {
    if (!data) return data;
    const copy = { ...data };
    if (copy.customer) copy.customer = String(copy.customer).trim().toUpperCase();
    if (copy.description) copy.description = String(copy.description).trim().toUpperCase();
    if (copy.drawingNo) copy.drawingNo = String(copy.drawingNo).trim().toUpperCase();
    return copy;
};

const normalizeProjectRecord = (data) => {
    if (!data) return data;
    const copy = { ...data };
    if (copy.customerName) copy.customerName = String(copy.customerName).trim().toUpperCase();
    if (copy.name) copy.name = String(copy.name).trim().toUpperCase();
    return copy;
};

export const subscribeToProjects = (callback, errorCallback) => {
    const colRef = collection(db, getProjectsCol());
    return onSnapshot(colRef, (snapshot) => {
        const projects = snapshot.docs.map(doc => normalizeProjectRecord({ id: doc.id, ...doc.data() }));
        // Safe in-memory sorting: newest timestamp or highest projectId first.
        // Prevents Firestore from silently dropping projects that do not have a createdAt field.
        projects.sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : (new Date(a.createdAt || a.startDate || 0).getTime() || 0));
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : (new Date(b.createdAt || b.startDate || 0).getTime() || 0));
            if (timeB !== timeA) return timeB - timeA;
            return String(b.projectId || '').localeCompare(String(a.projectId || ''), undefined, { numeric: true });
        });
        callback(projects);
    }, (error) => {
        console.error("Error subscribing to projects:", error);
        if (errorCallback) errorCallback(error);
        else callback([]);
    });
};

export const deleteProject = async (projectId) => {
    try {
        const docRef = doc(db, getProjectsCol(), projectId);
        await deleteDoc(docRef);
        return { success: true, error: null };
    } catch (error) {
        console.error("Error deleting project:", error);
        return { success: false, error: error.message };
    }
};

export const softDeleteProject = async (projectId) => {
    try {
        const ref = doc(db, getProjectsCol(), projectId);
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
        const ref = doc(db, getProjectsCol(), projectId);
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
        const normalized = normalizeOrderRecord(orderData);
        const docRef = await addDoc(collection(db, getOrdersCol()), {
            ...normalized,
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

    const q = query(collection(db, getOrdersCol()), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
        const orders = [];
        snapshot.forEach((doc) => {
            const data = normalizeOrderRecord(doc.data());
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
        const ref = doc(db, getOrdersCol(), orderId);
        await updateDoc(ref, normalizeOrderRecord(updates));
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
        await deleteDoc(doc(db, getOrdersCol(), orderId));
        return { success: true };
    } catch (error) {
        console.error("Error deleting order:", error);
        return { error: error.message };
    }
};

export const updateProjectStatus = async (projectId, newStatus) => {
    try {
        const ref = doc(db, getProjectsCol(), projectId);
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
        const ref = doc(db, getProjectsCol(), projectDocId, 'contractReview', 'review');
        await setDoc(ref, { ...reviewData, updatedAt: serverTimestamp() }, { merge: true });
        return { success: true };
    } catch (error) {
        console.error("Error saving contract review:", error);
        return { error: error.message };
    }
};

export const getContractReview = async (projectDocId) => {
    try {
        const ref = doc(db, getProjectsCol(), projectDocId, 'contractReview', 'review');
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
const getStatsCol = () => getCollectionName("daily_stats");

export const getDailyStats = async (startDate, endDate) => {
    try {
        const q = query(
            collection(db, getStatsCol()),
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
        const q = query(collection(db, getStatsCol()), where("date", "==", date));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            await addDoc(collection(db, getStatsCol()), {
                date: date,
                [field]: value,
                createdAt: serverTimestamp()
            });
        } else {
            const docId = snapshot.docs[0].id;
            const ref = doc(db, getStatsCol(), docId);
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
        const q = query(collection(db, getOrdersCol()), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        const orders = [];
        snapshot.forEach((doc) => {
            const data = normalizeOrderRecord(doc.data());
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
        const q = query(collection(db, getOrdersCol()), where("isDeleted", "==", true));
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
const getReportsCol = () => getCollectionName("daily_reports");

export const saveReport = async (reportData) => {
    try {
        // Use date string as document ID for easy lookup
        const dateId = reportData.date; // Format: YYYY-MM-DD
        const docRef = doc(db, getReportsCol(), dateId);

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
            collection(db, getReportsCol()),
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
        const docRef = doc(db, getReportsCol(), dateStr);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
        console.error("Error checking today's report:", error);
        return null;
    }
};

// --- Real-time Project Detail Subscriptions ---

export const subscribeToProjectFiles = (projectId, callback) => {
    const q = query(collection(db, getProjectsCol(), projectId, "files"), orderBy("version", "desc"));
    return onSnapshot(q, (snapshot) => {
        const files = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(files);
    });
};

export const subscribeToProjectAuditLogs = (projectId, callback) => {
    const q = query(collection(db, getProjectsCol(), projectId, "audit_logs"), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(logs);
    });
};

// === DAILY ROSTER MANAGEMENT ===
const getRosterCol = () => getCollectionName("daily_workflows");

/**
 * Normalizes department names to prevent duplicate Firestore documents 
 * (e.g., "Fab" vs "Fabrication").
 */
const normalizeDeptName = (dept) => {
    if (!dept) return 'Unassigned';
    const d = dept.trim();
    if (d.toLowerCase() === 'fabrication' || d.toLowerCase() === 'fab') return 'Fab';
    return d;
};

/**
 * Save or update a daily workflow for a specific date + department.
 * Uses composite ID "YYYY-MM-DD_Department" for fast lookups.
 */
export const saveWorkflow = async (date, department, assignments, supervisorNotes = '', attendance = {}) => {
    try {
        const normDept = normalizeDeptName(department);
        const docId = `${date}_${normDept}`;
        const docRef = doc(db, getRosterCol(), docId);
        const existing = await getDoc(docRef);

        // EXTRA CLEANUP: If we are saving "Fab", make sure to delete legacy "Fabrication" doc to avoid duplicates
        if (normDept === 'Fab' && department !== 'Fabrication') {
            const legacyId = `${date}_Fabrication`;
            const legacyRef = doc(db, getRosterCol(), legacyId);
            const legacySnap = await getDoc(legacyRef);
            if (legacySnap.exists()) {
                console.log("Cleaning up legacy Fabrication document...");
                await deleteDoc(legacyRef);
            }
        }

        // Extract unique project IDs from nested tasks
        const projectIds = [...new Set((assignments || []).flatMap(a => (a.tasks || []).map(t => t.orderNo)).filter(id => id && id !== 'Ad-hoc'))];

        const payload = {
            date,
            department,
            assignments,
            projectIds,
            supervisorNotes,
            attendance,
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
 * Delete a roster document for a specific date + department.
 */
export const deleteDailyRoster = async (date, department) => {
    try {
        const normDept = normalizeDeptName(department);
        const docId = `${date}_${normDept}`;
        const docRef = doc(db, getRosterCol(), docId);
        await deleteDoc(docRef);

        // Also check and delete legacy if applicable
        if (normDept === 'Fab') {
            const legacyId = `${date}_Fabrication`;
            const legacyRef = doc(db, getRosterCol(), legacyId);
            await deleteDoc(legacyRef).catch(() => { });
        }

        return { success: true };
    } catch (error) {
        console.error("Error deleting roster:", error);
        return { error: error.message };
    }
};

/**
 * Get a single workflow document for a date + department.
 */
export const getWorkflow = async (date, department) => {
    try {
        const normDept = normalizeDeptName(department);
        const docId = `${date}_${normDept}`;
        const docRef = doc(db, getRosterCol(), docId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            return { data: { id: snap.id, ...snap.data() }, error: null };
        }

        // Final fallback for legacy data if not yet migrated
        if (normDept === 'Fab') {
            const legacyId = `${date}_Fabrication`;
            const legacySnap = await getDoc(doc(db, getRosterCol(), legacyId));
            if (legacySnap.exists()) {
                return { data: { id: legacySnap.id, ...legacySnap.data() }, error: null };
            }
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
        collection(db, getRosterCol()),
        where("date", "==", date)
    );
    return onSnapshot(q, (snapshot) => {
        const workflows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(workflows, snapshot.metadata);
    });
};

/**
 * Get all workflow documents for a given date (all departments) synchronously.
 */
export const getWorkflowsForDate = async (date) => {
    try {
        const q = query(
            collection(db, getRosterCol()),
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
        const docRef = doc(db, getRosterCol(), workflowId);
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

/**
 * Get all roster assignments for a specific project.
 */
export const getProjectAssignments = async (projectId) => {
    try {
        const q = query(
            collection(db, getRosterCol()),
            where("projectIds", "array-contains", projectId)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        console.error("Error fetching project assignments:", error);
        return [];
    }
};

/**
 * Get all workflow documents (for migration).
 */
export const getAllWorkflows = async () => {
    try {
        const snap = await getDocs(collection(db, getRosterCol()));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        console.error("Error fetching all workflows:", error);
        return [];
    }
};
/**
 * Get all workflow documents for a date range.
 */
export const getWorkflowsForDateRange = async (startDate, endDate) => {
    try {
        const q = query(
            collection(db, getRosterCol()),
            where("date", ">=", startDate),
            where("date", "<=", endDate)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        console.error("Error fetching workflows for range:", error);
        return [];
    }
};

/**
 * Get all order documents for a date range.
 */
export const getOrdersForDateRange = async (startDate, endDate) => {
    try {
        const q = query(
            collection(db, getOrdersCol()),
            where("date", ">=", startDate),
            where("date", "<=", endDate)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => normalizeOrderRecord({ id: d.id, ...d.data() }));
    } catch (error) {
        console.error("Error fetching orders for range:", error);
        return [];
    }
};

// === COSTING EXPENSES ===
const getCostingCol = () => getCollectionName("costing_expenses");

export const addCostingExpense = async (expenseData) => {
    try {
        const docRef = await addDoc(collection(db, getCostingCol()), {
            ...expenseData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return { id: docRef.id, error: null };
    } catch (error) {
        console.error("Error adding costing expense:", error);
        return { id: null, error: error.message };
    }
};

export const updateCostingExpense = async (expenseId, updates) => {
    try {
        const docRef = doc(db, getCostingCol(), expenseId);
        await updateDoc(docRef, {
            ...updates,
            updatedAt: serverTimestamp()
        });
        return { success: true, error: null };
    } catch (error) {
        console.error("Error updating costing expense:", error);
        return { success: false, error: error.message };
    }
};

export const deleteCostingExpense = async (expenseId) => {
    try {
        await deleteDoc(doc(db, getCostingCol(), expenseId));
        return { success: true, error: null };
    } catch (error) {
        console.error("Error deleting costing expense:", error);
        return { success: false, error: error.message };
    }
};

export const subscribeToCostingExpenses = (orderId, callback) => {
    const q = query(
        collection(db, getCostingCol()),
        where("orderId", "==", orderId)
    );
    return onSnapshot(q, (snapshot) => {
        const expenses = [];
        snapshot.forEach((doc) => {
            expenses.push({ id: doc.id, ...doc.data() });
        });
        // Sort chronologically by date
        expenses.sort((a, b) => {
            const dateA = a.date || "";
            const dateB = b.date || "";
            return dateA.localeCompare(dateB);
        });
        callback(expenses);
    }, (error) => {
        console.error("Error subscribing to costing expenses:", error);
        callback([]);
    });
};

export const subscribeToAllCostingExpenses = (callback) => {
    const q = collection(db, getCostingCol());
    return onSnapshot(q, (snapshot) => {
        const expenses = [];
        snapshot.forEach((doc) => {
            expenses.push({ id: doc.id, ...doc.data() });
        });
        callback(expenses);
    }, (error) => {
        console.error("Error subscribing to all costing expenses:", error);
        callback([]);
    });
};

/* ==========================================================================
   PAYSLIP MODULE COLLECTIONS & FUNCTIONS
   ========================================================================== */
const getPayslipsCol = () => getCollectionName("payslips");
const getPayslipFormatsCol = () => getCollectionName("payslip_formats");

export const addPayslip = async (data) => {
    try {
        const docRef = await addDoc(collection(db, getPayslipsCol()), {
            ...data,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return { id: docRef.id, error: null };
    } catch (error) {
        console.error("Error adding payslip:", error);
        return { id: null, error: error.message };
    }
};

export const updatePayslip = async (id, data) => {
    try {
        const docRef = doc(db, getPayslipsCol(), id);
        await updateDoc(docRef, {
            ...data,
            updatedAt: serverTimestamp()
        });
        return { id, error: null };
    } catch (error) {
        console.error("Error updating payslip:", error);
        return { id: null, error: error.message };
    }
};

export const deletePayslip = async (id) => {
    try {
        await deleteDoc(doc(db, getPayslipsCol(), id));
        return { success: true, error: null };
    } catch (error) {
        console.error("Error deleting payslip:", error);
        return { success: false, error: error.message };
    }
};

export const getPayslip = async (id) => {
    try {
        const docSnap = await getDoc(doc(db, getPayslipsCol(), id));
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() };
        }
        return null;
    } catch (error) {
        console.error("Error fetching payslip:", error);
        return null;
    }
};

export const getPayslipsByMonth = async (month) => {
    try {
        const q = query(
            collection(db, getPayslipsCol()),
            where("payPeriod", "==", month)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Error fetching payslips by month:", error);
        return [];
    }
};

export const subscribeToPayslipsByMonth = (month, callback) => {
    const q = query(
        collection(db, getPayslipsCol()),
        where("payPeriod", "==", month)
    );
    return onSnapshot(q, (snapshot) => {
        const list = [];
        snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
        // Sort alphabetically by employee name
        list.sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));
        callback(list);
    }, (error) => {
        console.error("Error subscribing to payslips by month:", error);
        callback([]);
    });
};

export const getEmployeePayslipsInFY = async (employeeId, financialYear, employeeCode = '') => {
    try {
        let docs = [];
        if (employeeId) {
            const q = query(
                collection(db, getPayslipsCol()),
                where("employeeId", "==", employeeId)
            );
            const snapshot = await getDocs(q);
            docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
        if (!docs.length && employeeCode) {
            const q = query(
                collection(db, getPayslipsCol()),
                where("employeeCode", "==", employeeCode)
            );
            const snapshot = await getDocs(q);
            docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
        return docs.filter(p => !financialYear || p.financialYear === financialYear);
    } catch (error) {
        console.error("Error fetching employee payslips in FY:", error);
        return [];
    }
};

export const getLastPayslipForEmployee = async (employeeId) => {
    try {
        const q = query(
            collection(db, getPayslipsCol()),
            where("employeeId", "==", employeeId)
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;
        const payslips = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        payslips.sort((a, b) => (b.payPeriod || '').localeCompare(a.payPeriod || ''));
        return payslips[0];
    } catch (error) {
        console.error("Error fetching last payslip for employee:", error);
        return null;
    }
};

export const savePayslipFormat = async (formatData) => {
    try {
        const docRef = await addDoc(collection(db, getPayslipFormatsCol()), {
            ...formatData,
            createdAt: serverTimestamp()
        });
        return { id: docRef.id, error: null };
    } catch (error) {
        console.error("Error saving payslip format:", error);
        return { id: null, error: error.message };
    }
};

export const getPayslipFormats = async () => {
    try {
        const snapshot = await getDocs(collection(db, getPayslipFormatsCol()));
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Error fetching payslip formats:", error);
        return [];
    }
};

export const deletePayslipFormat = async (id) => {
    try {
        await deleteDoc(doc(db, getPayslipFormatsCol(), id));
        return { success: true, error: null };
    } catch (error) {
        console.error("Error deleting payslip format:", error);
        return { success: false, error: error.message };
    }
};

/* ==========================================================================
   CUSTOMER DIRECTORY MODULE COLLECTIONS & FUNCTIONS
   ========================================================================== */
const getCustomersCol = () => getCollectionName("customers");

export const addCustomer = async (data) => {
    try {
        const docRef = await addDoc(collection(db, getCustomersCol()), {
            ...data,
            companyName: (data.companyName || "").trim().toUpperCase(),
            contactPerson: (data.contactPerson || "").trim(),
            designation: (data.designation || "").trim(),
            contactNumber: (data.contactNumber || "").trim(),
            emailId: (data.emailId || "").trim(),
            reference: (data.reference || "").trim(),
            comments: (data.comments || "").trim(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return { id: docRef.id, error: null };
    } catch (error) {
        console.error("Error adding customer:", error);
        return { id: null, error: error.message };
    }
};

export const updateCustomer = async (id, data) => {
    try {
        const docRef = doc(db, getCustomersCol(), id);
        const updateData = { ...data, updatedAt: serverTimestamp() };
        if (updateData.companyName) {
            updateData.companyName = updateData.companyName.trim().toUpperCase();
        }
        await updateDoc(docRef, updateData);
        return { error: null };
    } catch (error) {
        console.error("Error updating customer:", error);
        return { error: error.message };
    }
};

export const deleteCustomer = async (id) => {
    try {
        await deleteDoc(doc(db, getCustomersCol(), id));
        return { error: null };
    } catch (error) {
        console.error("Error deleting customer:", error);
        return { error: error.message };
    }
};

export const subscribeToCustomers = (callback) => {
    const q = collection(db, getCustomersCol());
    return onSnapshot(q, (snapshot) => {
        const customers = [];
        snapshot.forEach((doc) => {
            customers.push({ id: doc.id, ...doc.data() });
        });
        // Sort alphabetically by companyName, then contactPerson
        customers.sort((a, b) => {
            const compA = (a.companyName || "").localeCompare(b.companyName || "");
            if (compA !== 0) return compA;
            return (a.contactPerson || "").localeCompare(b.contactPerson || "");
        });
        callback(customers);
    }, (error) => {
        console.error("Error subscribing to customers:", error);
        callback([]);
    });
};


