import * as Auth from './auth.js';
import * as UI from './ui.js';
import * as DB from './db.js';
import * as Charts from './charts.js';
import * as Monitoring from './monitoring.js';
import * as Inventory from './inventory.js';
import * as Workflow from './workflow.js';
import * as Reporting from './reporting.js';

// App State
let currentMembers = [];
let currentProjects = [];
let currentOrders = [];
let isTrashView = false;
let isProjectTrashView = false;
let projectViewMode = localStorage.getItem('projectViewMode') || 'grid';
let currentInventory = [];
let currentTransactions = [];
let inventoryUnsubscribe = null;
let transactionUnsubscribe = null;
let isInventoryTrashView = false;
let currentInventoryTab = 'master';
let inventorySortState = { column: 'name', direction: 'asc' };

// Helper: Member Search Handling
function setupMemberSearch(containerId, inputClass, hiddenInputId, onSelectChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tagsContainer = container.querySelector('.search-tags-container');
    const input = container.querySelector('.' + inputClass);
    const hiddenInput = document.getElementById(hiddenInputId);
    const dropdown = container.querySelector('.search-suggestions-dropdown');

    let selectedMembers = [];

    // Initialize from hidden input if it has a value
    if (hiddenInput && hiddenInput.value) {
        try {
            selectedMembers = JSON.parse(hiddenInput.value);
            renderTags();
        } catch (e) {
            // Fallback for comma-separated string if it's not JSON
            selectedMembers = hiddenInput.value.split(',').map(s => s.trim()).filter(s => s);
            renderTags();
        }
    }

    function renderTags() {
        if (!tagsContainer) return;
        const currentInput = input.value;
        const tagHTML = selectedMembers.map(m => `
            <span class="member-tag">
                ${m}
                <span class="member-tag-remove" data-member="${m}">&times;</span>
            </span>
        `).join('');

        tagsContainer.innerHTML = tagHTML;
        tagsContainer.appendChild(input);
        input.value = currentInput;

        if (hiddenInput) {
            hiddenInput.value = JSON.stringify(selectedMembers);
            // Trigger change event if needed
            hiddenInput.dispatchEvent(new Event('change'));
        }

        if (onSelectChange) onSelectChange(selectedMembers);
    }

    function showSuggestions(term) {
        if (!dropdown) return;
        const filtered = currentMembers.filter(m =>
            m.name.toLowerCase().includes(term.toLowerCase()) &&
            !selectedMembers.includes(m.name)
        );

        if (filtered.length === 0 || term === '') {
            dropdown.innerHTML = '';
            dropdown.classList.add('hidden');
            return;
        }

        dropdown.innerHTML = filtered.map(m => `
            <div class="suggestion-item" data-name="${m.name}">${m.name}</div>
        `).join('');
        dropdown.classList.remove('hidden');
    }

    input.addEventListener('input', (e) => {
        showSuggestions(e.target.value);
    });

    input.addEventListener('focus', () => {
        showSuggestions(input.value);
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            dropdown?.classList.add('hidden');
        }
    });

    container.addEventListener('click', (e) => {
        if (e.target.classList.contains('suggestion-item')) {
            const name = e.target.dataset.name;
            if (!selectedMembers.includes(name)) {
                selectedMembers.push(name);
                input.value = '';
                dropdown.classList.add('hidden');
                renderTags();
            }
        } else if (e.target.classList.contains('member-tag-remove')) {
            const name = e.target.dataset.member;
            selectedMembers = selectedMembers.filter(m => m !== name);
            renderTags();
        } else if (e.target === tagsContainer || e.target.classList.contains('member-tag')) {
            input.focus();
        }
    });

    // Initial render if members were pre-loaded
    renderTags();
}

// Global App Object
function calculateDashboardStats(orders, selectedMonth = 'all', selectedDept = 'all') {
    // Filter by month and department
    const filteredOrders = orders.filter(o => {
        if (o.isTrash) return false;

        const matchesMonth = selectedMonth === 'all' || (o.date && o.date.startsWith(selectedMonth));
        const matchesDept = selectedDept === 'all' || o.department === selectedDept;

        return matchesMonth && matchesDept;
    });

    const active = filteredOrders.filter(o => o.status === 'Pending');
    const delivered = filteredOrders.filter(o => o.status === 'Delivered');

    const parseTotal = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return parseFloat(val.replace(/,/g, '')) || 0;
        return 0;
    };

    // Revenue is now sum of all Pending orders in selection (Using In-house Value only)
    const revenue = active.reduce((sum, o) => sum + parseTotal(o.prodValueEa), 0);
    const pendingCount = active.length;

    // Unassigned orders: Pending orders with no assignment
    const unassignedCount = active.filter(o => !o.assignedTo || o.assignedTo.length === 0).length;

    const totalCount = active.length + delivered.length;

    // Pipeline percentages
    const pendingPct = totalCount > 0 ? Math.round((pendingCount / totalCount) * 100) : 0;
    const deliveredPct = totalCount > 0 ? Math.round((delivered.length / totalCount) * 100) : 100;

    return {
        revenue,
        activeOrders: active.length,
        pendingCount,
        unassignedCount,
        totalMembers: currentMembers.length,
        pendingPct,
        deliveredPct,
        filteredOrders
    };
}

// Helper: Refresh Dashboard UI
function refreshDashboard() {
    const monthFilter = document.getElementById('dashboard-month-filter');
    const deptFilter = document.getElementById('dashboard-dept-filter');

    const selectedMonth = monthFilter ? monthFilter.value : 'all';
    const selectedDept = deptFilter ? deptFilter.value : 'all';

    const stats = calculateDashboardStats(currentOrders, selectedMonth, selectedDept);
    UI.updateStats(stats);
    UI.renderDashboardPendingOrders(stats.filteredOrders);
    UI.renderDashboardRecentActivity(stats.filteredOrders);
}



