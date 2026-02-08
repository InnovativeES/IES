import * as Auth from './auth.js';
import * as UI from './ui.js';
import * as DB from './db.js';
import * as Charts from './charts.js';
import * as Monitoring from './monitoring.js';

// App State
let currentMembers = [];
let currentProjects = [];
let currentOrders = [];
let isTrashView = false;

// Helper: Get Dash Details
function calculateDashboardStats(orders, selectedMonth = 'all') {
    // Filter by month if not 'all'
    const filteredOrders = selectedMonth === 'all'
        ? orders
        : orders.filter(o => o.date && o.date.startsWith(selectedMonth));

    const active = filteredOrders.filter(o => !o.isTrash && (o.status === 'Pending' || o.status === 'In Progress'));
    const delivered = filteredOrders.filter(o => !o.isTrash && o.status === 'Delivered');

    const parseTotal = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return parseFloat(val.replace(/,/g, '')) || 0;
        return 0;
    };

    const revenue = active.reduce((sum, o) => sum + parseTotal(o.total), 0);
    const pendingCount = active.filter(o => o.status === 'Pending').length;

    // Check due this week
    const now = new Date();
    const oneWeekLater = new Date();
    oneWeekLater.setDate(now.getDate() + 7);

    const weeklyDue = active.filter(o => {
        if (!o.delDate && !o.date) return false;
        const d = new Date(o.delDate || o.date);
        return d >= now && d <= oneWeekLater;
    }).length;

    const totalCount = active.length + delivered.length;
    const efficiency = totalCount > 0 ? Math.round((delivered.length / totalCount) * 100) : 0;

    // Pipeline percentages
    const progressPct = totalCount > 0 ? Math.round((active.filter(o => o.status === 'In Progress').length / totalCount) * 100) : 0;
    const pendingPct = totalCount > 0 ? Math.round((pendingCount / totalCount) * 100) : 0;
    const deliveredPct = totalCount > 0 ? Math.round((delivered.length / totalCount) * 100) : 100;

    // --- NEW: Critical Alerts (Logic) ---
    const alerts = [];
    const overdue = active.filter(o => {
        if (!o.delDate && !o.date) return false;
        const d = new Date(o.delDate || o.date);
        return d < now; // Strictly past
    });
    if (overdue.length > 0) {
        alerts.push({ type: 'danger', message: `${overdue.length} Orders Overdue`, count: overdue.length });
    }
    // --- NEW: In Progress Orders ---
    const inProgressOrders = active
        .filter(o => o.status === 'In Progress')
        .sort((a, b) => new Date(a.delDate || a.date) - new Date(b.delDate || b.date));

    return {
        revenue,
        activeOrders: active.length,
        pendingCount,
        weeklyDue,
        efficiency,
        totalMembers: currentMembers.length,
        activeTasks: active.length,
        completedTasks: delivered.length,
        departments: 4,
        progressPct,
        pendingPct,
        deliveredPct,
        filteredOrders,
        inProgressOrders // Return this for the new column
    };
}

// Helper: Refresh Dashboard UI
function refreshDashboard() {
    const overviewView = document.getElementById('view-overview');
    if (overviewView && !overviewView.classList.contains('hidden')) {
        const monthFilter = document.getElementById('dashboard-month-filter');
        const selectedMonth = monthFilter ? monthFilter.value : 'all';

        const stats = calculateDashboardStats(currentOrders, selectedMonth);
        UI.updateStats(stats);
        UI.renderDashboardPendingOrders(stats.filteredOrders);
        UI.renderDashboardRecentActivity(stats.filteredOrders);
        if (UI.renderInProgressOrders) {
            UI.renderInProgressOrders(stats.inProgressOrders);
        }
    }
}

