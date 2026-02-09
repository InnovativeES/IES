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
        "Business Development Manager", "Section Head", "Manager", "Assistant Manager",
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
    },

    // ============================================
    // PENDING ASSIGNMENT FUNCTIONS
    // ============================================

    renderPendingAssignment: () => {
        const view = document.getElementById('view-pending_assignment');
        if (!view || view.classList.contains('hidden')) return;

        const tbody = document.getElementById('pending-assignment-body');
        const countBadge = document.getElementById('pending-assignment-count');
        if (!tbody) return;

        // Get filters
        const deptFilter = document.getElementById('pending-filter-department')?.value || '';
        const assignedFilter = document.getElementById('pending-filter-assigned')?.value || '';
        const priorityFilter = document.getElementById('pending-filter-priority')?.value || '';

        // Filter pending orders
        let pendingOrders = currentOrders.filter(o =>
            o.status === 'Pending' && !o.deleted
        );

        // Apply department filter
        if (deptFilter) {
            pendingOrders = pendingOrders.filter(o => o.department === deptFilter);
        }

        // Apply assigned filter
        if (assignedFilter === 'assigned') {
            pendingOrders = pendingOrders.filter(o => o.assignedTo && o.assignedTo.length > 0);
        } else if (assignedFilter === 'unassigned') {
            pendingOrders = pendingOrders.filter(o => !o.assignedTo || o.assignedTo.length === 0);
        }

        // Apply priority filter
        if (priorityFilter) {
            pendingOrders = pendingOrders.filter(o => (o.priority || 'normal') === priorityFilter);
        }

        // Get sort option
        const sortBy = document.getElementById('pending-sort-by')?.value || 'priority';

        // Sort based on selection
        pendingOrders.sort((a, b) => {
            if (sortBy === 'priority') {
                // Urgent first, then by due date
                const priorityA = a.priority === 'urgent' ? 0 : 1;
                const priorityB = b.priority === 'urgent' ? 0 : 1;
                if (priorityA !== priorityB) return priorityA - priorityB;
                // Then by due date
                const dateA = new Date(a.estimatedCompletion || '2099-12-31');
                const dateB = new Date(b.estimatedCompletion || '2099-12-31');
                return dateA - dateB;
            } else if (sortBy === 'dueDate') {
                const dateA = new Date(a.estimatedCompletion || '2099-12-31');
                const dateB = new Date(b.estimatedCompletion || '2099-12-31');
                return dateA - dateB;
            } else if (sortBy === 'orderId') {
                const idA = a.internalOrderNo || a.id || '';
                const idB = b.internalOrderNo || b.id || '';
                return idA.localeCompare(idB);
            }
            return 0;
        });

        // Update count badge
        if (countBadge) {
            countBadge.textContent = `${pendingOrders.length} orders`;
        }

        // Build table rows
        if (pendingOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-400">No pending orders found</td></tr>';
            return;
        }

        // Build member dropdown options
        const memberOptions = currentMembers.map(m =>
            `<option value="${m.id}">${m.name}</option>`
        ).join('');

        tbody.innerHTML = pendingOrders.map(order => {
            const isUrgent = order.priority === 'urgent';
            const assignedList = (order.assignedTo || []).map(id => {
                return {
                    id: id,
                    name: currentMembers.find(m => m.id === id)?.name || id
                };
            });

            // Format due date for input (YYYY-MM-DD)
            const dueDateValue = order.estimatedCompletion
                ? new Date(order.estimatedCompletion).toISOString().split('T')[0]
                : '';

            const rowClass = isUrgent ? 'pending-row-urgent' : 'pending-row-normal';

            return `
                <tr class="pending-assignment-row ${rowClass}">
                    <td style="text-align: center; vertical-align: middle;">
                        <button onclick="window.adminApp.togglePriority('${order.id}')" 
                                class="priority-toggle ${isUrgent ? 'is-urgent' : ''}"
                                title="${isUrgent ? 'Mark as Normal' : 'Mark as Urgent'}">
                            ${isUrgent ? '🔥' : '⚪'}
                        </button>
                    </td>
                    <td><span class="order-id-badge">${order.internalOrderNo || order.id}</span></td>
                    <td style="font-size: 0.75rem; color: var(--slate-600);">${order.description || '-'}</td>
                    <td style="font-size: 0.75rem; font-weight: 500; color: var(--slate-700);">${order.customer || '-'}</td>
                    <td>
                        <input type="date" class="table-form-input" 
                               value="${dueDateValue}"
                               onchange="window.adminApp.updateDueDate('${order.id}', this.value)"
                               title="Click to set/change due date">
                    </td>
                    <td>
                        <select class="table-form-select" 
                                onchange="window.adminApp.updateAssignment('${order.id}', this.value)"
                                id="assign-${order.id}">
                            <option value="">-- Assign Employee --</option>
                            ${memberOptions}
                        </select>
                        <div class="assign-badge-container">
                            ${assignedList.map(m => `
                                <span class="assign-badge">
                                    👤 ${m.name}
                                    <button class="remove-assign-btn" 
                                            onclick="window.adminApp.removeAssignment('${order.id}', '${m.id}')"
                                            title="Remove Assignment">×</button>
                                </span>
                            `).join('')}
                        </div>
                    </td>
                    <td>
                        <input type="text" class="table-form-input"
                               placeholder="Add remarks..."
                               value="${order.remarks || ''}"
                               onblur="window.adminApp.saveRemarks('${order.id}', this.value)"
                               id="remarks-${order.id}">
                    </td>
                </tr>
            `;
        }).join('');

        // Set current assignments in dropdowns
        pendingOrders.forEach(order => {
            const select = document.getElementById(`assign-${order.id}`);
            if (select && order.assignedTo && order.assignedTo.length > 0) {
                select.value = order.assignedTo[order.assignedTo.length - 1]; // Show last assigned
            }
        });
    },

    updateAssignment: async (orderId, memberId) => {
        if (!memberId) return;

        const order = currentOrders.find(o => o.id === orderId);
        if (!order) return;

        const currentAssigned = order.assignedTo || [];
        if (!currentAssigned.includes(memberId)) {
            currentAssigned.push(memberId);
        }

        // Log history
        const historyEntry = {
            action: 'assigned',
            memberId: memberId,
            memberName: currentMembers.find(m => m.id === memberId)?.name || memberId,
            timestamp: new Date().toISOString(),
            assignedBy: 'admin' // TODO: Get current user
        };

        const assignmentHistory = order.assignmentHistory || [];
        assignmentHistory.push(historyEntry);

        // Update in Firestore
        const result = await DB.updateOrder(orderId, {
            assignedTo: currentAssigned,
            assignmentHistory: assignmentHistory
        });

        if (!result.error) {
            window.adminApp.renderPendingAssignment();
        }
    },

    removeAssignment: async (orderId, memberId) => {
        const order = currentOrders.find(o => o.id === orderId);
        if (!order) return;

        const currentAssigned = (order.assignedTo || []).filter(id => id !== memberId);
        const memberName = currentMembers.find(m => m.id === memberId)?.name || memberId;

        // Log history
        const historyEntry = {
            action: 'removed',
            memberId: memberId,
            memberName: memberName,
            timestamp: new Date().toISOString(),
            assignedBy: 'admin'
        };

        const assignmentHistory = order.assignmentHistory || [];
        assignmentHistory.push(historyEntry);

        // Update in Firestore
        const result = await DB.updateOrder(orderId, {
            assignedTo: currentAssigned,
            assignmentHistory: assignmentHistory
        });

        if (!result.error) {
            window.adminApp.renderPendingAssignment();
        }
    },

    saveRemarks: async (orderId, remarks) => {
        const result = await DB.updateOrder(orderId, {
            remarks: remarks
        });

        if (result.error) {
            console.error('Failed to save remarks:', result.error);
        }
    },

    updateDueDate: async (orderId, dateValue) => {
        const result = await DB.updateOrder(orderId, {
            estimatedCompletion: dateValue
        });

        if (!result.error) {
            // Refresh to re-sort if needed
            window.adminApp.renderPendingAssignment();
        } else {
            console.error('Failed to save due date:', result.error);
        }
    },

    togglePriority: async (orderId) => {
        const order = currentOrders.find(o => o.id === orderId);
        if (!order) return;

        const newPriority = order.priority === 'urgent' ? 'normal' : 'urgent';

        const result = await DB.updateOrder(orderId, {
            priority: newPriority
        });

        if (!result.error) {
            window.adminApp.renderPendingAssignment();
        }
    },


    generatePendingReport: () => {
        // Get currently displayed pending orders
        const pendingOrders = currentOrders.filter(o => o.status === 'Pending' && !o.deleted);

        if (pendingOrders.length === 0) {
            alert('No pending orders to generate report.');
            return;
        }

        // Calculate stats
        const total = pendingOrders.length;
        const urgent = pendingOrders.filter(o => o.priority === 'urgent').length;
        const assigned = pendingOrders.filter(o => o.assignedTo && o.assignedTo.length > 0).length;
        const unassigned = total - assigned;

        // Employee workload
        const workload = {};
        pendingOrders.forEach(o => {
            (o.assignedTo || []).forEach(id => {
                const name = currentMembers.find(m => m.id === id)?.name || id;
                workload[name] = (workload[name] || 0) + 1;
            });
        });

        // Generate print content
        const today = new Date().toLocaleDateString('en-IN', {
            day: '2-digit', month: 'long', year: 'numeric'
        });

        const reportHTML = `
            <html>
            <head>
                <title>Pending Orders Report - ${today}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { text-align: center; color: #1e293b; }
                    .summary { display: flex; gap: 20px; margin-bottom: 20px; }
                    .stat-box { background: #f1f5f9; padding: 15px; border-radius: 8px; flex: 1; text-align: center; }
                    .stat-box h3 { margin: 0; font-size: 24px; color: #0d9488; }
                    .stat-box p { margin: 5px 0 0; color: #64748b; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; font-size: 12px; }
                    th { background: #1e293b; color: white; }
                    .urgent { background: #fef2f2; }
                    .workload { margin-top: 20px; }
                    .workload-item { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
                </style>
            </head>
            <body>
                <h1>📋 IES Groups - Pending Orders Report</h1>
                <p style="text-align: center; color: #64748b;">${today}</p>
                
                <div class="summary">
                    <div class="stat-box"><h3>${total}</h3><p>Total Pending</p></div>
                    <div class="stat-box"><h3 style="color: #ef4444;">${urgent}</h3><p>Urgent</p></div>
                    <div class="stat-box"><h3 style="color: #22c55e;">${assigned}</h3><p>Assigned</p></div>
                    <div class="stat-box"><h3 style="color: #f59e0b;">${unassigned}</h3><p>Unassigned</p></div>
                </div>

                <h2>Employee Workload</h2>
                <div class="workload">
                    ${Object.entries(workload).map(([name, count]) =>
            `<div class="workload-item"><strong>${name}</strong>: ${count} orders</div>`
        ).join('')}
                    ${Object.keys(workload).length === 0 ? '<p>No assignments yet</p>' : ''}
                </div>

                <h2>Order Details</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Priority</th>
                            <th>Order ID</th>
                            <th>Description</th>
                            <th>Customer</th>
                            <th>Due Date</th>
                            <th>Assigned To</th>
                            <th>Remarks</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pendingOrders.map(o => {
            const assignedNames = (o.assignedTo || []).map(id =>
                currentMembers.find(m => m.id === id)?.name || id
            ).join(', ') || 'Unassigned';
            const dueDate = o.estimatedCompletion
                ? new Date(o.estimatedCompletion).toLocaleDateString('en-IN')
                : '-';
            return `
                                <tr class="${o.priority === 'urgent' ? 'urgent' : ''}">
                                    <td>${o.priority === 'urgent' ? '🔴 Urgent' : '⚪ Normal'}</td>
                                    <td>${o.internalOrderNo || o.id}</td>
                                    <td>${o.description || '-'}</td>
                                    <td>${o.customer || '-'}</td>
                                    <td>${dueDate}</td>
                                    <td>${assignedNames}</td>
                                    <td>${o.remarks || '-'}</td>
                                </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>

                <script>window.print();</script>
            </body>
            </html>
        `;

        // Open print window
        const printWindow = window.open('', '_blank');
        printWindow.document.write(reportHTML);
        printWindow.document.close();
    },

    // ============================================
    // DAILY REPORTS FUNCTIONS
    // ============================================

    renderReports: async () => {
        const tbody = document.getElementById('reports-body');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400">Loading reports...</td></tr>';

        const reports = await DB.getReports(30);

        if (reports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400">No reports yet. Click "Generate Today\'s Report" to create one.</td></tr>';
            return;
        }

        tbody.innerHTML = reports.map(report => {
            const displayDate = new Date(report.date).toLocaleDateString('en-IN', {
                weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
            });

            const generatedAt = report.createdAt?.toDate
                ? report.createdAt.toDate().toLocaleString('en-IN')
                : (report.updatedAt?.toDate ? report.updatedAt.toDate().toLocaleString('en-IN') : 'Unknown');

            return `
                <tr>
                    <td style="font-weight: 600;">${displayDate}</td>
                    <td style="text-align: center;">${report.totalOrders || 0}</td>
                    <td style="text-align: center; color: #ef4444;">${report.urgent || 0}</td>
                    <td style="text-align: center; color: #22c55e;">${report.assigned || 0}</td>
                    <td style="text-align: center; color: #f59e0b;">${report.unassigned || 0}</td>
                    <td style="font-size: 0.75rem; color: #64748b;">${generatedAt}</td>
                    <td style="text-align: center;">
                        <button class="btn btn-ghost btn-icon" 
                                onclick="window.adminApp.printSavedReport('${report.date}')"
                                title="Print Report">
                            🖨️
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    generateAndSaveReport: async () => {
        const pendingOrders = currentOrders.filter(o => o.status === 'Pending' && !o.deleted);

        // Build report data
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

        const totalOrders = pendingOrders.length || 0;
        const urgent = pendingOrders.filter(o => (o.priority || '').toLowerCase() === 'urgent').length || 0;
        const assigned = pendingOrders.filter(o => o.assignedTo && o.assignedTo.length > 0).length || 0;
        const unassigned = totalOrders - assigned;

        // Employee workload
        const workload = {};
        pendingOrders.forEach(o => {
            (o.assignedTo || []).forEach(id => {
                const name = currentMembers.find(m => m.id === id)?.name || id || 'Unknown';
                workload[name] = (workload[name] || 0) + 1;
            });
        });

        // Orders snapshot for detailed view - ensure NO undefined values
        const ordersSnapshot = pendingOrders.map(o => {
            const assignedNames = (o.assignedTo || []).map(id =>
                currentMembers.find(m => m.id === id)?.name || id
            ).join(', ') || 'Unassigned';

            return {
                id: o.id || '',
                internalOrderNo: o.internalOrderNo || '',
                description: o.description || '',
                customer: o.customer || '',
                priority: o.priority || 'normal',
                assignedTo: o.assignedTo || [],
                assignedNames: assignedNames,
                remarks: o.remarks || '',
                estimatedCompletion: o.estimatedCompletion || ''
            };
        });

        const reportData = {
            date: dateStr || '',
            totalOrders: totalOrders || 0,
            urgent: urgent || 0,
            assigned: assigned || 0,
            unassigned: unassigned || 0,
            workload: workload || {},
            ordersSnapshot: ordersSnapshot || [],
            generatedAt: new Date().toISOString()
        };

        const result = await DB.saveReport(reportData);

        if (result.success) {
            alert(`Report for ${dateStr} saved successfully!`);
            window.adminApp.renderReports();
        } else {
            alert('Failed to save report: ' + (result.error || 'Unknown error'));
        }
    },

    printSavedReport: async (dateStr) => {
        const report = await DB.checkTodayReport(dateStr);
        if (!report) {
            alert('Report not found.');
            return;
        }

        const displayDate = new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'long', year: 'numeric'
        });

        const reportHTML = `
            <html>
            <head>
                <title>Pending Orders Report - ${displayDate}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { text-align: center; color: #1e293b; }
                    .summary { display: flex; gap: 20px; margin-bottom: 20px; }
                    .stat-box { background: #f1f5f9; padding: 15px; border-radius: 8px; flex: 1; text-align: center; }
                    .stat-box h3 { margin: 0; font-size: 24px; color: #0d9488; }
                    .stat-box p { margin: 5px 0 0; color: #64748b; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; font-size: 12px; }
                    th { background: #1e293b; color: white; }
                    .urgent { background: #fef2f2; }
                    .workload { margin-top: 20px; }
                    .workload-item { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
                </style>
            </head>
            <body>
                <h1>📋 IES Groups - Pending Orders Report</h1>
                <p style="text-align: center; color: #64748b;">${displayDate}</p>
                
                <div class="summary">
                    <div class="stat-box"><h3>${report.totalOrders}</h3><p>Total Pending</p></div>
                    <div class="stat-box"><h3 style="color: #ef4444;">${report.urgent}</h3><p>Urgent</p></div>
                    <div class="stat-box"><h3 style="color: #22c55e;">${report.assigned}</h3><p>Assigned</p></div>
                    <div class="stat-box"><h3 style="color: #f59e0b;">${report.unassigned}</h3><p>Unassigned</p></div>
                </div>

                <h2>Employee Workload</h2>
                <div class="workload">
                    ${Object.entries(report.workload || {}).map(([name, count]) =>
            `<div class="workload-item"><strong>${name}</strong>: ${count} orders</div>`
        ).join('')}
                    ${Object.keys(report.workload || {}).length === 0 ? '<p>No assignments</p>' : ''}
                </div>

                <h2>Order Details</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Priority</th>
                            <th>Order ID</th>
                            <th>Description</th>
                            <th>Customer</th>
                            <th>Due Date</th>
                            <th>Assigned To</th>
                            <th>Remarks</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(report.ordersSnapshot || []).map(o => {
            const dueDate = o.estimatedCompletion
                ? new Date(o.estimatedCompletion).toLocaleDateString('en-IN')
                : '-';
            return `
                            <tr class="${o.priority === 'urgent' ? 'urgent' : ''}">
                                <td>${o.priority === 'urgent' ? '🔴 Urgent' : '⚪ Normal'}</td>
                                <td>${o.internalOrderNo || o.id}</td>
                                <td>${o.description || '-'}</td>
                                <td>${o.customer || '-'}</td>
                                <td>${dueDate}</td>
                                <td>${o.assignedNames || 'Unassigned'}</td>
                                <td>${o.remarks || '-'}</td>
                            </tr>
                        `;
        }).join('')}
                    </tbody>
                </table>

                <script>window.print();</script>
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(reportHTML);
        printWindow.document.close();
    },

    checkAutoGenerateReport: async () => {
        // Get current IST time using Intl.DateTimeFormat
        const now = new Date();
        const istFormatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hour12: false
        });

        const parts = istFormatter.formatToParts(now);
        const getTimePart = (type) => parts.find(p => p.type === type).value;

        const hours = parseInt(getTimePart('hour'));
        const todayStr = `${getTimePart('year')}-${getTimePart('month')}-${getTimePart('day')}`;

        // Check if it's past 7 PM IST (19:00)
        if (hours >= 19) {
            // Check if report for today already exists
            const existingReport = await DB.checkTodayReport(todayStr);

            if (!existingReport) {
                console.log('Auto-generating report for', todayStr);

                // Wait a bit for orders to be loaded if they aren't already
                setTimeout(async () => {
                    if (currentOrders && currentOrders.length > 0) {
                        await window.adminApp.generateAndSaveReport();
                        console.log('Auto-report generated successfully');
                    }
                }, 3000);
            } else {
                console.log('Report for today already exists');
            }
        }
    }
};

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {

    // Setup UI Listeners
    UI.setupNavigation();

    const monitoringView = document.getElementById('view-monitoring');
    const deliveryView = document.getElementById('view-delivery_report');

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

        if (monitoringView && !monitoringView.classList.contains('hidden')) {
            Monitoring.renderTable(currentOrders);
        }

        // --- ADDED: Live Update for Pending Assignment ---
        const pendingView = document.getElementById('view-pending_assignment');
        if (pendingView && !pendingView.classList.contains('hidden')) {
            window.adminApp.renderPendingAssignment();
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

                    // Refresh dashboard after login to use real data
                    refreshDashboard();
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
                    refreshDashboard();
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
                } else if (view === 'pending_assignment') {
                    // Render pending assignment table
                    window.adminApp.renderPendingAssignment();
                } else if (view === 'reports') {
                    // Render daily reports list
                    window.adminApp.renderReports();
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

    // Pending Assignment Filter Listeners
    const pendingFilters = ['pending-filter-department', 'pending-filter-assigned', 'pending-filter-priority', 'pending-sort-by'];
    pendingFilters.forEach(filterId => {
        const filter = document.getElementById(filterId);
        if (filter) {
            filter.addEventListener('change', () => {
                window.adminApp.renderPendingAssignment();
            });
        }
    });

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

            // Ensure dashboard is ready immediately
            refreshDashboard();

            // Auto-generate report if past 7 PM IST
            window.adminApp.checkAutoGenerateReport();
        } else {
            if (authDiv) authDiv.style.display = 'flex';
            if (dashDiv) dashDiv.style.display = 'none';
        }
    });
});