// Global App Object
window.adminApp = {
    currentEditingProjectId: null,
    switchView: (viewName) => {
        UI.switchView(viewName);
        if (viewName === 'inventory_management') {
            window.adminApp.initInventory();
        } else if (inventoryUnsubscribe) {
            inventoryUnsubscribe();
            inventoryUnsubscribe = null;
        }
        if (viewName === 'daily_roster') {
            Workflow.initWorkflowView();
        }

        if (viewName === 'daily_summary_report') {
            const picker = document.getElementById('summary-report-month');
            if (picker && !picker.value) {
                picker.value = new Date().toISOString().slice(0, 7);
            }
            Reporting.renderDailySummaryReport(picker.value);
        }
    },

    refreshDashboard: () => {
        refreshDashboard();
    },

    getCurrentOrders: () => currentOrders,
    getCurrentProjects: () => currentProjects,

    wfOpenProject: (orderNo) => {
        if (!orderNo || orderNo === 'Ad-hoc') return;
        const project = currentProjects.find(p => p.projectId === orderNo);
        if (project) {
            window.adminApp.viewProjectDetails(project.id);
        } else {
            alert('Linked project not found for Internal Order: ' + orderNo);
        }
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

    loadProjectCosting: async (docId, projectNo) => {
        console.log("Loading costing for:", projectNo);
        const body = document.getElementById('project-costing-body');
        if (body) body.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Calculating costs...</td></tr>';

        try {
            const rosterDocs = await DB.getProjectAssignments(projectNo);
            console.log(`Found ${rosterDocs.length} roster documents for project ${projectNo}`);

            // Aggregation map based on Unique taskId to prevent team member over-counting
            const taskMap = new Map();
            const canonicalProjectNo = projectNo.toString().trim().toLowerCase();

            rosterDocs.forEach(row => {
                const employees = row.assignments || [];
                employees.forEach(emp => {
                    const tasks = emp.tasks || [];
                    tasks.forEach(t => {
                        const canonicalOrderNo = (t.orderNo || '').toString().trim().toLowerCase();

                        if (canonicalOrderNo === canonicalProjectNo) {
                            // Unique ID for the task-day-dept occurrence
                            const tid = t.taskId || `${row.date}_${emp.employeeId}_${t.orderNo}`;

                            if (!taskMap.has(tid)) {
                                const food = parseFloat(t.costFood) || 0;
                                const cons = parseFloat(t.costConsumables) || 0;
                                const trans = parseFloat(t.costTransport) || 0;
                                const misc = parseFloat(t.costMisc) || 0;
                                const extras = food + cons + trans + misc;

                                const qty = parseFloat(t.qty) || 0;
                                const unitPrice = parseFloat(t.prodValueEa) || 0;
                                const prodVal = (qty * unitPrice); // Base only, extras separated

                                taskMap.set(tid, {
                                    date: row.date,
                                    dept: row.department,
                                    description: t.description,
                                    extras: extras,
                                    prodVal: prodVal,
                                    employees: [],
                                    totalOverhead: 0
                                });
                            }

                            const entry = taskMap.get(tid);
                            // SUM individual overhead shares (t.overheads) not task-total (t.totalOverheads)
                            const overheadShare = parseFloat(t.overheads) || 0;
                            entry.totalOverhead += overheadShare;

                            const empDetail = `${emp.employeeName} (${t.allocationPct || 100}%)`;
                            if (!entry.employees.includes(empDetail)) {
                                entry.employees.push(empDetail);
                            }
                        }
                    });
                });
            });

            // Final Totals
            let totalProd = 0;
            let totalOverhead = 0;
            let totalExtra = 0;
            let history = [];

            taskMap.forEach((data, tid) => {
                totalProd += data.prodVal;
                totalOverhead += data.totalOverhead; // Base manpower overhead
                totalExtra += data.extras;

                // Push combined overhead for the table
                history.push({
                    date: data.date,
                    dept: data.dept,
                    employee: data.employees.join(', '),
                    role: data.description,
                    overhead: data.totalOverhead,
                    extras: data.extras,
                    prodVal: data.prodVal
                });
            });

            console.log(`Aggregated: TotalProd=${totalProd}, UniqueTasks=${taskMap.size}`);
            // Sort history by date descending
            history.sort((a, b) => new Date(b.date) - new Date(a.date));

            window.adminApp.renderProjectCosting({
                totalProd,
                totalOverhead,
                totalExtra,
                history
            });

            // If empty, show hint
            if (taskMap.size === 0 && body) {
                body.innerHTML = `
                    <tr>
                        <td colspan="6" class="p-8 text-center text-slate-400 italic">
                            No costing data mapped to this project ID.<br>
                            <button class="mt-4 text-xs text-emerald-600 font-bold hover:underline" onclick="window.adminApp.syncAllProjectIndices()">
                                ↻ Refresh Historical Links
                            </button>
                        </td>
                    </tr>`;
            }

        } catch (err) {
            console.error("Error in loadProjectCosting:", err);
            if (body) body.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-red-500 italic">Error loading data. Check console.</td></tr>';
        }
    },

    syncAllProjectIndices: async () => {
        if (!confirm("This will scan all Daily Roster entries to link them to projects for the new Costing tab. This may take a moment for large datasets. Proceed?")) return;

        try {
            const workflows = await DB.getAllWorkflows();
            console.log(`Starting sub-sync for ${workflows.length} documents...`);

            let updated = 0;
            for (const wf of workflows) {
                const employees = wf.assignments || [];
                // Correct extraction: flatMap tasks to get orderNo
                const pIds = [...new Set(employees.flatMap(em => (em.tasks || []).map(t => t.orderNo)).filter(id => id && id !== 'Ad-hoc'))];

                // Only update if projectIds is missing or doesn't match
                if (!wf.projectIds || JSON.stringify(wf.projectIds.sort()) !== JSON.stringify(pIds.sort())) {
                    console.log(`Syncing doc: ${wf.id} (${wf.date}) - New Index:`, pIds);
                    // Use the existing saveWorkflow which now correctly extracts projectIds
                    await DB.saveWorkflow(wf.date, wf.department, wf.assignments, wf.supervisorNotes || '', wf.id);
                    updated++;
                }
            }

            alert(`Sync complete! ${updated} records updated.`);

            // Reload the current project costing
            const currentId = window.adminApp.currentEditingProjectId;
            const project = currentProjects.find(p => p.id === currentId);
            if (project) {
                window.adminApp.loadProjectCosting(currentId, project.projectId);
            }
        } catch (err) {
            console.error("Sync failed:", err);
            alert("Sync failed. Check console for details.");
        }
    },

    renderProjectCosting: (data) => {
        const elProd = document.getElementById('costing-total-prod');
        const elOver = document.getElementById('costing-total-overhead');
        const elExtra = document.getElementById('costing-total-extra');
        const elMargin = document.getElementById('costing-total-margin');
        const body = document.getElementById('project-costing-body');

        if (elProd) elProd.textContent = `₹${data.totalProd.toLocaleString()}`;
        if (elOver) elOver.textContent = `₹${(data.totalOverhead + data.totalExtra).toLocaleString()}`; // Combined display
        if (elExtra) elExtra.textContent = `₹${data.totalExtra.toLocaleString()}`;

        const margin = data.totalProd - (data.totalOverhead + data.totalExtra);
        if (elMargin) {
            elMargin.textContent = `₹${margin.toLocaleString()}`;
            elMargin.style.color = margin >= 0 ? '#047857' : '#e11d48';
        }

        if (body) {
            if (data.history.length === 0) {
                body.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400 italic">No costing data found for this project.</td></tr>';
            } else {
                body.innerHTML = data.history.map(h => {
                    const combinedOverhead = h.overhead + h.extras;
                    let overheadHtml = `<div class="font-bold text-slate-600">₹${combinedOverhead.toLocaleString()}</div>`;
                    if (h.extras > 0) {
                        overheadHtml += `<div class="text-[10px] text-slate-400">Base: ₹${h.overhead.toLocaleString()}</div>
                                         <div class="text-[10px] text-amber-500">Extra: ₹${h.extras.toLocaleString()}</div>`;
                    }
                    return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="p-3 border-b border-slate-50 font-medium text-slate-600">${h.date}</td>
                        <td class="p-3 border-b border-slate-50"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 uppercase">${h.dept}</span></td>
                        <td class="p-3 border-b border-slate-50">
                            <div class="font-bold text-slate-700">${h.employee}</div>
                            <div class="text-[10px] text-slate-400 font-medium">${h.role}</div>
                        </td>
                        <td class="p-3 border-b border-slate-50 text-right">${overheadHtml}</td>
                        <td class="p-3 border-b border-slate-50 text-right font-bold text-emerald-600">₹${h.prodVal.toLocaleString()}</td>
                    </tr>
                    `;
                }).join('');
            }
        }
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
        setField('overheads', member.overheads || '');

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
            overheads: parseFloat(formData.get('overheads')) || 0,
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

    openAddProjectModal: (projectId = null) => {
        const modal = document.getElementById('add-project-modal');
        if (!modal) return;

        const form = document.getElementById('add-project-form');
        if (form) form.reset();

        const title = modal.querySelector('.modal-title');
        const submitBtn = form?.querySelector('button[type="submit"]');

        if (projectId) {
            // Edit mode
            const project = currentProjects.find(p => p.id === projectId);
            if (!project) return;

            if (title) title.textContent = 'Edit Project';
            if (submitBtn) submitBtn.textContent = 'Save Changes';

            // Pre-fill
            const setVal = (name, val) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.value = val || ''; };
            setVal('name', project.name);
            setVal('customerName', project.customerName);
            setVal('jobType', project.jobType);
            setVal('drawingSource', project.drawingSource);
            setVal('expectedCompletion', project.expectedCompletion);
            setVal('internalNotes', project.internalNotes);

            // Store edit ID
            modal.dataset.editId = projectId;
        } else {
            if (title) title.textContent = 'Initialize New Project';
            if (submitBtn) submitBtn.textContent = 'Initialize Project';
            delete modal.dataset.editId;
        }

        window.adminApp.openModal('add-project-modal');
    },

    submitProjectForm: async () => {
        const form = document.getElementById('add-project-form');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const formData = new FormData(form);
            const projectData = {
                name: formData.get('name'),
                customerName: formData.get('customerName'),
                jobType: formData.get('jobType'),
                drawingSource: formData.get('drawingSource'),
                expectedCompletion: formData.get('expectedCompletion') || null,
                internalNotes: formData.get('internalNotes') || '',
            };

            const modal = document.getElementById('add-project-modal');
            const editId = modal?.dataset.editId;

            if (editId) {
                // Update existing
                const result = await DB.updateProject(editId, projectData, 'Project Edited');
                if (result.error) {
                    alert('Error: ' + result.error);
                } else {
                    window.adminApp.closeModal('add-project-modal');
                    form.reset();
                    delete modal.dataset.editId;
                }
            } else {
                // Create new
                const result = await DB.addProject(projectData);
                if (result.error) {
                    alert('Error: ' + result.error);
                } else {
                    window.adminApp.closeModal('add-project-modal');
                    form.reset();
                }
            }
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    },

    filterProjects: () => {
        const searchTerm = document.getElementById('project-search')?.value.toLowerCase() || '';
        const statusFilter = document.getElementById('project-status-filter')?.value || 'all';
        const typeFilter = document.getElementById('project-type-filter')?.value || 'all';

        const filtered = currentProjects.filter(p => {
            // Filter based on trash view
            const isDeleted = !!p.isDeleted;
            if (isProjectTrashView !== isDeleted) return false;

            // Cross-reference drawing number for search
            let drgNo = p.drawingNo || '';
            if (!drgNo && window.adminApp.getCurrentOrders) {
                const orders = window.adminApp.getCurrentOrders();
                const matchingOrder = orders.find(o => o.internalOrderNo === p.projectId);
                if (matchingOrder) drgNo = matchingOrder.drawingNo || '';
            }

            const matchesSearch = (p.name?.toLowerCase().includes(searchTerm) ||
                p.projectId?.toLowerCase().includes(searchTerm) ||
                p.customerName?.toLowerCase().includes(searchTerm) ||
                drgNo.toLowerCase().includes(searchTerm));
            const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
            const matchesType = typeFilter === 'all' || p.jobType === typeFilter;

            return matchesSearch && matchesStatus && matchesType;
        });

        window.adminApp.renderProjectCards(filtered);
        window.adminApp.updateProjectStats();
    },

    setProjectView: (mode) => {
        window.adminApp.projectViewMode = mode;
        localStorage.setItem('projectViewMode', mode);

        // Update Toggle Buttons
        const gridBtn = document.getElementById('btn-view-grid');
        const listBtn = document.getElementById('btn-view-list');
        if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');
        if (listBtn) listBtn.classList.toggle('active', mode === 'list');

        window.adminApp.filterProjects();
    },

    renderProjectTable: (projects) => {
        const tbody = document.getElementById('project-list-body');
        if (!tbody) return;

        if (projects.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-12 text-slate-400">No projects found.</td></tr>';
            return;
        }

        tbody.innerHTML = projects.map(p => {
            const statusClass = (p.status || 'draft').toLowerCase().replace(/\s+/g, '-');
            const isTrashed = !!p.isDeleted;
            const deliveryDate = p.expectedCompletion ? new Date(p.expectedCompletion).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'N/A';

            // Cross-reference Drawing No if missing
            let drgNo = p.drawingNo || '';
            if (!drgNo && window.adminApp.getCurrentOrders) {
                const orders = window.adminApp.getCurrentOrders();
                const matchingOrder = orders.find(o => o.internalOrderNo === p.projectId);
                if (matchingOrder) drgNo = matchingOrder.drawingNo || '';
            }

            const displayDrg = drgNo ? `<span class="pm-table-project-drg text-xs font-semibold px-2 py-0.5 rounded ml-2" style="background: var(--brand-50); color: var(--brand-700); border: 1px solid var(--brand-200);">DRG: ${drgNo}</span>` : '';


            const actions = isTrashed ? `
                <button class="pm-action-btn restore-btn" onclick="event.stopPropagation(); window.adminApp.restoreProject('${p.id}')">Restore</button>
                <button class="pm-action-btn" style="color:#ef4444;" onclick="event.stopPropagation(); window.adminApp.permanentDeleteProject('${p.id}')">Delete</button>
            ` : `
                <div class="flex gap-2 justify-end">
                    <button class="pm-action-btn" onclick="event.stopPropagation(); window.adminApp.editProject('${p.id}')">Edit</button>
                    <button class="pm-action-btn deep-dive" onclick="event.stopPropagation(); window.adminApp.viewProjectDetails('${p.id}')">Report</button>
                </div>
            `;

            return `
                <tr class="${isTrashed ? 'opacity-50' : ''}">
                    <td>
                        <div class="pm-table-project-info">
                            <span class="pm-table-project-name">${p.name}</span>
                            <div class="flex items-center mt-1">
                                <span class="pm-table-project-id">${p.projectId}</span>
                                ${displayDrg}
                            </div>
                        </div>
                    </td>
                    <td><span class="pm-table-customer">${p.customerName}</span></td>
                    <td><span class="version-tag">${p.jobType || 'N/A'}</span></td>
                    <td><span class="status-badge ${statusClass}">${p.status}</span></td>
                    <td>
                        <div class="pm-table-timeline">
                            <span class="pm-table-date-label">Delivery</span>
                            <span class="font-bold text-slate-700">${deliveryDate}</span>
                        </div>
                    </td>
                    <td class="text-right">${actions}</td>
                </tr>
            `;
        }).join('');
    },

    updateProjectStats: () => {
        const active = currentProjects.filter(p => !p.isDeleted);
        const completed = active.filter(p => p.status === 'Completed');
        const trashed = currentProjects.filter(p => !!p.isDeleted);

        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl('pm-stat-total', active.length);
        setEl('pm-stat-active', active.length - completed.length);
        setEl('pm-stat-completed', completed.length);
        setEl('pm-stat-trash', trashed.length);

        // Trash count badge
        const trashCount = document.getElementById('pm-trash-count');
        if (trashCount) {
            trashCount.textContent = trashed.length;
            trashCount.style.display = trashed.length > 0 ? 'inline-flex' : 'none';
        }
    },

    toggleProjectTrash: () => {
        isProjectTrashView = !isProjectTrashView;

        const toggleBtn = document.getElementById('pm-trash-toggle-btn');
        const toggleLabel = document.getElementById('pm-trash-toggle-label');
        const trashBanner = document.getElementById('pm-trash-banner');
        const filterBar = document.getElementById('pm-filter-bar');
        const newBtn = document.getElementById('pm-new-project-btn');

        if (isProjectTrashView) {
            if (toggleBtn) toggleBtn.classList.add('active');
            if (toggleLabel) toggleLabel.textContent = 'Active Projects';
            if (trashBanner) trashBanner.style.display = 'flex';
            if (filterBar) filterBar.style.display = 'none';
            if (newBtn) newBtn.style.display = 'none';
        } else {
            if (toggleBtn) toggleBtn.classList.remove('active');
            if (toggleLabel) toggleLabel.textContent = 'Trash';
            if (trashBanner) trashBanner.style.display = 'none';
            if (filterBar) filterBar.style.display = '';
            if (newBtn) newBtn.style.display = '';
        }

        window.adminApp.filterProjects();
    },

    trashProject: (projectId) => {
        window.adminApp.showConfirmModal(
            "Move to Trash?",
            "This project will be moved to the trash. You can restore it later.",
            async () => {
                const result = await DB.softDeleteProject(projectId);
                if (result.error) alert('Error: ' + result.error);
            }
        );
    },

    restoreProject: async (projectId) => {
        const result = await DB.restoreProject(projectId);
        if (result.error) alert('Error restoring: ' + result.error);
    },

    permanentDeleteProject: (projectId) => {
        window.adminApp.showConfirmModal(
            "Permanently Delete?",
            "This project will be permanently deleted. This cannot be undone.",
            async () => {
                const result = await DB.deleteProject(projectId);
                if (result.error) alert('Error: ' + result.error);
            }
        );
    },

    editProject: (projectId) => {
        window.adminApp.openAddProjectModal(projectId);
    },

    // === INVENTORY MANAGEMENT ===
    initInventory: () => {
        if (inventoryUnsubscribe) return;
        inventoryUnsubscribe = Inventory.getInventory((items) => {
            currentInventory = items;
            window.adminApp.renderInventoryList(items);
            window.adminApp.updateInventoryStats(items);
        });
    },

    toggleInventoryTrash: () => {
        isInventoryTrashView = !isInventoryTrashView;
        const btn = document.getElementById('inventory-trash-btn');
        const badge = document.querySelector('.pm-header-badge.inventory');

        if (isInventoryTrashView) {
            btn.classList.add('active');
            btn.innerHTML = `
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
                </svg>
                <span>Back</span>
            `;
            if (badge) {
                badge.textContent = '📦 Deleted Items (Trash)';
                badge.classList.add('deleted');
            }
        } else {
            btn.classList.remove('active');
            btn.innerHTML = `
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Trash</span>
            `;
            if (badge) {
                badge.textContent = 'Stock Control';
                badge.classList.remove('deleted');
            }
        }
        window.adminApp.renderInventoryList(currentInventory);
    },

    trashInventoryItem: async (id, name) => {
        if (!confirm(`Move "${name}" to trash?`)) return;
        const result = await Inventory.softDeleteInventoryItem(id);
        if (result.error) alert('Error: ' + result.error);
    },

    restoreInventoryItem: async (id) => {
        const result = await Inventory.restoreInventoryItem(id);
        if (result.error) alert('Error: ' + result.error);
    },

    permanentDeleteInventoryItem: async (id, name) => {
        if (!confirm(`Permanently delete "${name}"? This action cannot be undone.`)) return;
        const result = await Inventory.permanentDeleteInventoryItem(id);
        if (result.error) alert('Error: ' + result.error);
    },



    renderInventoryList: (items) => {
        const body = document.getElementById('inventory-list-body');
        const table = body.closest('table');
        const headerRow = table ? table.querySelector('thead tr') : null;
        if (!body) return;

        // Filter items based on trash view
        const displayItems = items.filter(item => !!item.isDeleted === isInventoryTrashView);

        // Adjust Table Header for Trash View
        if (headerRow) {
            const sortIcon = (col) => {
                if (inventorySortState.column !== col) return '<span class="inv-sort-icon">⇅</span>';
                return inventorySortState.direction === 'asc' ? '<span class="inv-sort-icon active">▲</span>' : '<span class="inv-sort-icon active">▼</span>';
            };
            if (isInventoryTrashView) {
                headerRow.innerHTML = `
                    <th class="cr-emerald-bg">Item Details</th>
                    <th class="cr-emerald-bg">Category</th>
                    <th class="cr-emerald-bg">Last Stock</th>
                    <th class="cr-emerald-bg">Deleted On</th>
                    <th class="cr-emerald-bg text-right">Actions</th>
                `;
            } else {
                headerRow.innerHTML = `
                    <th class="cr-emerald-bg inv-sortable" onclick="window.adminApp.sortInventory('name')">Item Details ${sortIcon('name')}</th>
                    <th class="cr-emerald-bg inv-sortable" onclick="window.adminApp.sortInventory('category')">Category ${sortIcon('category')}</th>
                    <th class="cr-emerald-bg">Location</th>
                    <th class="cr-emerald-bg text-center inv-sortable" onclick="window.adminApp.sortInventory('stock')">Current Stock ${sortIcon('stock')}</th>
                    <th class="cr-emerald-bg inv-sortable" onclick="window.adminApp.sortInventory('status')">Status ${sortIcon('status')}</th>
                    <th class="cr-emerald-bg text-right">Actions</th>
                `;
            }
        }

        if (displayItems.length === 0) {
            const colspan = isInventoryTrashView ? 5 : 6;
            body.innerHTML = `
                <tr>
                    <td colspan="${colspan}" class="p-12 text-center text-slate-400">
                        <div class="flex flex-col items-center gap-2">
                            <span class="text-2xl">${isInventoryTrashView ? '🗑️' : '📦'}</span>
                            <p class="italic">No ${isInventoryTrashView ? 'deleted' : 'inventory'} items found.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        body.innerHTML = displayItems.map(item => {
            const isLow = item.currentStock <= item.minimumLevel && item.currentStock > 0;
            const isOut = item.currentStock <= 0;

            let statusBadge = `<span class="badge badge-success">In Stock</span>`;
            if (isOut) statusBadge = `<span class="badge" style="background: #fef2f2; color: #ef4444; border: 1px solid #fee2e2;">Out of Stock</span>`;
            else if (isLow) statusBadge = `<span class="badge badge-warning">Low Stock</span>`;

            // Thumbnail Logic
            let thumb = `
                <div class="inventory-icon-placeholder">
                    <span>${item.category === 'Tool' ? '🔧' : (item.category === 'Raw Material' ? '🏗️' : '📦')}</span>
                </div>
            `;
            if (item.photoUrl) {
                const safeName = (item.name || '').replace(/'/g, "\\'");
                thumb = `<img src="${item.photoUrl}" class="inventory-thumb cursor-pointer hover:ring-2 hover:ring-teal-500 transition-all" alt="${item.name}" onclick="event.stopPropagation(); window.adminApp.openPhotoViewer('${item.photoUrl}', '${safeName}')">`;
            }

            if (isInventoryTrashView) {
                return `
                    <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td class="p-3">
                            <div class="flex items-center gap-3">
                                ${thumb}
                                <div>
                                    <div class="font-bold text-slate-700">${item.name}</div>
                                </div>
                            </div>
                        </td>
                        <td class="p-3 text-slate-500 font-medium">${item.category}</td>
                        <td class="p-3 text-slate-700 font-bold">${item.currentStock} ${item.unit}</td>
                        <td class="p-3 text-slate-400 text-xs">${item.updatedAt ? new Date(item.updatedAt.seconds * 1000).toLocaleDateString() : 'Recently'}</td>
                        <td class="p-3 text-right">
                            <div class="flex justify-end gap-2">
                                <button class="btn btn-ghost btn-sm text-green-600" onclick="window.adminApp.restoreInventoryItem('${item.id}')" title="Restore">Restore</button>
                                <button class="btn btn-ghost btn-sm text-red-600" onclick="window.adminApp.permanentDeleteInventoryItem('${item.id}', '${item.name}')" title="Delete Permanently">Delete</button>
                            </div>
                        </td>
                    </tr>
                `;
            }

            return `
                <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td class="p-3">
                        <div class="flex items-center gap-3">
                            ${thumb}
                            <div>
                                <div class="font-bold text-slate-700">${item.name}</div>
                            </div>
                        </div>
                    </td>
                    <td class="p-3 text-slate-500 font-medium">${item.category}</td>
                    <td class="p-3 text-slate-500">${item.location || '-'}</td>
                    <td class="p-3 text-center">
                        <div class="font-bold text-slate-700 text-lg">${item.currentStock}</div>
                        <div class="text-[10px] text-slate-400 uppercase font-bold">${item.unit}</div>
                    </td>
                    <td class="p-3">${statusBadge}</td>
                    <td class="p-3 text-right">
                        <div class="flex justify-end gap-2">
                            <button class="pm-c-primary-btn" onclick='window.adminApp.openAdjustStockModal("${item.id}")'>🔄 Adjust</button>
                            <button class="action-btn" onclick="window.adminApp.editInventoryItem('${item.id}')" title="Edit Item" style="background: #eff6ff !important; color: #2563eb !important;">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </button>
                            <button class="action-btn delete" onclick="window.adminApp.trashInventoryItem('${item.id}', '${item.name}')" title="Move to Trash">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    updateInventoryStats: (items) => {
        const activeItems = items.filter(i => !i.isDeleted);
        const total = activeItems.length;
        const low = activeItems.filter(i => i.currentStock <= i.minimumLevel).length;
        const totalValue = activeItems.reduce((sum, i) => sum + ((i.currentStock || 0) * (i.price || 0)), 0);

        const setEl = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setEl('inv-stat-total', total);
        setEl('inv-stat-low', low);
        setEl('inv-stat-value', '₹' + totalValue.toLocaleString('en-IN'));
    },

    editInventoryItem: (itemId) => {
        // Password protection
        const password = prompt('Enter admin password to edit this item:');
        if (password === null) return;
        if (password !== 'IES') {
            alert('❌ Incorrect password. Edit cancelled.');
            return;
        }
        window.adminApp.openAddInventoryModal(itemId);
    },

    openAddInventoryModal: (editItemId = null) => {
        const form = document.getElementById('add-inventory-form');
        const modal = document.getElementById('add-inventory-modal');
        const modalTitle = modal.querySelector('.modal-title');
        const submitBtn = form.querySelector('button[type="submit"]');
        const stockFields = form.querySelector('.inv-stock-fields');
        const orderField = form.querySelector('.inv-order-field');
        if (form) form.reset();

        // Populate Order ID dropdown (Internal Orders)
        const orderSelect = form.querySelector('select[name="orderId"]');
        if (orderSelect) {
            const internalOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
            orderSelect.innerHTML = '<option value="">-- No Order ID --</option>' +
                internalOrders.map(o => {
                    const id = o.internalOrderNo || o.id;
                    return `<option value="${id}">${id} - ${o.customer || 'Order'}</option>`;
                }).join('');
        }

        // Hide photo section initially
        const photoSection = document.getElementById('inv-photo-section');
        if (photoSection) photoSection.classList.add('hidden');

        // Reset preview
        const preview = document.getElementById('inv-photo-preview');
        const placeholder = document.getElementById('inv-photo-preview-placeholder');
        if (preview) preview.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');

        if (editItemId) {
            // EDIT MODE
            const item = currentInventory.find(i => i.id === editItemId);
            if (!item) { alert('Item not found.'); return; }

            modal.dataset.editId = editItemId;
            if (modalTitle) modalTitle.innerHTML = '<span>✏️</span> EDIT INVENTORY ITEM';
            if (submitBtn) submitBtn.textContent = 'Save Changes';

            // Pre-fill form fields
            const setVal = (name, val) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.value = val ?? ''; };
            setVal('name', item.name);
            setVal('price', item.price);
            setVal('category', item.category);
            setVal('unit', item.unit);
            setVal('currentStock', item.currentStock);
            setVal('minimumLevel', item.minimumLevel);
            setVal('location', item.location);
            setVal('orderId', item.orderId);

            // Show photo section if Tool
            if (item.category === 'Tool' && photoSection) {
                photoSection.classList.remove('hidden');
                if (item.photoUrl && preview) {
                    preview.src = item.photoUrl;
                    preview.classList.remove('hidden');
                    if (placeholder) placeholder.classList.add('hidden');
                }
            }

            // Hide stock & order fields in edit mode (stock is managed via Adjust)
            if (stockFields) stockFields.style.display = 'none';
            if (orderField) orderField.style.display = 'none';
        } else {
            // ADD MODE
            delete modal.dataset.editId;
            if (modalTitle) modalTitle.innerHTML = '<span>📦</span> ADD NEW INVENTORY ITEM';
            if (submitBtn) submitBtn.textContent = 'Add Item';
            if (stockFields) stockFields.style.display = '';
            if (orderField) orderField.style.display = '';
        }

        window.adminApp.openModal('add-inventory-modal');
    },

    onInventoryCategoryChange: (category) => {
        const photoSection = document.getElementById('inv-photo-section');
        if (!photoSection) return;

        if (category === 'Tool') {
            photoSection.classList.remove('hidden');
        } else {
            photoSection.classList.add('hidden');
        }
    },

    handleInventoryPhotoSelect: (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Validation: 1MB limit
        if (file.size > 1024 * 1024) {
            alert("File too large. Max size is 1MB.");
            event.target.value = '';
            return;
        }

        // Preview
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById('inv-photo-preview');
            const placeholder = document.getElementById('inv-photo-preview-placeholder');
            if (preview) {
                preview.src = e.target.result;
                preview.classList.remove('hidden');
            }
            if (placeholder) placeholder.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    },

    handleAddInventoryItem: async (event) => {
        event.preventDefault();
        const formData = new FormData(event.target);
        const modal = document.getElementById('add-inventory-modal');
        const editId = modal?.dataset.editId;

        const submitBtn = event.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;

        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = "Saving...";

            if (editId) {
                // EDIT MODE — only update editable fields
                const updateData = {
                    name: formData.get('name'),
                    price: parseFloat(formData.get('price')) || 0,
                    category: formData.get('category'),
                    unit: formData.get('unit'),
                    minimumLevel: parseInt(formData.get('minimumLevel')) || 0,
                    location: formData.get('location') || ''
                };

                const result = await Inventory.updateInventoryItem(editId, updateData);
                if (!result.success) throw new Error(result.error);

                // If it's a tool and a new photo was selected
                const photoInput = document.getElementById('inv-photo-input');
                if (updateData.category === 'Tool' && photoInput?.files[0]) {
                    submitBtn.innerHTML = "Uploading Photo...";
                    const photoResult = await Inventory.uploadToolPhoto(editId, photoInput.files[0]);
                    if (photoResult.error) {
                        alert("Item updated, but photo upload failed: " + photoResult.error);
                    }
                }

                delete modal.dataset.editId;
            } else {
                // ADD MODE
                const itemData = {
                    name: formData.get('name'),
                    price: parseFloat(formData.get('price')) || 0,
                    category: formData.get('category'),
                    unit: formData.get('unit'),
                    currentStock: parseInt(formData.get('currentStock')) || 0,
                    minimumLevel: parseInt(formData.get('minimumLevel')) || 0,
                    location: formData.get('location') || '',
                    orderId: formData.get('orderId') || null
                };

                const { id, error } = await Inventory.addInventoryItem(itemData);
                if (error) throw new Error(error);

                // If it's a tool and has a photo selected
                const photoInput = document.getElementById('inv-photo-input');
                if (itemData.category === 'Tool' && photoInput.files[0]) {
                    submitBtn.innerHTML = "Uploading Photo...";
                    const photoResult = await Inventory.uploadToolPhoto(id, photoInput.files[0]);
                    if (photoResult.error) {
                        alert("Item saved, but photo upload failed: " + photoResult.error);
                    }
                }
            }

            window.adminApp.closeModal('add-inventory-modal');
        } catch (err) {
            alert("Failed to save item: " + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    },

    openAdjustStockModal: (itemId) => {
        const item = currentInventory.find(i => i.id === itemId);
        if (!item) return;

        const form = document.getElementById('adjust-stock-form');
        if (form) {
            form.reset();
            // Set default price from item
            const priceInput = form.querySelector('input[name="price"]');
            if (priceInput) priceInput.value = item.price || 0;
        }

        document.getElementById('adjust-item-id').value = item.id;
        document.getElementById('adjust-item-name').value = item.name;
        document.getElementById('adjust-item-name-text').textContent = item.name;
        document.getElementById('adjust-current-stock-text').textContent = `${item.currentStock} ${item.unit}`;

        // Populate Order ID dropdown
        const orderSelect = document.getElementById('adjust-project-select');
        if (orderSelect) {
            const internalOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
            orderSelect.innerHTML = '<option value="">-- No Order ID --</option>' +
                internalOrders.map(o => {
                    const id = o.internalOrderNo || o.id;
                    return `<option value="${id}">${id} - ${o.customer || 'Order'}</option>`;
                }).join('');
        }

        // Hide project section by default (only for OUT)
        document.getElementById('adjust-project-section').classList.add('hidden');

        window.adminApp.openModal('adjust-stock-modal');
    },

    onStockActionChange: (action) => {
        const projectSection = document.getElementById('adjust-project-section');
        if (projectSection) {
            if (action === 'OUT') {
                projectSection.classList.remove('hidden');
            } else {
                projectSection.classList.add('hidden');
            }
        }
    },

    handleAdjustStock: async (event) => {
        event.preventDefault();
        const formData = new FormData(event.target);

        const itemId = formData.get('itemId');
        const itemName = formData.get('itemName');
        const type = formData.get('type');
        const quantity = parseInt(formData.get('quantity'));
        const reason = formData.get('reason');
        const orderId = formData.get('orderId'); // Renamed from projectId
        const unitPrice = parseFloat(formData.get('price')) || 0;
        const performedBy = formData.get('performedBy') || 'Admin';

        const submitBtn = document.getElementById('adjust-stock-submit');
        const originalText = submitBtn.innerHTML;

        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = "Updating...";

            // Get category for transaction record
            const item = currentInventory.find(i => i.id === itemId);
            const category = item ? (item.category || 'General') : 'General';

            const result = await Inventory.updateStock(itemId, itemName, type, quantity, reason, orderId, unitPrice, performedBy, category);
            if (!result.success) throw new Error(result.error);

            window.adminApp.closeModal('adjust-stock-modal');
        } catch (err) {
            alert("Update failed: " + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    },

    switchInventoryTab: (tab) => {
        currentInventoryTab = tab;
        const masterView = document.getElementById('subview-inventory-master');
        const ledgerView = document.getElementById('subview-inventory-ledger');
        const masterTabs = document.querySelectorAll('#tab-inventory-master');
        const ledgerTabs = document.querySelectorAll('#tab-inventory-ledger');
        const masterActions = document.getElementById('inventory-master-actions');
        const ledgerActions = document.getElementById('inventory-ledger-actions');

        if (tab === 'master') {
            masterView.classList.remove('hidden');
            ledgerView.classList.add('hidden');
            masterTabs.forEach(t => t.classList.add('active'));
            ledgerTabs.forEach(t => t.classList.remove('active'));
            masterActions.classList.remove('hidden');
            ledgerActions.classList.add('hidden');
        } else {
            masterView.classList.add('hidden');
            ledgerView.classList.remove('hidden');
            masterTabs.forEach(t => t.classList.remove('active'));
            ledgerTabs.forEach(t => t.classList.add('active'));
            masterActions.classList.add('hidden');
            ledgerActions.classList.remove('hidden');
            window.adminApp.loadInventoryTransactions();
        }

        // Apply current filters to the new tab
        window.adminApp.filterInventory();
    },

    printInventoryLedger: () => {
        const printDate = document.getElementById('ledger-print-date');
        if (printDate) printDate.textContent = new Date().toLocaleString();

        window.print();
    },

    toggleInventoryTransactions: () => {
        window.adminApp.switchInventoryTab('ledger');
    },

    loadInventoryTransactions: async () => {
        // Use a persistent listener for transactions if not already set
        if (!transactionUnsubscribe) {
            transactionUnsubscribe = Inventory.getInventoryTransactions((transactions) => {
                currentTransactions = transactions;
                window.adminApp.renderInventoryTransactions(transactions);
            });
        }
    },

    renderInventoryTransactions: (transactions) => {
        const body = document.getElementById('inventory-ledger-body');
        if (!body) return;

        if (!transactions || transactions.length === 0) {
            body.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400 italic">No transactions found.</td></tr>';
            return;
        }

        body.innerHTML = transactions.map(t => {
            const date = t.timestamp?.toDate ? t.timestamp.toDate() : (t.timestamp?.seconds ? new Date(t.timestamp.seconds * 1000) : new Date());
            const formattedDate = date.toLocaleDateString();
            const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const unitPrice = t.unitPrice || 0;
            const totalCost = t.totalCost || (t.quantity * unitPrice);
            const performedBy = t.user || t.performedBy || '-';

            return `
                <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td class="p-3">
                        <div class="text-slate-800 font-bold text-xs">${formattedDate}</div>
                        <div class="text-slate-400 text-[10px] uppercase">${formattedTime}</div>
                    </td>
                    <td class="p-3 font-medium text-slate-700">${t.itemName}</td>
                    <td class="p-3 text-slate-500 font-medium text-xs">${t.category || 'General'}</td>
                    <td class="p-3"><span class="inv-trans-type ${t.type.toLowerCase()}">${t.type}</span></td>
                    <td class="p-3 text-center font-bold ${t.type === 'IN' ? 'text-green-600' : 'text-red-600'}">${t.type === 'IN' ? '+' : '-'}${t.quantity}</td>
                    <td class="p-3 font-mono text-slate-600 text-xs">₹${unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="p-3 font-bold text-slate-800 text-xs">₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="p-3 text-slate-500 text-xs truncate max-w-[150px]" title="${t.reason || ''}">${t.reason || '-'}</td>
                    <td class="p-3 text-teal-600 font-bold text-xs">${t.orderId || '-'}</td>
                    <td class="p-3 text-slate-500 text-xs">${performedBy}</td>
                    <td class="p-3 text-center">
                        <button class="action-btn delete" onclick="window.adminApp.deleteTransactionRow('${t.id}')" title="Delete Transaction">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    deleteTransactionRow: async (txId) => {
        // Prompt for password
        const password = prompt('Enter admin password to delete this transaction:');
        if (password === null) return; // User cancelled
        if (password !== 'IES') {
            alert('❌ Incorrect password. Deletion cancelled.');
            return;
        }

        if (!confirm('Are you sure you want to delete this transaction? The stock will be reversed accordingly.')) return;

        try {
            const result = await Inventory.deleteTransaction(txId);
            if (!result.success) {
                alert('Failed to delete: ' + (result.error || 'Unknown error'));
            }
            // Real-time listener will auto-refresh the ledger
        } catch (err) {
            alert('Error deleting transaction: ' + err.message);
        }
    },

    filterInventory: () => {
        const searchTerm = document.getElementById('inv-search')?.value.toLowerCase();
        const categoryFilter = document.getElementById('inv-category-filter')?.value;
        const statusFilter = document.getElementById('inv-status-filter')?.value;

        if (currentInventoryTab === 'master') {
            let filteredItems = currentInventory.filter(item => {
                const matchesSearch = !searchTerm ||
                    item.name.toLowerCase().includes(searchTerm) ||
                    (item.location && item.location.toLowerCase().includes(searchTerm)) ||
                    (item.lastReason && item.lastReason.toLowerCase().includes(searchTerm));

                const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;

                let matchesStatus = true;
                if (statusFilter !== 'all') {
                    const isLow = item.currentStock <= item.minimumLevel;
                    if (statusFilter === 'In Stock') matchesStatus = item.currentStock > 0 && !isLow;
                    else if (statusFilter === 'Low Stock') matchesStatus = isLow && item.currentStock > 0;
                    else if (statusFilter === 'Out of Stock') matchesStatus = item.currentStock === 0;
                }

                return matchesSearch && matchesCategory && matchesStatus;
            });

            // Apply sort
            filteredItems = window.adminApp.applySortToInventory(filteredItems);
            window.adminApp.renderInventoryList(filteredItems);
        } else {
            const filteredTrans = currentTransactions.filter(t => {
                const matchesSearch = !searchTerm ||
                    t.itemName.toLowerCase().includes(searchTerm) ||
                    (t.reason && t.reason.toLowerCase().includes(searchTerm)) ||
                    (t.orderId && t.orderId.toLowerCase().includes(searchTerm));

                const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;

                return matchesSearch && matchesCategory;
            });
            window.adminApp.renderInventoryTransactions(filteredTrans);
        }
    },

    sortInventory: (column) => {
        if (inventorySortState.column === column) {
            inventorySortState.direction = inventorySortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            inventorySortState.column = column;
            inventorySortState.direction = 'asc';
        }
        window.adminApp.filterInventory();
    },

    applySortToInventory: (items) => {
        const { column, direction } = inventorySortState;
        const dir = direction === 'asc' ? 1 : -1;

        return [...items].sort((a, b) => {
            let valA, valB;
            switch (column) {
                case 'name':
                    valA = (a.name || '').toLowerCase();
                    valB = (b.name || '').toLowerCase();
                    return valA < valB ? -dir : valA > valB ? dir : 0;
                case 'category':
                    valA = (a.category || '').toLowerCase();
                    valB = (b.category || '').toLowerCase();
                    return valA < valB ? -dir : valA > valB ? dir : 0;
                case 'stock':
                    return ((a.currentStock || 0) - (b.currentStock || 0)) * dir;
                case 'status':
                    // Order: Out of Stock (0) < Low Stock (1) < In Stock (2)
                    const getStatusRank = (item) => {
                        if (item.currentStock <= 0) return 0;
                        if (item.currentStock <= item.minimumLevel) return 1;
                        return 2;
                    };
                    return (getStatusRank(a) - getStatusRank(b)) * dir;
                default:
                    return 0;
            }
        });
    },

    openPhotoViewer: (url, name) => {
        const img = document.getElementById('inventory-viewer-img');
        const title = document.getElementById('inventory-viewer-title');
        if (img) img.src = url;
        if (title) title.textContent = name || 'Item Detail';
        window.adminApp.openModal('inventory-image-viewer');
    },

    // === CONTRACT REVIEW ===
    toggleContractReview: () => {
        const section = document.getElementById('contract-review-section');
        if (section) section.classList.toggle('open');
    },

    loadContractReview: async (projectId) => {
        const project = currentProjects.find(p => p.id === projectId);
        if (!project) return;

        // Store current project ID for save
        const section = document.getElementById('contract-review-section');
        if (section) {
            section.dataset.projectId = projectId;
            section.classList.remove('open'); // Collapse on load
        }

        // Reset status
        const status = document.getElementById('cr-save-status');
        if (status) status.textContent = 'Loading...';

        // Load saved data from Firestore
        const result = await DB.getContractReview(projectId);
        let reviewData = result.data || {};

        // Auto-fill defaults if not present
        if (!reviewData.reviewNo) reviewData.reviewNo = `CR-${project.projectId || projectId}`;
        if (!reviewData.deliveryDate && project.expectedCompletion) reviewData.deliveryDate = project.expectedCompletion;
        if (!reviewData.internalDate) reviewData.internalDate = new Date().toISOString().split('T')[0];

        // Populate Header fields
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el && val) el.value = val;
        };

        setVal('cr-review-no', reviewData.reviewNo);
        setVal('cr-internal-date', reviewData.internalDate);
        setVal('cr-po-no', reviewData.poNo);
        setVal('cr-delivery-date', reviewData.deliveryDate);
        setVal('cr-important-instructions', reviewData.importantInstructions);

        // Map old checklist format to new dynamic format if needed
        let mappedChecklist = reviewData.checklistDynamic || {};

        if (reviewData.checklist && Object.keys(mappedChecklist).length === 0) {
            // Migration/fallback from old structure - optional based on how data was saved previously
            // Assuming legacy items might need manual re-mapping if important, else start fresh
        }

        // Render the dynamic checklist grid with current data mapping
        window.adminApp.renderContractReview(mappedChecklist);

        if (status) {
            status.textContent = result.data ? '✓ Loaded from saved review' : '';
            setTimeout(() => { if (status) status.textContent = ''; }, 3000);
        }
    },



    printContractReview: () => {
        const section = document.getElementById('contract-review-section');
        if (section) section.classList.add('open');
        // Populate print header date
        const printDate = document.getElementById('cr-print-date');
        if (printDate) {
            printDate.textContent = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        }
        setTimeout(() => window.print(), 200);
    },

    renderProjectCards: (projects) => {
        const grid = document.getElementById('project-grid');
        const listView = document.getElementById('project-list-view');
        if (!grid || !listView) return;

        const mode = window.adminApp.projectViewMode || 'grid';

        if (mode === 'list') {
            grid.classList.add('hidden');
            listView.classList.remove('hidden');
            window.adminApp.renderProjectTable(projects);
            return;
        } else {
            grid.classList.remove('hidden');
            listView.classList.add('hidden');
        }

        if (projects.length === 0) {
            const msg = isProjectTrashView ? 'Trash is empty.' : 'No projects found matching your filters.';
            const sub = isProjectTrashView ? 'Deleted projects will appear here.' : 'Try adjusting your search or create a new project.';
            grid.innerHTML = `
                <div class="pm-empty-state">
                    <div class="pm-empty-icon">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                    </div>
                    <div class="pm-empty-title">${msg}</div>
                    <div class="pm-empty-text">${sub}</div>
                </div>
            `;
            return;
        }

        grid.innerHTML = projects.map(p => {
            const rawStatus = p.status || 'Draft';
            const statusClass = rawStatus.toLowerCase().replace(/\s+/g, '-');
            const statusSlug = `st-${statusClass}`;
            const isTrashed = !!p.isDeleted;
            const startDate = p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'N/A';
            const deliveryDate = p.expectedCompletion ? new Date(p.expectedCompletion).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'N/A';

            const isContractFiled = p.contractFiled || ['Approved', 'In Progress', 'Completed'].includes(p.status);
            const contractStatusHtml = isContractFiled ?
                '<span class="pm-c-contract-val"><svg style="width:13px;height:13px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" /></svg> Filed</span>' :
                `<span class="pm-c-contract-val pending">${rawStatus}</span>`;

            // NEW: Fetch Drawing Number from Internal Order if missing on project
            const allOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
            const matchingOrder = allOrders.find(o => o.internalOrderNo === p.projectId);
            const displayDrg = p.drawingNo || (matchingOrder ? matchingOrder.drawingNo : '');

            const actionButtons = isTrashed ? `
                <button class="pm-c-icon-btn" onclick="event.stopPropagation(); window.adminApp.restoreProject('${p.id}')" title="Restore">
                    <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                </button>
                <button class="pm-c-icon-btn trash" onclick="event.stopPropagation(); window.adminApp.permanentDeleteProject('${p.id}')" title="Delete Permanently">
                    <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            ` : `
                <button class="pm-c-icon-btn" onclick="event.stopPropagation(); window.adminApp.editProject('${p.id}')" title="Edit">
                    <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                <button class="pm-c-icon-btn trash" onclick="event.stopPropagation(); window.adminApp.trashProject('${p.id}')" title="Trash">
                    <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
            `;

            return `
                <div class="pm-card-compact ${statusSlug} ${isTrashed ? 'trashed' : ''}">
                    <div class="pm-c-accent ${statusClass}"></div>
                    <div class="pm-c-body">
                        <div class="pm-c-header">
                            <div class="pm-c-title-group">
                                <span class="pm-c-title">${p.name}</span>
                                <span class="pm-c-subtitle">${p.customerName || 'N/A'}</span>
                            </div>
                            <div class="pm-c-id-group">
                                <span class="pm-c-id-pill">${p.projectId}</span>
                                ${displayDrg ? `<span class="pm-c-drg">DRG: ${displayDrg}</span>` : ''}
                            </div>
                        </div>
                        <div class="pm-c-status-row">
                            <span class="pm-c-label">Status</span>
                            <span class="status-badge ${statusClass}">${p.status || 'Draft'}</span>
                            ${p.jobType ? `<span class="pm-c-type-badge">${p.jobType}</span>` : ''}
                        </div>
                    </div>
                    <div class="pm-c-dates">
                        <div class="pm-c-date-cell">
                            <span class="pm-c-label">Start Date</span>
                            <span class="pm-c-value">${startDate}</span>
                        </div>
                        <div class="pm-c-date-cell">
                            <span class="pm-c-label">Delivery</span>
                            <span class="pm-c-value">${deliveryDate}</span>
                        </div>
                    </div>
                    <div class="pm-c-footer">
                        <div class="pm-c-contract-status">
                            <span class="pm-c-label">Contract</span>
                            ${contractStatusHtml}
                        </div>
                        <div class="pm-c-actions">
                            ${actionButtons}
                            <button class="pm-c-primary-btn" onclick="event.stopPropagation(); window.adminApp.viewProjectDetails('${p.id}')">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                                View Report
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    getStatusColorClass: (status) => {
        switch (status) {
            case 'Draft': return 'border-slate-300';
            case 'Under Review': return 'border-amber-400';
            case 'Approved': return 'border-blue-500';
            case 'In Progress': return 'border-teal-500';
            case 'Completed': return 'border-emerald-600';
            default: return 'border-slate-200';
        }
    },

    viewProjectDetails: async (id) => {
        window.adminApp.currentEditingProjectId = id;
        const project = currentProjects.find(p => p.id === id);
        if (!project) return;

        window.adminApp.switchView('project_detail');
        window.adminApp.switchDeepDiveTab('review');

        // Populate Basic Info
        const idDisplay = document.getElementById('detail-project-id');
        const nameDisplay = document.getElementById('detail-project-name');
        const statusDisplay = document.getElementById('detail-project-status');

        if (idDisplay) idDisplay.textContent = project.projectId;
        if (nameDisplay) nameDisplay.textContent = project.name;
        if (statusDisplay) {
            const span = statusDisplay.querySelector('span');
            if (span) span.textContent = project.status || 'Draft';
            const statusCls = (project.status || 'Draft').toLowerCase().replace(/\s+/g, '-');
            statusDisplay.className = `status-badge ${statusCls} flex items-center gap-1 group`;
        }

        // Side Info
        const infoCustomer = document.getElementById('info-customer');
        const infoJobType = document.getElementById('info-job-type');
        const infoDrgSource = document.getElementById('info-drg-source');
        const infoExpectedDate = document.getElementById('info-expected-date');
        const infoNotes = document.getElementById('info-notes');

        if (infoCustomer) infoCustomer.textContent = project.customerName || '-';
        if (infoJobType) infoJobType.textContent = project.jobType || '-';
        if (infoDrgSource) infoDrgSource.textContent = project.drawingSource || '-';
        if (infoExpectedDate) infoExpectedDate.textContent = project.expectedCompletion || 'Not Set';
        if (infoNotes) infoNotes.textContent = project.internalNotes || 'No internal notes.';



        // Subscribe to Project Sub-collections (Files & Logs)
        DB.subscribeToProjectFiles(id, (files) => {
            window.adminApp.renderProjectFiles(files);
        });

        DB.subscribeToProjectAuditLogs(id, (logs) => {
            window.adminApp.renderProjectAuditLogs(logs);
        });

        // Load Contract Review form for this project
        window.adminApp.loadContractReview(id);

        // Load Costing Data
        window.adminApp.loadProjectCosting(id, project.projectId);
    },

    renderProgressDots: (project) => {
        const stages = ['Intake', 'Planning', 'Design', 'Production', 'Quality', 'Delivery', 'Closure'];
        const currentIdx = stages.indexOf(project.currentStage);
        const container = document.getElementById('dd-progress-dots');
        if (!container) return;

        let html = '';
        stages.forEach((stage, idx) => {
            if (idx > 0) {
                html += `<span class="dd-dot-line ${idx <= currentIdx ? 'completed' : ''}"></span>`;
            }
            let cls = 'dd-dot';
            if (idx === currentIdx) cls += ' active';
            else if (idx < currentIdx) cls += ' completed';
            html += `<span class="${cls}" title="${stage}"></span>`;
        });
        container.innerHTML = html;
    },

    switchDeepDiveTab: (tabName) => {
        // Update tab buttons
        document.querySelectorAll('.dd-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabName);
        });
        // Update panels
        document.querySelectorAll('.dd-panel').forEach(p => {
            p.classList.toggle('active', p.id === `dd-panel-${tabName}`);
        });

        // Trigger refresh for specific tabs
        if (tabName === 'costing') {
            const currentId = window.adminApp.currentEditingProjectId;
            const project = currentProjects.find(p => p.id === currentId);
            if (project) {
                window.adminApp.loadProjectCosting(currentId, project.projectId);
            }
        }
    },

    renderStageAction: (project) => {
        const stages = {
            'Intake': {
                description: 'Review initial metadata and drawing source requirements.',
                buttons: [
                    { label: 'Submit for Planning', class: 'btn-primary', action: `window.adminApp.transitionStage('${project.id}', 'Planning')` }
                ]
            },
            'Planning': {
                description: 'Define timelines, resources, and production strategy.',
                buttons: [
                    { label: 'Request Design Approval', class: 'btn-primary', action: `window.adminApp.submitApprovalRequest('${project.id}', 'Planning')` }
                ]
            },
            'Design': {
                description: 'Complete engineering designs and release drawings for production.',
                buttons: [
                    { label: 'Submit for Production', class: 'btn-primary', action: `window.adminApp.transitionStage('${project.id}', 'Production')` }
                ]
            },
            'Production': {
                description: 'Manufacturing phase. Track shop floor progress and machine utilization.',
                buttons: [
                    { label: 'Mark Production Complete', class: 'btn-primary', action: `window.adminApp.transitionStage('${project.id}', 'Quality')` }
                ]
            },
            'Quality': {
                description: 'Post-production inspection and regulatory compliance checks.',
                buttons: [
                    { label: 'Pass Quality Check', class: 'btn-primary', action: `window.adminApp.transitionStage('${project.id}', 'Delivery')` }
                ]
            },
            'Delivery': {
                description: 'Packaging, logistics, and customer handover.',
                buttons: [
                    { label: 'Mark as Delivered', class: 'btn-primary', action: `window.adminApp.transitionStage('${project.id}', 'Closure')` }
                ]
            },
            'Closure': {
                description: 'Final audit, documentation filing, and project completion.',
                buttons: [
                    { label: 'Close Project', class: 'btn-primary', action: `window.adminApp.completeProject('${project.id}')` }
                ]
            }
        };

        const config = stages[project.currentStage] || stages['Intake'];

        const stagePill = document.getElementById('dd-stage-pill');
        const stageDesc = document.getElementById('dd-stage-desc');
        const stageActions = document.getElementById('dd-stage-actions');

        if (stagePill) stagePill.textContent = project.currentStage;
        if (stageDesc) stageDesc.textContent = config.description;
        if (stageActions) {
            stageActions.innerHTML = config.buttons.map(btn => `
                <button class="btn ${btn.class} btn-sm" onclick="${btn.action}">${btn.label}</button>
            `).join('');
        }
    },

    transitionStage: async (projectId, nextStage) => {
        const result = await DB.updateProject(projectId, { currentStage: nextStage }, `Transitioned to ${nextStage}`);
        if (result.error) {
            alert('Error transitioning stage: ' + result.error);
        } else {
            // Re-render handled by real-time subscription
        }
    },

    renderProjectFiles: (files) => {
        const body = document.getElementById('project-files-body');
        if (!body) return;

        if (files.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400 italic">No files uploaded yet.</td></tr>';
            return;
        }

        body.innerHTML = files.map(f => `
            <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                <td class="p-3 font-medium text-slate-700">${f.name}</td>
                <td class="p-3 text-slate-500">${f.category}</td>
                <td class="p-3 text-center"><span class="version-tag">v${f.version}</span></td>
                <td class="p-3 text-slate-500">${f.uploadedBy || 'System'}</td>
                <td class="p-3 text-right">
                    <div class="flex justify-end gap-1">
                        <button class="btn btn-ghost btn-sm text-teal-600" onclick="window.open('${f.url}')">View</button>
                        <button class="btn btn-ghost btn-sm text-rose-500" onclick="window.adminApp.confirmDeleteFile('${f.id}', '${f.url}')">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    renderProjectAuditLogs: (logs) => {
        const container = document.getElementById('audit-log-container');
        if (!container) return;

        if (logs.length === 0) {
            container.innerHTML = '<div class="text-center py-4 text-slate-400 italic">No audit history found.</div>';
            return;
        }

        container.innerHTML = logs.map(l => {
            const date = l.timestamp?.toDate ? l.timestamp.toDate() : new Date();
            const timeStr = date.toLocaleDateString() + ' • ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return `
                <div class="dd-timeline-item">
                    <div class="dd-timeline-title">${l.action}</div>
                    <div class="dd-timeline-desc">${l.details}</div>
                    <div class="dd-timeline-time">${timeStr} by ${l.user || 'System'}</div>
                </div>
            `;
        }).join('');
    },

    moveProject: async (projectId, newStatus) => {
        const result = await DB.updateProjectStatus(projectId, newStatus);
        if (result.error) {
            alert('Error moving project: ' + result.error);
        } else {
            const isMilestone = ['Approved', 'In Progress', 'Completed'].includes(newStatus);
            const detail = `Status moved to ${newStatus}${isMilestone ? ' (Contract Auto-filed)' : ''}`;
            await DB.addAuditLog(projectId, 'Status Updated', detail);
        }
    },

    deleteProject: (projectId) => {
        window.adminApp.trashProject(projectId);
    },

    openAddOrderModal: () => {
        window.adminApp.openModal('add-order-modal');
    },

    toggleStatusMenu: (e) => {
        e.stopPropagation();
        const menu = document.getElementById('dd-status-menu');
        if (menu) menu.classList.toggle('hidden');
    },

    updateProjectStatus: async (newStatus) => {
        const id = window.adminApp.currentEditingProjectId;
        if (!id) return;

        const result = await DB.updateProjectStatus(id, newStatus);
        if (result.error) {
            alert('Error updating status: ' + result.error);
        } else {
            // UI update for badge
            const statusDisplay = document.getElementById('detail-project-status');
            if (statusDisplay) {
                const span = statusDisplay.querySelector('span');
                if (span) span.textContent = newStatus;
                statusDisplay.className = `status-badge ${newStatus.toLowerCase().replace(/\s+/g, '-')} flex items-center gap-1 group`;
            }
            const menu = document.getElementById('dd-status-menu');
            if (menu) menu.classList.add('hidden');

            // Audit Log
            const isMilestone = ['Approved', 'In Progress', 'Completed'].includes(newStatus);
            const detail = `Status changed to ${newStatus}${isMilestone ? ' (Contract Auto-filed)' : ''}`;
            await DB.addAuditLog(id, 'Status Updated', detail);
        }
    },

    prepareAddOrder: () => {
        const form = document.getElementById('add-order-form');
        if (form) form.reset();
        const hidden = document.getElementById('orderId-input');
        if (hidden) hidden.value = '';

        // NEW: Clear breakdown table and summary stats for new orders
        const breakdownBody = document.getElementById('io-delivery-breakdown-body');
        if (breakdownBody) {
            breakdownBody.innerHTML = '<tr><td colspan="4" style="padding: 1.5rem; text-align: center; color: #94a3b8; font-style: italic;">No delivery records found for this order.</td></tr>';
        }

        // Clear summary stats
        const totalDelEl = document.getElementById('io-total-delivered');
        const pendingQtyEl = document.getElementById('io-pending-qty');
        const derivedStatusEl = document.getElementById('io-derived-status');
        if (totalDelEl) totalDelEl.textContent = '0';
        if (pendingQtyEl) pendingQtyEl.textContent = '0';
        if (derivedStatusEl) {
            derivedStatusEl.textContent = 'Pending';
            derivedStatusEl.className = 'status-badge status-pending';
        }

        // Reset order status display and hidden field
        const statusDisplay = document.getElementById('order-status-display');
        const statusHidden = form ? form.querySelector('[name="status"]') : null;
        if (statusDisplay) statusDisplay.value = '🟡 Pending';
        if (statusHidden) statusHidden.value = 'Pending';

        // Set default date to today
        const dateInput = form.querySelector('[name="date"]');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }

        // Auto-generate next Order ID (YYYYYY-NNN)
        const now = new Date();
        const yr = now.getFullYear();
        const mo = now.getMonth(); // 0-indexed
        // Financial year: April (month 3) to March
        const fyStart = mo >= 3 ? yr : yr - 1;
        const fyEnd = fyStart + 1;
        // e.g. 2025-2026 → "202526-"
        const prefix = `${fyStart}${String(fyEnd).slice(-2)}-`;
        let maxNum = 0;
        currentOrders.forEach(o => {
            const io = o.internalOrderNo || '';
            if (io.startsWith(prefix)) {
                const num = parseInt(io.replace(prefix, ''), 10);
                if (!isNaN(num) && num > maxNum) maxNum = num;
            }
        });
        const nextNum = String(maxNum + 1).padStart(3, '0');
        const orderNoInput = form.querySelector('[name="internalOrderNo"]');
        if (orderNoInput) orderNoInput.value = `${prefix}${nextNum}`;

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
    openAddDeliveryModal: (existingOrder = null) => {
        const form = document.getElementById('add-delivery-form');
        if (form) form.reset();

        const hidden = document.getElementById('delivery-orderId-input');
        if (hidden) hidden.value = existingOrder ? existingOrder.id : '';

        // Clear/Populate the IO lookup field
        const ioLookup = document.getElementById('delivery-io-lookup');
        if (ioLookup) {
            ioLookup.value = existingOrder ? (existingOrder.internalOrderNo || '') : '';
        }

        // Initialize DC Rows
        const container = document.getElementById('dc-rows-container');
        if (container) {
            container.innerHTML = '';
            if (existingOrder) {
                // For editing, show the existing DC data in the first row
                window.adminApp.addDCRow(existingOrder.dcNo, existingOrder.deliveryDateActual || existingOrder.date, existingOrder.deliveryQty || existingOrder.qty, existingOrder.total || '');
            } else {
                // For new delivery, add one default empty row
                window.adminApp.addDCRow();
            }
        }

        // Populate datalist with all active/delivered IO numbers for autocomplete
        const datalist = document.getElementById('delivery-io-suggestions');
        if (datalist) {
            const activeOrders = currentOrders.filter(o =>
                (o.status === 'Pending' || o.status === 'Partially Delivered' || o.status === 'Delivered' || (existingOrder && o.internalOrderNo === existingOrder.internalOrderNo)) &&
                o.internalOrderNo &&
                (!o.entryType || o.entryType !== 'delivery_report')
            );
            datalist.innerHTML = activeOrders.map(o =>
                `<option value="${o.internalOrderNo}">${o.customer || ''} - ${o.description || ''} (${o.status})</option>`
            ).join('');
        }

        if (existingOrder) {
            // Populate fields directly if editing
            const setVal = (name, val) => {
                const el = form.querySelector(`[name="${name}"]`);
                if (el) el.value = val !== undefined && val !== null ? val : '';
            };
            setVal('customer', existingOrder.customer);
            setVal('description', existingOrder.description);
            setVal('drawingNo', existingOrder.drawingNo);
            setVal('department', existingOrder.department);
            setVal('labourCost', existingOrder.labourCost || 0);
            setVal('manpower', existingOrder.manpower || '');
            setVal('qtyUnit', existingOrder.qtyUnit || 'Nos');
            
            const prodValEl = document.getElementById('delivery-prodValue-input');
            if (prodValEl) {
                let cost = parseFloat(existingOrder.prodValueEa) || 0;
                // If historical entry lacks cost, try to lookup from original IO
                if (cost === 0 && existingOrder.internalOrderNo) {
                    const original = currentOrders.find(o => 
                        o.internalOrderNo && 
                        o.internalOrderNo.trim().toUpperCase() === existingOrder.internalOrderNo.trim().toUpperCase() && 
                        (!o.entryType || o.entryType !== 'delivery_report')
                    );
                    if (original) {
                        cost = parseFloat(original.prodValueEa) || 0;
                    }
                }
                prodValEl.value = cost;
            }

            // Set main date field to match existing order's main date if none in first DC
            const dateInput = form.querySelector('[name="date"]');
            if (dateInput) dateInput.value = existingOrder.date || new Date().toISOString().split('T')[0];
        } else {
            const dateInput = form.querySelector('[name="date"]');
            if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
        }

        window.adminApp.openModal('add-delivery-modal');
    },

    addDCRow: (dcNo = '', date = '', qty = '', value = '') => {
        const container = document.getElementById('dc-rows-container');
        if (!container) return;

        const dateVal = date || new Date().toISOString().split('T')[0];
        const tr = document.createElement('tr');
        tr.className = 'dc-row';
        tr.innerHTML = `
            <td style="padding: 4px;"><input type="text" name="dcNo_row" class="form-input" placeholder="DC #" value="${dcNo}"></td>
            <td style="padding: 4px;"><input type="date" name="dcDate_row" class="form-input" value="${dateVal}"></td>
            <td style="padding: 4px;"><input type="number" name="dcQty_row" class="form-input" style="text-align: right;" min="0" value="${qty}"></td>
            <td style="padding: 4px;"><input type="number" name="dcVal_row" class="form-input" style="text-align: right;" min="0" step="0.01" value="${value}" placeholder="₹"></td>
            <td style="padding: 4px; text-align: center;">
                <button type="button" class="action-btn delete" onclick="window.adminApp.removeDCRow(this)" title="Remove Row">
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </td>
        `;
        container.appendChild(tr);

        // Add Auto-calculation Listener
        const qtyInp = tr.querySelector('[name="dcQty_row"]');
        const valInp = tr.querySelector('[name="dcVal_row"]');
        if (qtyInp && valInp) {
            qtyInp.addEventListener('input', () => {
                const prodVal = parseFloat(document.getElementById('delivery-prodValue-input')?.value) || 0;
                const qty = parseFloat(qtyInp.value) || 0;
                valInp.value = (prodVal * qty).toFixed(2);
            });
        }
    },

    removeDCRow: (btn) => {
        const container = document.getElementById('dc-rows-container');
        if (!container) return;
        if (container.children.length > 1) {
            btn.closest('tr').remove();
        } else {
            // Keep at least one row, just clear it
            const row = container.querySelector('tr');
            row.querySelectorAll('input').forEach(i => i.value = (i.type === 'date' ? new Date().toISOString().split('T')[0] : ''));
        }
    },

    // Lookup: Auto-fill delivery form from an existing Internal Order
    lookupOrderForDelivery: (ioNo) => {
        if (!ioNo || !ioNo.trim()) return;
        const searchVal = ioNo.trim().toLowerCase();
        
        // Find order case-insensitive and excluding delivery reports
        const order = currentOrders.find(o => 
            o.internalOrderNo && 
            o.internalOrderNo.trim().toLowerCase() === searchVal &&
            (!o.entryType || o.entryType !== 'delivery_report')
        );
        
        if (!order) return;

        const form = document.getElementById('add-delivery-form');
        if (!form) return;

        // Auto-fill fields
        const setVal = (name, val) => {
            const el = form.querySelector(`[name="${name}"]`);
            if (el && val !== undefined) el.value = val;
        };

        setVal('customer', order.customer);
        setVal('description', order.description);
        setVal('drawingNo', order.drawingNo);
        setVal('qtyUnit', order.qtyUnit);
        setVal('department', order.department);

        const prodValEl = document.getElementById('delivery-prodValue-input');
        if (prodValEl) {
            // Strictly use Production Cost Value as per user request
            const pVal = parseFloat(order.prodValueEa) || 0;
            prodValEl.value = pVal;

            // Force recalculate all DC rows
            const rows = document.querySelectorAll('#dc-rows-container .dc-row');
            rows.forEach(row => {
                const qInp = row.querySelector('[name="dcQty_row"]');
                const vInp = row.querySelector('[name="dcVal_row"]');
                if (qInp && vInp) {
                    const q = parseFloat(qInp.value) || 0;
                    vInp.value = (pVal * q).toFixed(2);
                }
            });
        }
    },

    submitDeliveryForm: async () => {
        const form = document.getElementById('add-delivery-form');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const formData = new FormData(form);
        const orderId = formData.get('orderId');

        // Collect DC Rows
        const dcRows = [];
        const container = document.getElementById('dc-rows-container');
        if (container) {
            container.querySelectorAll('tr').forEach(tr => {
                const dcNo = tr.querySelector('[name="dcNo_row"]')?.value.trim();
                const dcDate = tr.querySelector('[name="dcDate_row"]')?.value;
                const dcQty = parseFloat(tr.querySelector('[name="dcQty_row"]')?.value) || 0;
                const dcVal = parseFloat(tr.querySelector('[name="dcVal_row"]')?.value) || 0;

                if (dcNo || dcQty > 0) {
                    dcRows.push({ dcNo, dcDate, dcQty, dcVal });
                }
            });
        }

        if (dcRows.length === 0) {
            alert("Please add at least one DC entry (DC Number or Quantity).");
            return;
        }

        const baseData = {
            date: formData.get('date'),
            customer: formData.get('customer'),
            drawingNo: formData.get('drawingNo') || '',
            description: formData.get('description') || '',
            internalOrderNo: formData.get('internalOrderNo')?.trim() || '',
            department: formData.get('department') || '',
            labourCost: parseFloat(formData.get('labourCost')) || 0,
            manpower: parseFloat(formData.get('manpower')) || 0,
            qtyUnit: formData.get('qtyUnit') || 'Nos',
            status: 'Delivered',
            entryType: 'delivery_report',
            saleValueEa: parseFloat(formData.get('saleValueEa')) || 0,
            prodValueEa: parseFloat(formData.get('prodValueEa')) || 0,
            priority: 'Medium',
            drgAvail: 'n',
            rawAvail: 'n',
            finishAvail: 'n'
        };

        // If editing an existing entry, we'll update the first DC's document
        // and potentially create NEW ones for the rest.
        // Simplified approach: For "Editing", user should probably edit individual entries from the report.
        // But since they can add multiple here, we handle the first one as update if ID exists.

        try {
            for (let i = 0; i < dcRows.length; i++) {
                const row = dcRows[i];
                const entryData = {
                    ...baseData,
                    dcNo: row.dcNo,
                    deliveryDateActual: row.dcDate,
                    deliveryQty: row.dcQty,
                    qty: row.dcQty, // Keep qty same for compatibility
                    total: row.dcVal
                };

                // If editing (orderId exists), only the FIRST row updates the original doc.
                // Subsequential rows are added as new documents.
                if (orderId && i === 0) {
                    await DB.updateOrder(orderId, entryData);
                } else {
                    await DB.addOrder(entryData);
                }
            }

            // Sync with Internal Order
            if (baseData.internalOrderNo) {
                const ioNo = baseData.internalOrderNo;
                const originalOrder = currentOrders.find(o =>
                    o.internalOrderNo === ioNo && (!o.entryType || o.entryType !== 'delivery_report')
                );

                if (originalOrder) {
                    // Refetch/Re-calculate all deliveries for this IO
                    // Since DB.addOrder is async, it might take a moment to reflect in state.
                    // However, current system relies on real-time snapshots, so currentOrders *should* update.
                    // To be safe, we calculate based on what we just sent + current state.

                    const existingDeliveries = currentOrders.filter(o =>
                        o.entryType === 'delivery_report' &&
                        o.internalOrderNo === ioNo &&
                        o.id !== orderId
                    );

                    const totalDelivered = existingDeliveries.reduce((sum, o) => sum + (parseFloat(o.deliveryQty) || 0), 0) +
                        dcRows.reduce((sum, r) => sum + r.dcQty, 0);

                    let allDCs = existingDeliveries.map(o => o.dcNo?.trim()).filter(dc => dc);
                    dcRows.forEach(r => {
                        if (r.dcNo && !allDCs.includes(r.dcNo)) allDCs.push(r.dcNo);
                    });
                    const pooledDCs = allDCs.join(', ');

                    const orderedQty = parseFloat(originalOrder.qty) || 0;
                    let newStatus = 'Pending';
                    if (totalDelivered >= orderedQty && orderedQty > 0) newStatus = 'Delivered';
                    else if (totalDelivered > 0) newStatus = 'Partially Delivered';

                    await DB.updateOrder(originalOrder.id, {
                        deliveryQty: totalDelivered,
                        dcNo: pooledDCs,
                        status: newStatus
                    });
                }
            }

            window.adminApp.closeModal('add-delivery-modal');
        } catch (err) {
            alert('Error: ' + err.message);
        }
    },

    submitApprovalRequest: async (projectId, stage) => {
        const result = await DB.submitApproval(projectId, stage, {
            status: 'Approved', // For now, auto-approving or just recording
            approver: 'Admin',
            notes: `Auto-approved for ${stage} gate.`
        });

        if (result.error) {
            alert('Approval error: ' + result.error);
        } else {
            // Transition to next stage automatically if approved
            const stages = ['Intake', 'Planning', 'Design', 'Production', 'Quality', 'Delivery', 'Closure'];
            const currentIdx = stages.indexOf(stage);
            if (currentIdx < stages.length - 1) {
                window.adminApp.transitionStage(projectId, stages[currentIdx + 1]);
            }
        }
    },

    completeProject: async (projectId) => {
        const result = await DB.updateProject(projectId, {
            status: 'Completed',
            progress: 100
        }, 'Project marked as Completed.');

        if (result.error) {
            alert('Error completing project: ' + result.error);
        }
    },

    lockProject: async (projectId) => {
        const project = currentProjects.find(p => p.id === projectId);
        const newLockState = !project.isLocked;

        const result = await DB.updateProject(projectId, { isLocked: newLockState }, newLockState ? 'Project Locked' : 'Project Unlocked');
        if (result.error) {
            alert('Error locking/unlocking project: ' + result.error);
        }
    },

    openProjectSettings: () => {
        alert('Project Settings coming soon!');
    },

    openUploadModal: () => {
        const fileInput = document.getElementById('project-file-input');
        if (fileInput) fileInput.click();
    },

    handleFileSelection: async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Validation: 500KB limit
        const maxSize = 500 * 1024; // 500KB
        if (file.size > maxSize) {
            alert(`File is too large (${(file.size / 1024).toFixed(1)}KB). Max size is 500KB.`);
            event.target.value = '';
            return;
        }

        const projectIdText = document.getElementById('detail-project-id')?.textContent;
        // Search in currentProjects for the project with that ID
        const activeProject = currentProjects.find(p => p.projectId === projectIdText);

        if (!activeProject) {
            alert("Error: Active project context not found.");
            return;
        }

        const uploadBtn = event.target.parentElement.querySelector('button');
        const originalHtml = uploadBtn ? uploadBtn.innerHTML : 'Upload';

        try {
            if (uploadBtn) {
                uploadBtn.disabled = true;
                uploadBtn.innerHTML = "Uploading...";
            }

            const result = await DB.uploadProjectFile(activeProject.id, file, 'Admin');

            if (result.error) {
                alert("Upload failed: " + result.error);
            }
        } catch (error) {
            console.error("Upload Error:", error);
            alert("Upload failed: " + error.message);
        } finally {
            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.innerHTML = originalHtml;
            }
            event.target.value = '';
        }
    },

    confirmDeleteFile: async (fileId, fileUrl) => {
        if (!confirm("Are you sure you want to permanently delete this file? This cannot be undone.")) return;

        const projectIdText = document.getElementById('detail-project-id')?.textContent;
        const activeProject = currentProjects.find(p => p.projectId === projectIdText);

        if (!activeProject) {
            alert("Error: Active project context not found.");
            return;
        }

        try {
            const result = await DB.deleteProjectFile(activeProject.id, fileId, fileUrl);
            if (result.success) {
                // Success message or toast could go here
                console.log("File deleted successfully");
            } else {
                alert("Deletion failed: " + result.error);
            }
        } catch (error) {
            console.error("Delete Error:", error);
            alert("Deletion failed: " + error.message);
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

    toggleSidebarGroup: (header) => {
        const group = header.parentElement;
        if (group) {
            group.classList.toggle('collapsed');
        }
    },

    viewMemberWorkload: (memberId) => {
        const member = currentMembers.find(m => m.id === memberId);
        if (!member) return;

        // Filter orders assigned to this member (include all for summary stats)
        const memberTasks = currentOrders.filter(o =>
            o.assignedTo && Array.isArray(o.assignedTo) && o.assignedTo.includes(memberId) &&
            !o.isTrash && !o.deleted
        );

        UI.renderMemberWorkload(member, memberTasks);
        window.adminApp.openModal('member-workload-modal');
    },

    printMemberWorkload: () => {
        window.print();
    },

    getCurrentMembers: () => currentMembers,
    getCurrentOrders: () => currentOrders,

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
            // Use specialized delivery modal population
            window.adminApp.openAddDeliveryModal(order);
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
            const select = document.querySelector(`select[data-order-id="${id}"]`);
            if (select) {
                select.className = 'status-select ' +
                    (newStatus === 'Delivered' ? 'status-delivered' : 'status-pending');
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

    // Workflow accessors
    getCurrentMembers: () => currentMembers,
    getCurrentOrders: () => currentOrders,

    // Daily Roster
    renderWorkflowView: () => Workflow.initWorkflowView(),
    wfOpenAssignModal: () => Workflow.openAssignModal(),
    wfConfirmAssign: () => Workflow.confirmAssign(),
    wfUpdateRow: (idx, field, value) => Workflow.updateRow(idx, field, value),
    wfEditRow: (idx) => Workflow.editRow(idx),
    wfFilterTeam: (val) => Workflow.filterTeam(val),
    wfRemoveRow: (idx) => Workflow.removeRow(idx),
    wfSaveAll: () => Workflow.saveAll(),
    wfCopyPreviousDay: () => Workflow.copyPreviousDay(),
    wfPrint: () => Workflow.printWorksheet(),
    wfCalculateProdValue: () => Workflow.calculateProdValue(),

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
        const tableHtml = document.getElementById('delivery-report-table')?.outerHTML || '';
        const totalItems = document.getElementById('report-total-items')?.textContent || '0';
        const totalValue = document.getElementById('report-total-value')?.textContent || '₹0';
        const totalManpower = document.getElementById('report-total-manpower')?.textContent || '0';
        const dateRangeText = document.getElementById('delivery-week-range')?.textContent || 'Delivery Report';

        const printWindow = window.open('', '_blank');
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Delivery Report Print</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; color: #000; }
                    .header { text-align: center; margin-bottom: 20px; }
                    .header h1 { margin: 0; font-size: 24px; color: #333; }
                    .header p { margin: 5px 0; color: #666; font-weight: bold; text-transform: uppercase;}
                    .summary { display: flex; justify-content: space-around; margin-bottom: 20px; padding: 15px; background: #f8f9fa; border: 1px solid #e2e8f0; border-radius: 8px;}
                    .stat { text-align: center; }
                    .stat-label { font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: bold;}
                    .stat-value { font-size: 22px; font-weight: bold; margin-top: 5px; color: #0f172a;}
                    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; table-layout: fixed; word-wrap: break-word;}
                    th, td { border: 1px solid #cbd5e1; padding: 8px 6px; text-align: left; vertical-align: middle;}
                    th { background-color: #f1f5f9; font-weight: bold; color: #334155; text-transform: uppercase; font-size: 10px;}
                    .text-center { text-align: center; }
                    
                    /* Hide internal UI buttons and Action column */
                    .no-print, th:last-child, td:last-child { display: none !important; }
                    button, .btn { display: none !important; }

                    @media print {
                        @page { size: A4 landscape; margin: 10mm; }
                        body { padding: 0; }
                        .summary { background: #f8f9fa !important; border-color: #cbd5e1 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        th { background-color: #f1f5f9 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Delivery Report</h1>
                    <p>${dateRangeText}</p>
                </div>
                <div class="summary">
                    <div class="stat">
                        <div class="stat-label">Delivered Items</div>
                        <div class="stat-value">${totalItems}</div>
                    </div>
                    <div class="stat">
                        <div class="stat-label">Total Value</div>
                        <div class="stat-value">${totalValue}</div>
                    </div>
                    <div class="stat">
                        <div class="stat-label">Total Manpower</div>
                        <div class="stat-value">${totalManpower}</div>
                    </div>
                </div>
                ${tableHtml}
                <script>
                    window.onload = () => {
                        setTimeout(() => {
                            window.print();
                        }, 500);
                    };
                </script>
            </body>
            </html>
        `;
        printWindow.document.write(html);
        printWindow.document.close();
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
                    <td style="font-weight: 500;">${order.customer || '-'}</td>
                    <td>${order.description || '-'}</td>
                    <td><span style="font-weight: 600; color: var(--brand-600);">${order.drawingNo || '-'}</span></td>
                    <td style="font-weight: 600; text-align: center;">${order.qty || '-'}</td>
                    <td style="text-align: center;">${order.qtyUnit || '-'}</td>
                    <td>
                        <input type="date" class="table-form-input" 
                               value="${dueDateValue}"
                               onchange="window.adminApp.updateDueDate('${order.id}', this.value)"
                               title="Click to set/change due date">
                    </td>
                    <td class="assign-cell">
                        <select class="assign-dropdown" 
                                onchange="window.adminApp.updateAssignment('${order.id}', this.value)"
                                id="assign-${order.id}">
                            <option value="">+ Add</option>
                            ${memberOptions}
                        </select>
                        ${assignedList.length > 0 ? `
                        <div class="assign-chips">
                            ${assignedList.map(m => {
                const initials = m.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                return `
                                <span class="assign-chip">
                                    <span class="assign-chip-avatar">${initials}</span>
                                    <span class="assign-chip-name">${m.name}</span>
                                    <button class="assign-chip-remove" 
                                            onclick="window.adminApp.removeAssignment('${order.id}', '${m.id}')"
                                            title="Remove">×</button>
                                </span>`;
            }).join('')}
                        </div>` : ''}
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
                            <th>Customer</th>
                            <th>Description</th>
                            <th>Drg No</th>
                            <th>Qty</th>
                            <th>Unit</th>
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
                                    <td>${o.customer || '-'}</td>
                                    <td>${o.description || '-'}</td>
                                    <td>${o.drawingNo || '-'}</td>
                                    <td>${o.qty || '-'}</td>
                                    <td>${o.qtyUnit || '-'}</td>
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
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

        // 1. Active Internal Orders (Excluding delivered and trash)
        const activeOrdersSnapshot = currentOrders.filter(o =>
            o.status !== 'Delivered' && !o.deleted && o.entryType !== 'delivery_report'
        ).map(o => ({
            id: o.id || '',
            internalOrderNo: o.internalOrderNo || '',
            drawingNo: o.drawingNo || '',
            description: o.description || '',
            customer: o.customer || '',
            qty: o.qty || '',
            qtyUnit: o.qtyUnit || '',
            priority: o.priority || 'normal',
            status: o.status || 'Pending',
            estimatedCompletion: o.estimatedCompletion || ''
        }));

        // 2. Pending Assignments (Subset of active with no members assigned)
        const pendingAssignmentsSnapshot = currentOrders.filter(o =>
            o.status === 'Pending' && !o.deleted && (!o.assignedTo || o.assignedTo.length === 0)
        ).map(o => ({
            id: o.id || '',
            internalOrderNo: o.internalOrderNo || '',
            drawingNo: o.drawingNo || '',
            description: o.description || '',
            customer: o.customer || '',
            priority: o.priority || 'normal',
            estimatedCompletion: o.estimatedCompletion || ''
        }));

        // 3. Today's Delivery Report
        const deliverySnapshot = currentOrders.filter(o =>
            o.status === 'Delivered' && o.deliveryDateActual === dateStr && o.entryType === 'delivery_report'
        ).map(o => ({
            internalOrderNo: o.internalOrderNo || '',
            customer: o.customer || '',
            description: o.description || '',
            drawingNo: o.drawingNo || '',
            deliveryQty: o.deliveryQty || o.qty || 0,
            dcNo: o.dcNo || '-',
            total: o.total || 0
        }));

        // 4. Daily Roster (Today's workflow from all departments)
        const rosterData = await DB.getWorkflowsForDate(dateStr);
        const rosterSnapshot = rosterData.map(wf => ({
            department: wf.department,
            assignments: (wf.assignments || []).map(a => ({
                employeeName: a.employeeName,
                employeeNo: a.employeeNo,
                tasks: (a.tasks || []).map(t => ({
                    orderNo: t.orderNo,
                    description: t.description,
                    status: t.status,
                    workDuration: `${t.workStart || ''} to ${t.workEnd || ''}`
                }))
            })),
            notes: wf.supervisorNotes || ''
        }));

        const reportData = {
            date: dateStr,
            totalOrders: activeOrdersSnapshot.length,
            urgent: activeOrdersSnapshot.filter(o => o.priority === 'urgent').length,
            assigned: activeOrdersSnapshot.length - pendingAssignmentsSnapshot.length,
            unassigned: pendingAssignmentsSnapshot.length,
            activeOrdersSnapshot,
            pendingAssignmentsSnapshot,
            deliverySnapshot,
            rosterSnapshot,
            generatedAt: new Date().toISOString()
        };

        const result = await DB.saveReport(reportData);

        if (result.success) {
            console.log(`Report for ${dateStr} saved successfully!`);
            window.adminApp.renderReports();
        } else {
            console.error('Failed to save report: ' + (result.error || 'Unknown error'));
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
                <title>IES Groups - Daily Report - ${displayDate}</title>
                <style>
                    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #1e293b; line-height: 1.5; }
                    .header { text-align: center; border-bottom: 2px solid #0d9488; padding-bottom: 10px; margin-bottom: 20px; }
                    .header h1 { margin: 0; color: #0d9488; font-size: 24px; text-transform: uppercase; }
                    .header p { margin: 5px 0 0; color: #64748b; font-weight: bold; }
                    
                    .section-title { background: #f1f5f9; padding: 8px 12px; border-left: 4px solid #0d9488; margin: 25px 0 15px; font-size: 16px; font-bold; text-transform: uppercase; }
                    
                    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px; }
                    .stat-box { background: white; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; text-align: center; }
                    .stat-box h3 { margin: 0; font-size: 20px; color: #0d9488; }
                    .stat-box p { margin: 4px 0 0; font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: bold; }
                    
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; }
                    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; font-size: 11px; word-wrap: break-word; }
                    th { background: #f8fafc; color: #475569; font-weight: bold; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
                    
                    .badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }
                    .badge-urgent { background: #fef2f2; color: #ef4444; }
                    .badge-normal { background: #f1f5f9; color: #64748b; }
                    
                    .roster-card { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 15px; page-break-inside: avoid; }
                    .roster-header { background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 6px 12px; font-weight: bold; font-size: 12px; color: #0d9488; }
                    .roster-body { padding: 10px; }
                    
                    .footer { margin-top: 40px; font-size: 10px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 10px; }
                    @media print {
                        .page-break { page-break-before: always; }
                        body { padding: 0; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Innovative Engineering Solutions Groups</h1>
                    <p>Daily Operations Report - ${displayDate}</p>
                </div>

                <div class="summary-grid">
                    <div class="stat-box"><h3>${report.totalOrders}</h3><p>Active Orders</p></div>
                    <div class="stat-box"><h3>${report.unassigned}</h3><p>Unassigned</p></div>
                    <div class="stat-box"><h3>${report.urgent}</h3><p>Urgent Items</p></div>
                    <div class="stat-box"><h3>${report.deliverySnapshot?.length || 0}</h3><p>Items Delivered</p></div>
                </div>

                <!-- SECTION 1: DAILY ROSTER -->
                <div class="section-title">1. Daily Roster (Work Assignments)</div>
                ${(report.rosterSnapshot || []).length > 0 ? (report.rosterSnapshot || []).map(dept => `
                    <div class="roster-card">
                        <div class="roster-header">${dept.department} Division</div>
                        <div class="roster-body">
                            <table>
                                <thead>
                                    <tr>
                                        <th style="width: 25%;">Employee</th>
                                        <th style="width: 15%;">Order No</th>
                                        <th>Task Description</th>
                                        <th style="width: 15%;">Status</th>
                                        <th style="width: 15%;">Duration</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${dept.assignments.map(a => `
                                        ${a.tasks.map((t, idx) => `
                                            <tr>
                                                ${idx === 0 ? `<td rowspan="${a.tasks.length}"><strong>${a.employeeName}</strong><br><small>${a.employeeNo}</small></td>` : ''}
                                                <td>${t.orderNo || '-'}</td>
                                                <td>${t.description}</td>
                                                <td style="text-align:center;">${t.status}</td>
                                                <td style="text-align:center;">${t.workDuration}</td>
                                            </tr>
                                        `).join('')}
                                    `).join('')}
                                </tbody>
                            </table>
                            ${dept.notes ? `<p style="font-size: 11px; color: #64748b; font-style: italic;"><strong>Note:</strong> ${dept.notes}</p>` : ''}
                        </div>
                    </div>
                `).join('') : '<p style="text-align:center; color:#94a3b8; font-size:12px;">No roster data recorded for today.</p>'}

                <div class="page-break"></div>

                <!-- SECTION 2: DELIVERY REPORT -->
                <div class="section-title">2. Items Delivered Today</div>
                ${(report.deliverySnapshot || []).length > 0 ? `
                <table>
                    <thead>
                        <tr>
                            <th style="width: 12%;">Order No</th>
                            <th style="width: 20%;">Customer</th>
                            <th>Description</th>
                            <th style="width: 15%;">Drawing No</th>
                            <th style="width: 10%; text-align:right;">Qty</th>
                            <th style="width: 12%;">DC No</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${report.deliverySnapshot.map(o => `
                            <tr>
                                <td><strong>${o.internalOrderNo}</strong></td>
                                <td>${o.customer}</td>
                                <td>${o.description}</td>
                                <td>${o.drawingNo}</td>
                                <td style="text-align:right;">${o.deliveryQty}</td>
                                <td>${o.dcNo}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ` : '<p style="text-align:center; color:#94a3b8; font-size:12px;">No deliveries recorded today.</p>'}

                <!-- SECTION 3: PENDING ASSIGNMENTS -->
                <div class="section-title">3. Pending Assignments (Priority Action)</div>
                ${(report.pendingAssignmentsSnapshot || []).length > 0 ? `
                <table>
                    <thead>
                        <tr>
                            <th style="width: 10%;">Priority</th>
                            <th style="width: 15%;">Order No</th>
                            <th style="width: 20%;">Customer</th>
                            <th>Description</th>
                            <th style="width: 15%;">Target Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${report.pendingAssignmentsSnapshot.map(o => `
                            <tr>
                                <td style="text-align:center;"><span class="badge badge-${o.priority.toLowerCase()}">${o.priority.toUpperCase()}</span></td>
                                <td><strong>${o.internalOrderNo || o.id}</strong></td>
                                <td>${o.customer}</td>
                                <td>${o.description}</td>
                                <td>${o.estimatedCompletion ? new Date(o.estimatedCompletion).toLocaleDateString('en-IN') : '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ` : '<p style="text-align:center; color:#94a3b8; font-size:12px;">All pending orders have been assigned.</p>'}

                <div class="page-break"></div>

                <!-- SECTION 4: FULL INTERNAL ORDER STATUS -->
                <div class="section-title">4. Active Internal Orders (Backlog)</div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 12%;">Order No</th>
                            <th style="width: 15%;">Customer</th>
                            <th>Description</th>
                            <th style="width: 15%;">Drawing No</th>
                            <th style="width: 10%; text-align:right;">Qty</th>
                            <th style="width: 12%;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(report.activeOrdersSnapshot || []).map(o => `
                            <tr>
                                <td><strong>${o.internalOrderNo}</strong></td>
                                <td>${o.customer}</td>
                                <td>${o.description}</td>
                                <td>${o.drawingNo}</td>
                                <td style="text-align:right;">${o.qty} ${o.qtyUnit}</td>
                                <td style="text-align:center;"><span class="badge badge-normal">${o.status}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="footer">
                    Report generated on ${new Date(report.generatedAt).toLocaleString('en-IN')} | IES Groups Management System
                </div>
            </body>
            </html>
        `;

        const printWin = window.open('', '', 'width=1000,height=800');
        printWin.document.write(reportHTML);
        printWin.document.close();

        // Wait for fonts/images and then print
        setTimeout(() => {
            printWin.print();
        }, 500);
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
        const todayStr = `${getTimePart('year')} -${getTimePart('month')} -${getTimePart('day')} `;

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

    // Load Projects for Kanban / Modern View
    DB.subscribeToProjects((projects) => {
        currentProjects = projects;
        const view = document.getElementById('view-project_management');
        if (view && !view.classList.contains('hidden')) {
            window.adminApp.filterProjects();
        }
        window.adminApp.updateProjectStats();
    });

    // Load Orders
    window.unsubscribeOrders = DB.subscribeToOrders((orders) => {
        // Mock Data Injection if empty (for Demo/Dev)
        if (!orders || orders.length < 5) {
            console.log("Injecting Mock Orders for Demo...");
            const mockOrders = Array.from({ length: 15 }).map((_, i) => ({
                id: `mock - ${i} `,
                internalOrderNo: `2026-02 - ${500 + i} `,
                customer: ['Baliga', 'Bray Controls', 'Flowserve', 'L&T'][Math.floor(Math.random() * 4)],
                description: `Machining of ${['Valve Body', 'Flange', 'Shaft', 'Housing'][Math.floor(Math.random() * 4)]} `,
                date: new Date(Date.now() - Math.floor(Math.random() * 86400000 * 3)).toISOString().split('T')[0], // Last 3 days
                delDate: new Date(Date.now() + Math.floor(Math.random() * 86400000 * 10)).toISOString().split('T')[0],
                status: 'Pending',
                createdAt: { seconds: Date.now() / 1000 - (i * 3600) } // Staggered times
            }));
            currentOrders = [...orders, ...mockOrders];
        } else {
            currentOrders = orders;
        }

        // One-time migration: convert any "In Progress" orders to "Pending"
        currentOrders.forEach(o => {
            if (o.status === 'In Progress' && o.id) {
                DB.updateOrder(o.id, { status: 'Pending' });
                o.status = 'Pending';
            }
        });

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
                    window.adminApp.filterProjects();
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
                } else if (view === 'inventory_management') {
                    // No action needed for static Coming Soon page for now,
                    // UI.switchView(view) handles toggling the hidden class.
                }

            }, 50);
        });
    });

    // Delivery Report Date Picker
    const weekPicker = document.getElementById('delivery-week-picker');
    if (weekPicker) {
        weekPicker.addEventListener('change', (e) => {
            const monthPicker = document.getElementById('delivery-month-picker');
            if (monthPicker) monthPicker.value = ''; // Clear month if week is picked
            Monitoring.renderDeliveryReport(e.target.value);
        });
    }

    const deliveryMonthPicker = document.getElementById('delivery-month-picker');
    if (deliveryMonthPicker) {
        deliveryMonthPicker.addEventListener('change', (e) => {
            const weekPicker = document.getElementById('delivery-week-picker');
            if (weekPicker) weekPicker.value = ''; // Clear week if month is picked
            Monitoring.renderDeliveryReport(undefined, e.target.value);
        });
    }

    const deliveryCompanyFilter = document.getElementById('delivery-company-filter');
    if (deliveryCompanyFilter) {
        deliveryCompanyFilter.addEventListener('change', () => {
            const weekPicker = document.getElementById('delivery-week-picker');
            const monthPicker = document.getElementById('delivery-month-picker');
            Monitoring.renderDeliveryReport(weekPicker?.value, monthPicker?.value);
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

            // Subscribe to Projects
            DB.subscribeToProjects((projects) => {
                currentProjects = projects;

                // Update Customer filter in Project Management
                const customerFilter = document.getElementById('project-customer-filter');
                if (customerFilter) {
                    const customers = [...new Set(projects.map(p => p.customerName).filter(c => c))];
                    const currentVal = customerFilter.value;
                    customerFilter.innerHTML = '<option value="all">All Customers</option>' +
                        customers.map(c => `< option value = "${c}" > ${c}</option > `).join('');
                    customerFilter.value = currentVal;
                }

                // Refresh UI based on active view
                const activeView = UI.getActiveView();
                if (activeView === 'project_management') {
                    window.adminApp.filterProjects();
                } else if (activeView === 'project_detail') {
                    // Re-render detail view if the project exists
                    const detailId = document.getElementById('detail-project-id')?.textContent;
                    // Note: detailId might be the projectId (IES-...) not the Firebase doc id.
                    // We need a way to track which internal ID is active.
                    // Let's assume we can find it in currentProjects or via a global state.
                    const activeProject = projects.find(p => p.projectId === detailId);
                    if (activeProject) {


                        // Update basic info too in case it changed
                        const statusDisplay = document.getElementById('detail-project-status');
                        if (statusDisplay) {
                            statusDisplay.textContent = activeProject.status;
                            statusDisplay.className = `status - badge ${activeProject.status?.toLowerCase().replace(' ', '-')} `;
                        }
                    }
                }
            });

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

// --- Contract Review Logic ---

const checklistItems = [
    { id: 'item_1', label: 'Product Description' },
    { id: 'item_2', label: 'BOM' },
    { id: 'item_3', label: 'Qty' },
    { id: 'item_4', label: 'Price Acceptance' },
    { id: 'item_5', label: 'MOC' },
    { id: 'item_6', label: 'Payment Terms' },
    { id: 'item_7', label: 'Approved Drawing' },
    { id: 'item_8', label: '3rd Party Inspection' },
    { id: 'item_9', label: 'Delivery Date' },
    { id: 'item_10', label: 'LD clause' }
];

window.adminApp.renderContractReview = (reviewData = {}) => {
    const container = document.getElementById('cr-excel-checklist');
    if (!container) return;

    const data = reviewData || {};
    let html = '';

    const renderRow = (item, index) => {
        const itemObj = data[item.id] || {};
        const isCustom = item.isCustom;

        let labelEl = item.label;
        if (isCustom) {
            labelEl = `<input type="text" class="cr-master-input cr-custom-label w-full font-bold px-3 py-2 text-slate-700" value="${itemObj.customLabel || ''}" data-item-id="${item.id}">`;
        } else {
            labelEl = `<span class="px-3 block w-full py-2 font-bold text-slate-700">${item.label}</span>`;
        }

        const req = itemObj.req || '';
        const out = itemObj.out || '';

        const cell = (type, val, currentVal, extraVal) => {
            const isActive = type === 'out' && val === 'more' ? extraVal === 'true' : currentVal === val;
            const activeClass = isActive ? `active-${val}` : '';
            const tick = isActive ? '✓' : '○';

            return `
    <td class="p-0 select-none" onclick="window.adminApp.setReviewItem('${item.id}', '${type}', '${val}')">
        <div class="outcome-tile ${activeClass}" data-opt="${val}">
            <span class="cr-tick">${tick}</span>
        </div>
    </td>
    `;
        };

        const deleteBtn = isCustom ? `<button class="cr-item-delete-btn text-red-400 hover:text-red-600 px-3 flex-shrink-0" onclick="window.adminApp.removeReviewItem('${item.id}')" title="Remove Item"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>` : '';

        return `
    <tr class="cr-item-row" data-item-id="${item.id}" data-req-val="${req}" data-out-val="${out}" data-more-val="${itemObj.more || 'false'}">
                <td class="cr-item-index text-center uppercase tracking-tighter">${index + 1}</td>
                <td class="p-0">
                    <div class="flex items-center h-full">
                        <div class="flex-grow">${labelEl}</div>
                        ${deleteBtn}
                    </div>
                </td>
                ${cell('req', 'yes', req)}
                ${cell('req', 'no', req)}
                ${cell('out', 'ok', out)}
                ${cell('out', 'nok', out)}
                ${cell('out', 'na', out)}
                ${cell('out', 'more', out, itemObj.more)}
<td class="p-0">
    <input type="text" class="cr-master-input w-full cr-remarks-input px-3 py-2 text-slate-600" value="${itemObj.remarks || ''}">
</td>
            </tr>
    `;
    };

    let currentIndex = 0;
    checklistItems.forEach(item => {
        html += renderRow(item, currentIndex++);
    });

    Object.keys(data).forEach(key => {
        if (key.startsWith('custom_')) {
            html += renderRow({ id: key, isCustom: true }, currentIndex++);
        }
    });

    container.innerHTML = html;
};


window.adminApp.addCustomContractReviewItem = () => {
    const tbody = document.getElementById('cr-excel-checklist');
    if (!tbody) return;

    const rowCount = tbody.querySelectorAll('.cr-item-row').length;
    const newId = 'custom_' + Date.now();

    const labelEl = `<input type="text" class="cr-master-input cr-custom-label w-full font-bold px-3 py-2 text-slate-700" value="" data-item-id="${newId}">`;

    const cell = (type, val) => {
        return `
    <td class="p-0 select-none" onclick="window.adminApp.setReviewItem('${newId}', '${type}', '${val}')">
        <div class="outcome-tile" data-opt="${val}">
            <span class="cr-tick">○</span>
        </div>
    </td>
    `;
    };

    const deleteBtn = `<button class="cr-item-delete-btn text-red-400 hover:text-red-600 px-3 flex-shrink-0" onclick="window.adminApp.removeReviewItem('${newId}')" title="Remove Item"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>`;

    const tr = document.createElement('tr');
    tr.className = 'cr-item-row';
    tr.dataset.itemId = newId;

    tr.innerHTML = `
        <td class="cr-item-index text-center uppercase tracking-tighter">${rowCount + 1}</td>
        <td class="p-0">
            <div class="flex items-center h-full">
                <div class="flex-grow">${labelEl}</div>
                ${deleteBtn}
            </div>
        </td>
        ${cell('req', 'yes')}
        ${cell('req', 'no')}
        ${cell('out', 'ok')}
        ${cell('out', 'nok')}
        ${cell('out', 'na')}
        ${cell('out', 'more')}
<td class="p-0">
    <input type="text" class="cr-master-input w-full cr-remarks-input px-3 py-2 text-slate-600" value="">
</td>
`;
    tr.dataset.moreVal = 'false';

    tbody.appendChild(tr);
};


window.adminApp.removeReviewItem = (itemId) => {
    const row = document.querySelector(`.cr-item-row[data-item-id="${itemId}"]`);
    if (row) {
        row.remove();
        // Update indices
        const indices = document.querySelectorAll('.cr-item-index');
        indices.forEach((td, idx) => {
            td.textContent = idx + 1;
        });
    }
};

window.adminApp.setReviewItem = (itemId, type, val) => {
    const row = document.querySelector(`.cr-item-row[data-item-id="${itemId}"]`);
    if (!row) return;

    if (type === 'out' && val === 'more') {
        // Toggle 'more' (Clarity) independently
        const cellTd = row.children[7]; // 8th column (index 7) is 'more'
        const tile = cellTd?.querySelector('.outcome-tile');
        if (!tile) return;

        const tickEl = tile.querySelector('.cr-tick');
        const isActive = row.dataset.moreVal === 'true';

        if (isActive) {
            tile.classList.remove('active-more');
            if (tickEl) tickEl.textContent = '○';
            row.dataset.moreVal = 'false';
        } else {
            tile.classList.add('active-more');
            if (tickEl) tickEl.textContent = '✓';
            row.dataset.moreVal = 'true';
        }
        return;
    }

    const targetIdx = type === 'req' ? 2 : 4;
    const optionsCount = type === 'req' ? 2 : 3; // For 'out', only OK, NOK, NA (indices 4, 5, 6)

    for (let i = 0; i < optionsCount; i++) {
        const cellTd = row.children[targetIdx + i];
        const tile = cellTd.querySelector('.outcome-tile');
        if (!tile) continue;

        const opt = tile.dataset.opt;
        const tickEl = tile.querySelector('.cr-tick');

        if (opt === val) {
            const isCurrentlyActive = row.dataset[`${type}Val`] === val;
            if (isCurrentlyActive) {
                // Toggle OFF
                tile.classList.remove(`active-${val}`);
                if (tickEl) tickEl.textContent = '○';
                row.dataset[`${type}Val`] = '';
            } else {
                // Switch ON
                tile.classList.add(`active-${val}`);
                if (tickEl) tickEl.textContent = '✓';
                row.dataset[`${type}Val`] = val;
            }
        } else {
            // Force others OFF
            tile.classList.remove(`active-${opt}`);
            if (tickEl) tickEl.textContent = '○';
        }
    }
};

window.adminApp.loadContractReview = async (projectId) => {
    const project = currentProjects.find(p => p.id === projectId);
    if (!project) return;

    const status = document.getElementById('cr-save-status');
    if (status) status.textContent = 'Loading...';

    try {
        // Load from DB instead of project object!
        const result = await DB.getContractReview(projectId);
        const reviewData = result.data || {};

        // Helper to safely set value
        const setVal = (id, val) => {
            const el = document.getElementById(id) || document.querySelector(`[data-field="${id}"]`);
            if (el) el.value = val || '';
        };

        // Auto-fill defaults
        const reviewNo = reviewData.reviewNo || `CR - ${project.projectId || projectId} `;
        const today = new Date().toISOString().split('T')[0];

        // Find matching internal order for auto-population
        const allOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
        const matchingOrder = allOrders.find(o => o.internalOrderNo === project.projectId);

        // Customer Data — pull from saved review, then matching internal order, then project
        setVal('cr-po-no', reviewData.poNo || (matchingOrder ? matchingOrder.poNo : '') || project.poNumber || '');
        setVal('cr-drawing-no', reviewData.drawingNo || (matchingOrder ? matchingOrder.drawingNo : '') || project.drawingNo || '');
        setVal('cr-date', reviewData.date || today);
        setVal('cr-delivery-date', reviewData.deliveryDate || project.expectedCompletion || '');
        setVal('cr-contact-person', reviewData.contactPerson || '');
        setVal('cr-phone', reviewData.phone || '');

        // Internal Order Data
        setVal('cr-review-no', reviewNo);
        setVal('cr-io-number', project.projectId || '');
        setVal('cr-internal-date', reviewData.internalDate || today);
        setVal('cr-accountability', reviewData.accountability || '');
        setVal('cr-team', reviewData.team || '');
        setVal('cr-team-leader', reviewData.teamLeader || '');
        setVal('cr-members', reviewData.members || '');

        // Instructions
        setVal('cr-important-instructions', reviewData.instructions || reviewData.importantInstructions || '');

        // 6M Grid
        const mGrid = ['matl', 'machine', 'man', 'method', 'measure', 'tools'];
        mGrid.forEach(key => {
            const data = reviewData.sixM?.[key] || { cmt: '' };
            setVal(`cmt-${key}`, data.cmt);
        });

        // Decisions
        setVal('cr-decision-cap', reviewData.decisionCap || '');
        setVal('cr-decision-oa', reviewData.decisionOa || '');
        setVal('cr-prepared-by', reviewData.preparedBy || '');
        setVal('cr-reviewed-by', reviewData.reviewedBy || '');
        setVal('cr-approved-by', reviewData.approvedBy || '');

        // Render Checklist Table
        const checklistItems = reviewData.items || reviewData.checklistDynamic || {};
        window.adminApp.renderContractReview(checklistItems);

        // Initialize Search Components
        setupMemberSearch('cr-search-accountability', 'search-input-inline', 'cr-accountability');
        setupMemberSearch('cr-search-team-leader', 'search-input-inline', 'cr-team-leader');
        setupMemberSearch('cr-search-members', 'search-input-inline', 'cr-members');
        setupMemberSearch('cr-search-prepared', 'search-input-inline', 'cr-prepared-by');
        setupMemberSearch('cr-search-reviewed', 'search-input-inline', 'cr-reviewed-by');
        setupMemberSearch('cr-search-approved', 'search-input-inline', 'cr-approved-by');

        if (status) {
            status.textContent = result.data ? '✓ Loaded' : '';
            setTimeout(() => { if (status) status.textContent = ''; }, 3000);
        }
    } catch (e) {
        console.error("Error loading contract review:", e);
        if (status) status.textContent = 'Error loading';
    }
};

window.adminApp.saveContractReview = async (action) => {
    const projectId = document.getElementById('detail-project-id')?.textContent;
    const project = currentProjects.find(p => p.projectId === projectId);
    if (!project) return;
    const projectDocId = project.id;

    // Helper to get value
    const getVal = (id) => {
        const el = document.getElementById(id) || document.querySelector(`[data-field="${id}"]`);
        return el ? el.value : '';
    };

    const reviewData = {
        status: action === 'finalize' ? 'Finalized' : 'Draft',
        updatedAt: new Date().toISOString(),

        // Customer Data
        poNo: getVal('cr-po-no'),
        drawingNo: getVal('cr-drawing-no'),
        date: getVal('cr-date'),
        deliveryDate: getVal('cr-delivery-date'),
        contactPerson: getVal('cr-contact-person'),
        phone: getVal('cr-phone'),

        // Internal Order Data
        reviewNo: getVal('cr-review-no'),
        internalDate: getVal('cr-internal-date'),
        accountability: getVal('cr-accountability'),
        team: getVal('cr-team'),
        teamLeader: getVal('cr-team-leader'),
        members: getVal('cr-members'),

        // Instructions
        instructions: getVal('cr-important-instructions'),
        importantInstructions: getVal('cr-important-instructions'),

        // 6M Grid
        sixM: {},

        // Decisions
        decisionCap: getVal('cr-decision-cap'),
        decisionOa: getVal('cr-decision-oa'),
        preparedBy: getVal('cr-prepared-by'),
        reviewedBy: getVal('cr-reviewed-by'),
        approvedBy: getVal('cr-approved-by'),

        items: {},
        checklistDynamic: {}
    };

    const mGrid = ['matl', 'machine', 'man', 'method', 'measure', 'tools'];
    mGrid.forEach(key => {
        reviewData.sixM[key] = {
            cmt: getVal(`cmt-${key}`)
        };
    });

    // Gather Checklist Items
    const rows = document.querySelectorAll('.cr-item-row');
    rows.forEach(row => {
        const id = row.dataset.itemId;
        const customInput = row.querySelector('.cr-custom-label');
        const customLabel = customInput ? customInput.value : '';
        const remarks = row.querySelector('.cr-remarks-input')?.value || '';

        const itemData = {
            req: row.dataset.reqVal || '',
            out: row.dataset.outVal || '',
            more: row.dataset.moreVal || 'false',
            remarks: remarks,
            customLabel: customLabel
        };

        reviewData.items[id] = itemData;
        reviewData.checklistDynamic[id] = itemData; // Backward compatibility
    });

    const statusSpan = document.getElementById('cr-save-status');
    if (statusSpan) statusSpan.textContent = 'Saving...';

    try {
        const isFiled = action === 'finalize';

        // Save to the actual subcollection
        await DB.saveContractReview(projectDocId, reviewData);

        // Update project with filed status
        await DB.updateProject(projectDocId, {
            contractFiled: isFiled
        }, 'Contract Review ' + (isFiled ? 'Finalized' : 'Draft Saved'));

        if (statusSpan) {
            statusSpan.textContent = `Saved at ${new Date().toLocaleTimeString()} `;
            setTimeout(() => statusSpan.textContent = '', 3000);
        }
        if (isFiled) {
            alert('Contract Review Finalized!');
            window.adminApp.moveProject(projectDocId, 'Planning');
        }
    } catch (e) {
        console.error(e);
        if (statusSpan) statusSpan.textContent = 'Error saving!';
        alert('Failed to save review: ' + e.message);
    }
};

// Initialize view on load
document.addEventListener('DOMContentLoaded', () => {
    // Close status menu on click outside
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('dd-status-menu');
        const badge = document.getElementById('detail-project-status');
        if (menu && !menu.classList.contains('hidden')) {
            if (!menu.contains(e.target) && !badge.contains(e.target)) {
                menu.classList.add('hidden');
            }
        }
    });

    setTimeout(() => {
        const savedMode = localStorage.getItem('projectViewMode') || 'grid';
        window.adminApp.setProjectView(savedMode);

        // Handle initial view logic
        const activeView = UI.getActiveView();
        if (activeView === 'inventory_management') {
            console.log("Auto-initializing inventory on load");
            window.adminApp.initInventory();
        }

        // Initialize Monitoring logic
        Monitoring.setupCostCalculation();

        // Setup Daily Summary Report Event Listeners
        const summaryMonth = document.getElementById('summary-report-month');
        if (summaryMonth) {
            summaryMonth.addEventListener('change', (e) => {
                Reporting.renderDailySummaryReport(e.target.value);
            });
        }

        const summaryExport = document.getElementById('summary-export-btn');
        if (summaryExport) {
            summaryExport.addEventListener('click', () => {
                const picker = document.getElementById('summary-report-month');
                Reporting.exportToExcel(picker ? picker.value : '');
            });
        }
    }, 100);
});