// Project Kanban Rendering
function renderKanban(projects) {
    const columns = {
        'Planning': document.getElementById('cards-planning'),
        'In Progress': document.getElementById('cards-inprogress'),
        'Review': document.getElementById('cards-review'),
        'Completed': document.getElementById('cards-completed')
    };

    const counts = {
        'Planning': document.getElementById('count-planning'),
        'In Progress': document.getElementById('count-inprogress'),
        'Review': document.getElementById('count-review'),
        'Completed': document.getElementById('count-completed')
    };

    // Clear all columns
    Object.values(columns).forEach(col => { if (col) col.innerHTML = ''; });
    Object.values(counts).forEach(cnt => { if (cnt) cnt.textContent = '0'; });

    // Group projects by status
    const grouped = { 'Planning': [], 'In Progress': [], 'Review': [], 'Completed': [] };
    projects.forEach(p => {
        const status = p.status || 'Planning';
        if (grouped[status]) grouped[status].push(p);
    });

    // Render each column
    Object.keys(grouped).forEach(status => {
        const col = columns[status];
        const cnt = counts[status];
        if (!col) return;

        cnt.textContent = grouped[status].length;

        if (grouped[status].length === 0) {
            col.innerHTML = '<p style="color: #94a3b8; font-size: 0.875rem; text-align: center; padding: 1rem;">No projects</p>';
            return;
        }

        grouped[status].forEach(project => {
            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.innerHTML = `
                <div class="kanban-card-title">${project.name || project.title || 'Untitled'}</div>
                <div class="kanban-card-meta">
                    ${project.client ? `<span>${project.client}</span>` : ''}
                    ${project.dueDate ? `<span>Due: ${project.dueDate}</span>` : ''}
                </div>
                <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
                    ${status !== 'Completed' ? `
                        <button class="btn btn-secondary" style="padding: 0.375rem 0.75rem; font-size: 0.75rem;"
                                onclick="window.adminApp.moveProject('${project.id}', '${getNextStatus(status)}')">
                            Move →
                        </button>
                    ` : ''}
                    <button class="btn btn-ghost" style="padding: 0.375rem 0.75rem; font-size: 0.75rem; color: #ef4444;"
                            onclick="window.adminApp.deleteProject('${project.id}')">
                        Delete
                    </button>
                </div>
            `;
            col.appendChild(card);
        });
    });
}

function getNextStatus(current) {
    const flow = ['Planning', 'In Progress', 'Review', 'Completed'];
    const idx = flow.indexOf(current);
    return idx < flow.length - 1 ? flow[idx + 1] : current;
}

// Global App Object
window.adminApp = {
    switchView: (viewName) => {
        UI.switchView(viewName);
    },

    // Definitions
    rolesList: [
        "Director", "Managing Director", "General Manager",
        "Section Head", "Manager", "Assistant Manager",
        "Senior Engineer", "Design Engineer", "Quality Engineer", "Production Engineer",
        "Supervisor", "Foreman", "Technician", "Operator",
        "CNC Operator", "VMC Operator", "Welder", "Fitter", "Electrician",
        "Accountant", "HR Manager", "HR Executive", "Sales Executive",
        "Office Admin", "Store Keeper", "Helper"
    ],
    selectedRoles: new Set(),

    // Multi-Select Helpers
    toggleRoleDropdown: () => {
        const options = document.getElementById('role-dropdown-options');
        if (options) options.classList.toggle('hidden');
    },

    populateRoleOptions: () => {
        const container = document.getElementById('role-dropdown-options');
        if (!container) return;

        container.innerHTML = window.adminApp.rolesList.map(role => `
            <div class="select-option ${window.adminApp.selectedRoles.has(role) ? 'selected' : ''}" 
                 onclick="window.adminApp.selectRole('${role}')">
                ${role}
                ${window.adminApp.selectedRoles.has(role) ? '<svg class="w-4 h-4 ml-auto text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : ''}
            </div>
        `).join('');
    },

    selectRole: (role) => {
        if (window.adminApp.selectedRoles.has(role)) {
            window.adminApp.selectedRoles.delete(role);
        } else {
            window.adminApp.selectedRoles.add(role);
        }
        window.adminApp.updateRoleDisplay();
        window.adminApp.populateRoleOptions(); // Re-render to update classes
    },

    updateRoleDisplay: () => {
        const display = document.getElementById('role-display-text');
        const input = document.getElementById('roles-input');
        if (!display || !input) return;

        const roles = Array.from(window.adminApp.selectedRoles);
        input.value = JSON.stringify(roles);

        if (roles.length === 0) {
            display.innerHTML = '<span class="text-slate-400">Select Roles...</span>';
        } else {
            display.innerHTML = roles.map(r => `
                <span class="role-tag">${r} 
                    <span onclick="event.stopPropagation(); window.adminApp.selectRole('${r}')" class="ml-1 hover:text-red-500 cursor-pointer">&times;</span>
                </span>
            `).join('');
        }
    },

    // Department Multi-Select - Matching Org Tree + Management
    departmentsList: ["Management", "Fabrication", "CNC & VMC", "SPM", "HR"],
    selectedDepts: new Set(),

    toggleDeptDropdown: () => {
        const options = document.getElementById('dept-dropdown-options');
        if (options) options.classList.toggle('hidden');
    },

    populateDeptOptions: () => {
        const container = document.getElementById('dept-dropdown-options');
        if (!container) return;

        container.innerHTML = window.adminApp.departmentsList.map(dept => `
            <div class="select-option ${window.adminApp.selectedDepts.has(dept) ? 'selected' : ''}" 
                 onclick="window.adminApp.selectDept('${dept}')">
                ${dept}
                ${window.adminApp.selectedDepts.has(dept) ? '<svg class="w-4 h-4 ml-auto text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : ''}
            </div>
        `).join('');
    },

    selectDept: (dept) => {
        if (window.adminApp.selectedDepts.has(dept)) {
            window.adminApp.selectedDepts.delete(dept);
        } else {
            window.adminApp.selectedDepts.add(dept);
        }
        window.adminApp.updateDeptDisplay();
        window.adminApp.populateDeptOptions();
    },

    updateDeptDisplay: () => {
        const display = document.getElementById('dept-display-text');
        const input = document.getElementById('departments-input');
        if (!display || !input) return;

        const depts = Array.from(window.adminApp.selectedDepts);
        input.value = JSON.stringify(depts);

        if (depts.length === 0) {
            display.innerHTML = '<span class="text-slate-400">Select Departments...</span>';
        } else {
            display.innerHTML = depts.map(d => `
                <span class="role-tag" style="background: var(--blue-50); color: var(--blue-700);">${d} 
                    <span onclick="event.stopPropagation(); window.adminApp.selectDept('${d}')" class="ml-1 hover:text-red-500 cursor-pointer">&times;</span>
                </span>
            `).join('');
        }
    },

    populateManagers: (selectedId = null) => {
        const select = document.getElementById('manager-select');
        if (!select) return;

        // Filter out current member if editing (prevent self-reporting)
        const currentMemberId = document.getElementById('memberId-input')?.value;
        const candidates = currentMembers.filter(m => m.id !== currentMemberId);

        select.innerHTML = '<option value="">Select Manager</option>' +
            candidates.map(m => `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${m.name} (${m.designation || 'Member'})</option>`).join('');
    },

    openAddMemberModal: (memberId = null) => {
        const modal = document.getElementById('add-member-modal');
        if (!modal) return;

        // Reset form
        const form = document.getElementById('add-member-form');
        if (form) form.reset();

        // Reset hidden ID field
        const hiddenId = document.getElementById('memberId-input');
        if (hiddenId) hiddenId.value = '';

        // Update modal title
        const title = modal.querySelector('.modal-title');
        if (title) title.textContent = memberId ? 'Edit Team Member' : 'Add Team Member';

        // Initialize Multi-Select for Roles and Departments
        window.adminApp.selectedRoles.clear();
        window.adminApp.selectedDepts.clear();
        if (!memberId) {
            window.adminApp.updateRoleDisplay();
            window.adminApp.updateDeptDisplay();
        }

        window.adminApp.populateRoleOptions();
        window.adminApp.populateDeptOptions();
        window.adminApp.populateManagers();

        window.adminApp.openModal('add-member-modal');
    },

    editMember: (memberId) => {
        const member = currentMembers.find(m => m.id === memberId);
        if (!member) return;

        // Open modal first
        window.adminApp.openAddMemberModal(memberId);

        // Set hidden ID
        const hiddenId = document.getElementById('memberId-input');
        if (hiddenId) hiddenId.value = memberId;

        // Populate form fields
        const form = document.getElementById('add-member-form');
        if (!form) return;

        const setField = (name, value) => {
            const el = form.querySelector(`[name="${name}"]`);
            if (el) el.value = value || '';
        };

        setField('name', member.name);
        setField('employeeId', member.employeeId);
        setField('email', member.email);
        setField('phone', member.phone);
        setField('section', member.section || member.department);
        setField('status', member.status);
        setField('joiningDate', member.joiningDate);

        // Populate Roles
        window.adminApp.selectedRoles.clear();
        if (member.orgRoles && Array.isArray(member.orgRoles)) {
            member.orgRoles.forEach(r => window.adminApp.selectedRoles.add(r));
        } else if (member.role || member.designation) {
            window.adminApp.selectedRoles.add(member.role || member.designation);
        }
        window.adminApp.updateRoleDisplay();
        window.adminApp.populateRoleOptions();

        // Populate Departments
        window.adminApp.selectedDepts.clear();
        if (member.departments && Array.isArray(member.departments)) {
            member.departments.forEach(d => window.adminApp.selectedDepts.add(d));
        } else if (member.department) {
            window.adminApp.selectedDepts.add(member.department);
        }
        window.adminApp.updateDeptDisplay();
        window.adminApp.populateDeptOptions();

        // Populate Manager
        window.adminApp.populateManagers(member.reportingManagerId);
    },

    deleteMember: (memberId, memberName) => {
        window.adminApp.showConfirmModal(
            "Delete Member?",
            `Are you sure you want to delete "${memberName}"? This action cannot be undone.`,
            async () => {
                const result = await DB.deleteMember(memberId);
                if (result.error) {
                    alert('Error deleting member: ' + result.error);
                }
            }
        );
    },

    submitMemberForm: async () => {
        const form = document.getElementById('add-member-form');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const formData = new FormData(form);
        const memberId = formData.get('memberId');

        const memberData = {
            name: formData.get('name'),
            employeeId: formData.get('employeeId') || '',
            email: formData.get('email') || '',
            phone: formData.get('phone') || '',

            // Roles Handling
            orgRoles: Array.from(window.adminApp.selectedRoles),
            role: Array.from(window.adminApp.selectedRoles)[0] || '', // Primary Role
            designation: Array.from(window.adminApp.selectedRoles)[0] || '', // Backward Compat

            // Departments Handling
            departments: Array.from(window.adminApp.selectedDepts),
            section: Array.from(window.adminApp.selectedDepts)[0] || '', // Primary Dept
            department: Array.from(window.adminApp.selectedDepts)[0] || '', // Backward Compat

            status: formData.get('status') || 'Active',
            joiningDate: formData.get('joiningDate') || '',
            reportingManagerId: formData.get('reportingManager') || null
        };

        let result;
        if (memberId) {
            result = await DB.updateMember(memberId, memberData);
        } else {
            result = await DB.addMember(memberData);
        }

        if (result.error) {
            alert('Error: ' + result.error);
        } else {
            window.adminApp.closeModal('add-member-modal');
        }
    },

    openAddProjectModal: () => {
        const modal = document.getElementById('add-project-modal');
        if (!modal) return;

        // Reset form
        const form = document.getElementById('add-project-form');
        if (form) form.reset();

        modal.classList.add('active');
    },

    submitProjectForm: async () => {
        const form = document.getElementById('add-project-form');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const formData = new FormData(form);
        const projectData = {
            name: formData.get('name'),
            client: formData.get('client') || '',
            description: formData.get('description') || '',
            dueDate: formData.get('dueDate') || null,
            priority: formData.get('priority') || 'Medium',
            status: 'Planning'
        };

        const result = await DB.addProject(projectData);
        if (result.error) {
            alert('Error: ' + result.error);
        } else {
            window.adminApp.closeModal('add-project-modal');
        }
    },

    moveProject: async (projectId, newStatus) => {
        const result = await DB.updateProjectStatus(projectId, newStatus);
        if (result.error) {
            alert('Error moving project: ' + result.error);
        }
    },

    deleteProject: (projectId) => {
        window.adminApp.showConfirmModal(
            "Delete Project?",
            "Permanently delete this project? This action cannot be undone.",
            async () => {
                try {
                    const result = await DB.deleteProject(projectId);
                    if (result.error) {
                        alert('Error deleting project: ' + result.error);
                    }
                } catch (e) {
                    console.error('Delete project failed:', e);
                    alert('Failed to delete project. Please check your connection.');
                }
            }
        );
    },

    openAddOrderModal: () => {
        window.adminApp.openModal('add-order-modal');
    },

    prepareAddOrder: () => {
        const form = document.getElementById('add-order-form');
        if (form) form.reset();
        const hidden = document.getElementById('orderId-input');
        if (hidden) hidden.value = '';

        // Set default date to today
        const dateInput = form.querySelector('[name="date"]');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }

        // Setup auto-calculation for Total
        const qtyInput = document.getElementById('order-qty');
        const valueInput = document.getElementById('order-value');
        const totalInput = document.getElementById('order-total');

        const calculateTotal = () => {
            const qty = parseFloat(qtyInput?.value) || 0;
            const value = parseFloat(valueInput?.value) || 0;
            const total = qty * value;
            if (totalInput) {
                totalInput.value = total > 0 ? total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
            }
        };

        if (qtyInput) qtyInput.addEventListener('input', calculateTotal);
        if (valueInput) valueInput.addEventListener('input', calculateTotal);

        window.adminApp.openAddOrderModal();
    },

    // New: Delivery Modal Logic
    openAddDeliveryModal: () => {
        const form = document.getElementById('add-delivery-form');
        if (form) form.reset();
        const hidden = document.getElementById('delivery-orderId-input');
        if (hidden) hidden.value = '';

        const dateInput = form.querySelector('[name="date"]');
        if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

        window.adminApp.openModal('add-delivery-modal');
    },

    submitDeliveryForm: async () => {
        const form = document.getElementById('add-delivery-form');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const formData = new FormData(form);
        const orderId = formData.get('orderId');

        // Construct object compatible with DB.addOrder
        const orderData = {
            date: formData.get('date'),
            customer: formData.get('customer'),
            itemCode: formData.get('itemCode') || '',
            description: formData.get('description') || '',
            qty: parseFloat(formData.get('qty')) || 0,
            total: parseFloat(formData.get('total')) || 0, // Manual Delivery Value
            department: formData.get('department') || '',
            labourCost: parseFloat(formData.get('labourCost')) || 0,
            manpower: parseFloat(formData.get('manpower')) || 0,

            // Delivery Specifics
            deliveryDateActual: formData.get('date'), // Same as entry date for direct delivery
            deliveryQty: parseFloat(formData.get('qty')) || 0,
            dcNo: formData.get('dcNo') || '',
            billNo: formData.get('billNo') || '',
            status: 'Delivered', // Force status
            entryType: 'delivery_report', // Flag to distinguish from Internal Orders

            // Defaults for unused fields
            saleValueEa: 0,
            prodValueEa: 0,
            priority: 'Medium',
            drgAvail: 'n',
            rawAvail: 'n',
            finishAvail: 'n'
        };

        let result;
        if (orderId) {
            result = await DB.updateOrder(orderId, orderData);
        } else {
            result = await DB.addOrder(orderData);
        }

        if (result.error) {
            alert('Error: ' + result.error);
        } else {
            window.adminApp.closeModal('add-delivery-modal');
        }
    },

    // Modal Helpers
    openModal: (id) => {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('hidden');
            // Small delay to allow display:block to apply before adding active class for transition
            setTimeout(() => modal.classList.add('active'), 10);
        }
    },

    closeModal: (id) => {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('active');
            // Wait for transition to finish before hiding
            setTimeout(() => modal.classList.add('hidden'), 300);
        }
    },

    // Custom Confirm Modal
    showConfirmModal: (title, message, onConfirm) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const yesBtn = document.getElementById('confirm-yes-btn');

        if (!modal || !titleEl || !msgEl || !yesBtn) {
            if (confirm(message)) onConfirm();
            return;
        }

        titleEl.textContent = title;
        msgEl.textContent = message;

        // Clone button to remove old event listeners
        const newBtn = yesBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newBtn, yesBtn);

        newBtn.onclick = () => {
            window.adminApp.closeModal('confirm-modal');
            onConfirm();
        };

        window.adminApp.openModal('confirm-modal');
    },

    editOrder: (id) => {
        const order = currentOrders.find(o => o.id === id);
        if (!order) return;

        if (order.entryType === 'delivery_report') {
            // Use Delivery Modal for direct entries
            window.adminApp.openAddDeliveryModal();

            // Populate delivery info
            setTimeout(() => {
                const form = document.getElementById('add-delivery-form');
                if (form) {
                    form.querySelector('[name="orderId"]').value = order.id;
                    form.querySelector('[name="date"]').value = order.deliveryDateActual;
                    form.querySelector('[name="customer"]').value = order.customer;
                    form.querySelector('[name="itemCode"]').value = order.itemCode;
                    form.querySelector('[name="description"]').value = order.description;
                    form.querySelector('[name="department"]').value = order.department;
                    form.querySelector('[name="dcNo"]').value = order.dcNo;
                    form.querySelector('[name="qty"]').value = order.deliveryQty;
                    form.querySelector('[name="total"]').value = order.total || ''; // Delivery Value
                    form.querySelector('[name="labourCost"]').value = order.labourCost;
                    form.querySelector('[name="billNo"]').value = order.billNo;
                    form.querySelector('[name="manpower"]').value = order.manpower || '';
                }
            }, 100);
        } else {
            // Use Standard Modal
            Monitoring.populateForm(order);
        }
    },

    toggleDeliveryTrash: () => {
        const btn = document.getElementById('delivery-trash-btn');
        if (!btn) return;

        // Toggle global trash state (reusing existing state for simplicity or adding specific one)
        // For now, let's use a specific flag for delivery report trash if needed, 
        // OR reuse isTrashView if we want a global toggle. 
        // User requested "Trash box" in Delivery Report specifically.

        // Let's implement a specific toggle for Delivery Report visualization
        if (btn.classList.contains('btn-danger')) {
            // Turn OFF Trash
            btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> Trash';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-secondary');

            // Hide Empty Trash Btn
            const emptyBtn = document.getElementById('delivery-empty-trash-btn');
            if (emptyBtn) emptyBtn.classList.add('hidden');

            Monitoring.setDeliveryTrashMode(false);
        } else {
            // Turn ON Trash
            btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg> Back to Report';
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-danger');

            // Show Empty Trash Btn
            const emptyBtn = document.getElementById('delivery-empty-trash-btn');
            if (emptyBtn) emptyBtn.classList.remove('hidden');

            Monitoring.setDeliveryTrashMode(true);
        }

        // Re-render
        const weekPicker = document.getElementById('delivery-week-picker');
        if (weekPicker && weekPicker.value) {
            Monitoring.renderDeliveryReport(weekPicker.value);
        }
    },

    emptyTrash: (type) => {
        window.adminApp.showConfirmModal(
            "Empty Trash?",
            `Are you sure you want to permanently delete ALL ${type === 'delivery' ? 'delivery report' : 'internal order'} items in the trash? This cannot be undone.`,
            async () => {
                try {
                    const result = await DB.emptyTrash(type);
                    if (result.error) {
                        alert("Error emptying trash: " + result.error);
                    } else {
                        // Refresh views
                        if (type === 'delivery') {
                            const weekPicker = document.getElementById('delivery-week-picker');
                            if (weekPicker && weekPicker.value) {
                                Monitoring.renderDeliveryReport(weekPicker.value);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Empty trash failed:", e);
                    alert("Failed to empty trash.");
                }
            }
        );
    },

    softDeleteOrder: (id) => {
        window.adminApp.showConfirmModal(
            "Move to Trash?",
            "Are you sure you want to move this order to trash?",
            async () => {
                try {
                    console.log("Attempting soft delete for:", id);
                    const result = await DB.softDeleteOrder(id);
                    if (result.error) {
                        alert("Error moving order to trash: " + result.error);
                    } else {
                        console.log("Soft delete successful");
                    }
                } catch (e) {
                    console.error("Soft delete failed:", e);
                    alert("Failed to move order to trash. Please try again.");
                }
            }
        );
    },

    restoreOrder: (id) => {
        DB.restoreOrder(id);
    },

    changeOrderStatus: async (id, newStatus) => {
        try {
            await DB.updateOrder(id, { status: newStatus });
            // Update the dropdown styling immediately
            const select = document.querySelector(`select[data-order-id="${id}"]`);
            if (select) {
                select.className = 'status-select ' +
                    (newStatus === 'Delivered' ? 'status-delivered' :
                        newStatus === 'In Progress' ? 'status-inprogress' : 'status-pending');
            }
        } catch (e) {
            console.error('Failed to update status:', e);
            alert('Failed to update status');
        }
    },

    permanentDeleteOrder: (id) => {
        window.adminApp.showConfirmModal(
            "Delete Permanently?",
            "This action cannot be undone. The order will be permanently removed.",
            async () => {
                try {
                    const result = await DB.permanentDeleteOrder(id);
                    if (result.error) {
                        alert("Error deleting order: " + result.error);
                    }
                } catch (e) {
                    console.error("Permanent delete failed:", e);
                    alert("Failed to delete order permanently. Please try again.");
                }
            }
        );
    },

    toggleTrashMode: () => {
        isTrashView = !isTrashView;
        Monitoring.setTrashMode(isTrashView);

        const btn = document.getElementById('trash-toggle-btn');
        if (btn) {
            if (isTrashView) {
                btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg> Back to Orders';
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-danger');
            } else {
                btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> Trash';
                btn.classList.add('btn-secondary');
                btn.classList.remove('btn-danger');
            }
        }

        // Re-subscribe with correct filter
        if (window.unsubscribeOrders) window.unsubscribeOrders();

        window.unsubscribeOrders = DB.subscribeToOrders((orders) => {
            currentOrders = orders;
            if (!document.getElementById('view-monitoring').classList.contains('hidden')) {
                Monitoring.renderTable(orders);
            }
        }, isTrashView);
    },

    switchTeamTab: (tab) => {
        const memberView = document.getElementById('subview-members');
        const hierView = document.getElementById('subview-hierarchy');
        const memberBtn = document.getElementById('tab-members');
        const hierBtn = document.getElementById('tab-hierarchy');

        if (tab === 'members') {
            if (memberView) memberView.classList.remove('hidden');
            if (hierView) hierView.classList.add('hidden');
            if (memberBtn) memberBtn.classList.add('active');
            if (hierBtn) hierBtn.classList.remove('active');
        } else {
            if (memberView) memberView.classList.add('hidden');
            if (hierView) hierView.classList.remove('hidden');
            if (memberBtn) memberBtn.classList.remove('active');
            if (hierBtn) hierBtn.classList.add('active');

            // Trigger render
            Charts.renderHierarchy(currentMembers || [], 'hierarchy-container');
        }
    },

    renderTeamView: () => {
        Charts.renderHierarchy(currentMembers || [], 'hierarchy-container');
    },

    renderMonitoring: () => {
        if (currentOrders && currentOrders.length > 0) {
            Monitoring.renderTable(currentOrders);
        }
    },

    setPageSize: (size) => {
        Monitoring.setPageSize(size);
    },

    sort: (key) => {
        Monitoring.sort(key);
    },

    exportToPDF: () => {
        Monitoring.exportToPDF(currentOrders);
    },

    // New: Delivery Report Helpers
    getCurrentOrders: () => {
        return currentOrders;
    },

    printDeliveryReport: () => {
        window.print();
    },

    saveManpower: (date, value) => {
        const numericVal = parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
        DB.saveDailyStat(date, 'manpower', numericVal).then(res => {
            if (res.error) console.error(res.error);
            else console.log('Manpower saved for', date);
        });
    }
};

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {

    // Setup UI Listeners
    UI.setupNavigation();

    // Dashboard Filter Listener
    const dashMonthFilter = document.getElementById('dashboard-month-filter');
    if (dashMonthFilter) {
        dashMonthFilter.addEventListener('change', refreshDashboard);
    }

    // Load Members
    DB.subscribeToMembers((members) => {
        currentMembers = members;
        const memberView = document.getElementById('subview-members');
        if (memberView && !memberView.classList.contains('hidden')) {
            UI.renderMemberList(members);
        }
        refreshDashboard();
    });

    // Load Projects for Kanban
    DB.subscribeToProjects((projects) => {
        currentProjects = projects;
        const view = document.getElementById('view-project_management');
        if (view && !view.classList.contains('hidden')) {
            renderKanban(projects);
        }
    });

    // Load Orders
    window.unsubscribeOrders = DB.subscribeToOrders((orders) => {
        // Mock Data Injection if empty (for Demo/Dev)
        if (!orders || orders.length < 5) {
            console.log("Injecting Mock Orders for Demo...");
            const mockOrders = Array.from({ length: 15 }).map((_, i) => ({
                id: `mock-${i}`,
                internalOrderNo: `2026-02-${500 + i}`,
                customer: ['Baliga', 'Bray Controls', 'Flowserve', 'L&T'][Math.floor(Math.random() * 4)],
                description: `Machining of ${['Valve Body', 'Flange', 'Shaft', 'Housing'][Math.floor(Math.random() * 4)]}`,
                date: new Date(Date.now() - Math.floor(Math.random() * 86400000 * 3)).toISOString().split('T')[0], // Last 3 days
                delDate: new Date(Date.now() + Math.floor(Math.random() * 86400000 * 10)).toISOString().split('T')[0],
                status: Math.random() > 0.6 ? 'In Progress' : 'Pending',
                createdAt: { seconds: Date.now() / 1000 - (i * 3600) } // Staggered times
            }));
            currentOrders = [...orders, ...mockOrders];
        } else {
            currentOrders = orders;
        }

        const monitoringView = document.getElementById('view-monitoring');
        const deliveryView = document.getElementById('view-delivery_report');

        if (monitoringView && !monitoringView.classList.contains('hidden')) {
            Monitoring.renderTable(currentOrders);
        }

        if (deliveryView && !deliveryView.classList.contains('hidden')) {
            const weekPicker = document.getElementById('delivery-week-picker');
            if (weekPicker && weekPicker.value) {
                Monitoring.renderDeliveryReport(weekPicker.value);
            }
        }
        refreshDashboard();
    }, false);

    // Filter Listeners
    // Filter Listeners
    const monthFromInput = document.getElementById('order-month-from');
    const monthToInput = document.getElementById('order-month-to');
    const searchInput = document.getElementById('order-search-filter');

    if (monthFromInput && monthToInput) {
        // Initialize from Persistence (via Monitoring module state)
        // If Monitoring.getFilters().monthFrom is '' (show all), input should be ''
        const currentFilters = Monitoring.getFilters();
        monthFromInput.value = currentFilters.monthFrom || '';
        monthToInput.value = currentFilters.monthTo || '';

        const updateFilters = () => {
            Monitoring.setFilters(monthFromInput.value, monthToInput.value, undefined);
            Monitoring.renderTable(currentOrders);
        };

        monthFromInput.addEventListener('change', updateFilters);
        monthToInput.addEventListener('change', updateFilters);
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            Monitoring.setFilters(undefined, undefined, e.target.value);
            Monitoring.renderTable(currentOrders);
        });
    }

    // Form Submissions
    const orderForm = document.getElementById('add-order-form');
    if (orderForm) {
        orderForm.addEventListener('submit', (e) => {
            e.preventDefault();
            Monitoring.handleAddOrder();
        });
    }

    const memberForm = document.getElementById('add-member-form');
    if (memberForm) {
        memberForm.addEventListener('submit', (e) => {
            e.preventDefault();
            window.adminApp.submitMemberForm();
        });
    }

    const projectForm = document.getElementById('add-project-form');
    if (projectForm) {
        projectForm.addEventListener('submit', (e) => {
            e.preventDefault();
            window.adminApp.submitProjectForm();
        });
    }

    // Login Form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email-address').value;
            const password = document.getElementById('password').value;

            try {
                const result = await Auth.login(email, password);
                if (result.error) {
                    UI.showLoginError(result.error);
                } else {
                    // Force View Switch
                    const authDiv = document.getElementById('auth-container');
                    const dashDiv = document.getElementById('dashboard-container');
                    const emailSpan = document.getElementById('user-email-display');

                    if (authDiv) authDiv.style.display = 'none';
                    if (dashDiv) {
                        dashDiv.style.display = 'flex';
                        dashDiv.classList.remove('hidden');
                    }
                    if (emailSpan && result.user) emailSpan.textContent = result.user.email;

                    // Update stats
                    UI.updateStats({
                        totalEmployees: currentMembers.length,
                        activeTasks: 12,
                        completedTasks: 84,
                        departments: 4
                    });
                }
            } catch (err) {
                console.error(err);
                UI.showLoginError(err.message);
            }
        });
    }

    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await Auth.logout();
        });
    }

    // Navigation click handler for view renders
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            const view = link.dataset.view;

            setTimeout(() => {
                if (view === 'team_org') {
                    UI.renderMemberList(currentMembers);
                } else if (view === 'project_management') {
                    renderKanban(currentProjects);
                } else if (view === 'overview') {
                    const stats = calculateDashboardStats(currentOrders);
                    UI.updateStats(stats);
                    UI.renderDashboardPendingOrders(currentOrders);
                    UI.renderDashboardRecentActivity(currentOrders);
                } else if (view === 'monitoring') {
                    Monitoring.renderTable(currentOrders);
                } else if (view === 'delivery_report') {
                    // Initialize with current week if not set
                    const weekPicker = document.getElementById('delivery-week-picker');
                    if (weekPicker && !weekPicker.value) {
                        const today = new Date();

                        // Get ISO week number
                        const date = new Date(today.getTime());
                        date.setHours(0, 0, 0, 0);
                        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
                        const week1 = new Date(date.getFullYear(), 0, 4);
                        const weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);

                        const year = date.getFullYear();
                        weekPicker.value = `${year}-W${weekNum.toString().padStart(2, '0')}`;
                        Monitoring.renderDeliveryReport(weekPicker.value);
                    } else if (weekPicker && weekPicker.value) {
                        // Re-render if already set (e.g. data updated)
                        Monitoring.renderDeliveryReport(weekPicker.value);
                    }
                }
            }, 50);
        });
    });

    // Delivery Report Date Picker
    const weekPicker = document.getElementById('delivery-week-picker');
    if (weekPicker) {
        weekPicker.addEventListener('change', (e) => {
            Monitoring.renderDeliveryReport(e.target.value);
        });
    }

    // Auth State Observer
    Auth.subscribeToAuthChanges((user) => {
        const authDiv = document.getElementById('auth-container');
        const dashDiv = document.getElementById('dashboard-container');
        const emailSpan = document.getElementById('user-email-display');

        if (user) {
            if (authDiv) authDiv.style.display = 'none';
            if (dashDiv) {
                dashDiv.style.display = 'flex';
                dashDiv.classList.remove('hidden');
            }
            if (emailSpan) emailSpan.textContent = user.email;

            // Update stats
            const stats = calculateDashboardStats(currentOrders);
            UI.updateStats(stats);
            UI.renderDashboardPendingOrders(currentOrders);
            UI.renderDashboardRecentActivity(currentOrders);
        } else {
            if (authDiv) authDiv.style.display = 'flex';
            if (dashDiv) dashDiv.style.display = 'none';
        }
    });
});
