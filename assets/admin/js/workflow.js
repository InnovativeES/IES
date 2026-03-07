// Daily Roster Management Module
import * as DB from './db.js';

// Each row in the roster is a flat object: { employeeId, employeeName, employeeNo, department, role, orderNo, drawingNo, description, customer, qty, unit, manpower, assignedWith, inTime, outTime, workStart, workEnd, priority, notes, status, taskId }
let rosterRows = [];
let currentWorkflowDate = '';
let currentWorkflowDept = 'All';
let workflowUnsubscribe = null;
let currentEditIdx = -1;
let loadedDepartments = new Set(); // Track departments that have data for the current date

// ===== INITIALIZATION =====

export const initWorkflowView = () => {
    const datePicker = document.getElementById('wf-date-picker');
    const deptFilter = document.getElementById('wf-dept-filter');

    // Default to today
    const today = new Date().toISOString().split('T')[0];
    if (datePicker && !datePicker.value) {
        datePicker.value = today;
    }
    currentWorkflowDate = datePicker?.value || today;

    if (deptFilter) {
        currentWorkflowDept = deptFilter.value || 'All';
    }

    // Event listeners
    if (datePicker) {
        datePicker.onchange = () => {
            currentWorkflowDate = datePicker.value;
            loadWorkflows();
        };
    }
    if (deptFilter) {
        deptFilter.onchange = () => {
            currentWorkflowDept = deptFilter.value;
            loadWorkflows();
        };
    }

    loadWorkflows();
};

// ===== DATA LOADING =====

const loadWorkflows = async () => {
    if (!currentWorkflowDate) return;

    if (workflowUnsubscribe) workflowUnsubscribe();

    rosterRows = [];

    if (currentWorkflowDept === 'All') {
        workflowUnsubscribe = DB.subscribeToWorkflows(currentWorkflowDate, (workflows) => {
            rosterRows = [];
            loadedDepartments = new Set(workflows.map(wf => wf.department));
            const notesArr = [];
            const members = window.adminApp?.getCurrentMembers ? window.adminApp.getCurrentMembers() : [];

            workflows.forEach(wf => {
                (wf.assignments || []).forEach(a => {
                    let effectiveRole = (a.role || a.designation || '').trim();
                    if (!effectiveRole && members.length > 0) {
                        const m = members.find(m => m.id === a.employeeId);
                        if (m) {
                            effectiveRole = (m.role || m.designation || (m.orgRoles && m.orgRoles[0]) || '').trim();
                        }
                    }

                    (a.tasks || []).forEach(t => {
                        rosterRows.push({
                            employeeId: a.employeeId,
                            employeeName: a.employeeName,
                            employeeNo: a.employeeNo,
                            department: a.department || wf.department,
                            role: effectiveRole,
                            taskId: t.taskId || crypto.randomUUID(),
                            ...t,
                            qty: parseFloat(t.qty) || 0,
                            overheads: parseFloat(t.overheads) || 0,
                            totalOverheads: parseFloat(t.totalOverheads) || 0,
                            prodValueEa: parseFloat(t.prodValueEa) || 0
                        });
                    });
                });
                if (wf.supervisorNotes) notesArr.push(`[${wf.department}] ${wf.supervisorNotes}`);
            });

            const notesEl = document.getElementById('wf-supervisor-notes');
            if (notesEl) notesEl.value = notesArr.join('\n');

            renderTable();
            updateUnassignedAlert();
        });
    } else {
        const result = await DB.getWorkflow(currentWorkflowDate, currentWorkflowDept);
        if (result.data) {
            rosterRows = [];
            loadedDepartments = new Set([currentWorkflowDept]);
            const members = window.adminApp?.getCurrentMembers ? window.adminApp.getCurrentMembers() : [];

            (result.data.assignments || []).forEach(a => {
                let effectiveRole = (a.role || a.designation || '').trim();
                if (!effectiveRole && members.length > 0) {
                    const m = members.find(m => m.id === a.employeeId);
                    if (m) {
                        effectiveRole = (m.role || m.designation || (m.orgRoles && m.orgRoles[0]) || '').trim();
                    }
                }

                (a.tasks || []).forEach(t => {
                    rosterRows.push({
                        employeeId: a.employeeId,
                        employeeName: a.employeeName,
                        employeeNo: a.employeeNo,
                        department: a.department || currentWorkflowDept,
                        role: effectiveRole,
                        taskId: t.taskId || crypto.randomUUID(),
                        ...t,
                        qty: parseFloat(t.qty) || 0,
                        overheads: parseFloat(t.overheads) || 0,
                        totalOverheads: parseFloat(t.totalOverheads) || 0,
                        prodValueEa: parseFloat(t.prodValueEa) || 0
                    });
                });
            });
            const notesEl = document.getElementById('wf-supervisor-notes');
            if (notesEl) notesEl.value = result.data.supervisorNotes || '';
        } else {
            rosterRows = [];
            const notesEl = document.getElementById('wf-supervisor-notes');
            if (notesEl) notesEl.value = '';
        }
        renderTable();
        updateUnassignedAlert();
    }
};

// ===== TABLE RENDERING =====

const renderTable = () => {
    const tbody = document.getElementById('wf-roster-body');
    if (!tbody) return;

    if (rosterRows.length === 0) {
        tbody.innerHTML = `<tr class="wf-empty-row"><td colspan="14" style="text-align:center; padding:2.5rem; color:#94a3b8;">No assignments for this date. Click <strong>"Add Assignment"</strong> to get started.</td></tr>`;
        return;
    }

    // Group by employee for visual separation
    let lastEmpId = '';
    let rowNum = 0;

    tbody.innerHTML = rosterRows.map((row, idx) => {
        const isNewEmployee = row.employeeId !== lastEmpId;
        lastEmpId = row.employeeId;
        if (isNewEmployee) rowNum++;

        const pClass = row.priority === 'High' ? 'priority-high' : row.priority === 'Medium' ? 'priority-medium' : 'priority-low';
        const sClass = row.status === 'Completed' ? 'status-done' : row.status === 'Ongoing' ? 'status-ongoing' : 'status-pending';

        return `
        <tr class="${isNewEmployee ? 'emp-row' : ''}">
            <td class="text-center">${isNewEmployee ? rowNum : ''}</td>
            <td class="wf-col-emp">
                ${isNewEmployee ? `<strong>${row.employeeName}</strong><br><small>${row.employeeNo || ''} · ${row.department || ''} · ${row.role || ''}</small><br>
                <div class="wf-timing-pills">
                    <input type="time" value="${row.inTime || ''}" onchange="window.adminApp.wfUpdateRow(${idx}, 'inTime', this.value)" class="wf-time-input" title="In Time">
                    <span>-</span>
                    <input type="time" value="${row.outTime || ''}" onchange="window.adminApp.wfUpdateRow(${idx}, 'outTime', this.value)" class="wf-time-input" title="Out Time">
                </div>` : ''}
            </td>
            <td class="text-center" style="font-weight:600">${row.orderNo || 'Ad-hoc'}</td>
            <td class="text-center">${row.drawingNo || '-'}</td>
            <td class="wf-col-desc ${pClass}">${row.description || '-'}</td>
            <td>${row.customer || '-'}</td>
            <td class="text-center">${row.qty || '-'} ${row.unit || ''}</td>
            <td class="text-right" style="font-weight:600; color:#0f172a;">
                ${(row.prodValueEa > 0 && row.qty > 0) ? (row.prodValueEa * row.qty).toFixed(2) : '-'}
            </td>
            <td class="text-right" style="font-weight:600; color:#334155;">
                ${row.totalOverheads > 0 ? `₹${row.totalOverheads.toFixed(2)}` : '-'}
            </td>
            <td class="text-center">${row.manpower || '-'}</td>
            <td class="wf-col-assigned" title="${row.assignedWith || ''}">${row.assignedWith || '-'}</td>
            <td class="text-center">${row.workStart || '-'} to ${row.workEnd || '-'}</td>
            <td class="text-center"><span class="wf-status-badge ${sClass}">${row.status || 'Pending'}</span></td>
            <td class="text-center">
                <div class="wf-row-actions">
                    <button class="wf-row-edit" onclick="window.adminApp.wfEditRow(${idx})" title="Edit">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    </button>
                    <button class="wf-row-delete" onclick="window.adminApp.wfRemoveRow(${idx})" title="Remove">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');

    // Add totals row (sum unique taskIds to avoid double counting)
    const taskOverheads = {};
    const taskProdValues = {};

    rosterRows.forEach(row => {
        if (row.taskId) {
            taskOverheads[row.taskId] = parseFloat(row.totalOverheads) || 0;
            taskProdValues[row.taskId] = (parseFloat(row.prodValueEa) || 0) * (parseFloat(row.qty) || 0);
        }
    });

    const grandTotalOverheads = Object.values(taskOverheads).reduce((sum, val) => sum + val, 0);
    const grandTotalProdValue = Object.values(taskProdValues).reduce((sum, val) => sum + val, 0);

    if (grandTotalOverheads > 0 || grandTotalProdValue > 0) {
        tbody.innerHTML += `
            <tr class="wf-row-total" style="background-color: #f1f5f9; font-weight: 700;">
                <td colspan="7" class="text-right" style="padding: 12px 15px; color: #475569; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-top: 2px solid #e2e8f0;">Grand Totals</td>
                <td class="text-right" style="padding: 12px 15px; color: #0891b2; border-top: 2px solid #e2e8f0; font-size: 0.9rem;">₹${grandTotalProdValue.toFixed(2)}</td>
                <td class="text-right" style="padding: 12px 15px; color: #0f172a; border-top: 2px solid #e2e8f0; border-left: 2px solid #e2e8f0; font-size: 0.9rem;">₹${grandTotalOverheads.toFixed(2)}</td>
                <td colspan="5" style="border-top: 2px solid #e2e8f0;"></td>
            </tr>`;
    }
};

// ===== ROW UPDATE =====

export const updateRow = (idx, field, value) => {
    if (rosterRows[idx]) {
        const empId = rosterRows[idx].employeeId;
        rosterRows[idx][field] = value;

        // Sync inTime/outTime for all rows of the same employee
        if (field === 'inTime' || field === 'outTime') {
            rosterRows.forEach(r => {
                if (r.employeeId === empId) r[field] = value;
            });
            renderTable(); // Re-render to show sync'd times in all rows
        }

        saveAll(); // Auto-save on inline changes
    }
};

export const removeRow = (idx) => {
    if (confirm('Remove this assignment?')) {
        rosterRows.splice(idx, 1);
        renderTable();
        saveAll(); // Auto-save on removal
    }
};

export const editRow = (idx) => {
    currentEditIdx = idx;
    openAssignModal(idx);
};

// ===== ASSIGNMENT MODAL =====

export const openAssignModal = (editIdx = -1) => {
    const members = window.adminApp?.getCurrentMembers ? window.adminApp.getCurrentMembers() : [];
    const dept = currentWorkflowDept;

    currentEditIdx = editIdx;
    const editData = editIdx >= 0 ? rosterRows[editIdx] : null;

    const filteredMembers = (dept !== 'All'
        ? members.filter(m => {
            const memberDept = (m.section || m.department || '').toLowerCase();
            return memberDept.includes(dept.toLowerCase());
        })
        : members).sort((a, b) => {
            const idA = a.employeeId || 'ZZZ';
            const idB = b.employeeId || 'ZZZ';
            return idA.localeCompare(idB);
        });

    // Remove existing modal
    const existing = document.getElementById('wf-assign-modal');
    if (existing) existing.remove();

    let modalHtml = `
    <div id="wf-assign-modal" class="modal active">
        <div class="modal-backdrop" onclick="document.getElementById('wf-assign-modal').classList.remove('active'); setTimeout(() => document.getElementById('wf-assign-modal')?.remove(), 300)"></div>
        <div class="modal-content modal-wide" style="max-width: 900px;">
            <div class="modal-header" style="background: linear-gradient(135deg, #0d9488 0%, #065f46 100%);">
                <h3 class="modal-title" style="color:white;">${editData ? 'Edit Assignment' : 'Assign Work'}</h3>
                <button class="modal-close" onclick="document.getElementById('wf-assign-modal').classList.remove('active'); setTimeout(() => document.getElementById('wf-assign-modal')?.remove(), 300)">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="modal-body wf-compact-modal-body">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <!-- LEFT COLUMN: PEOPLE & TIMING -->
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <!-- GROUP: TEAM -->
                        <div class="wf-modal-group">
                            <div class="wf-group-title">
                                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                                Who is Assigned?
                            </div>
                            <div class="form-group" style="margin-bottom: 0.75rem;">
                                <label class="wf-form-label">Primary Employee</label>
                                <select id="wf-assign-employee" class="form-input" style="padding: 0.4rem 0.6rem; font-size: 0.8rem;">
                                    <option value="">-- Select Employee --</option>
                                    ${filteredMembers.map(m => `<option value="${m.id}" data-name="${m.name}" data-empno="${m.employeeId || ''}" data-dept="${m.section || m.department || ''}" data-role="${m.role || m.designation || ''}" data-overheads="${m.overheads || 0}" ${editData && editData.employeeId === m.id ? 'selected' : ''}>${m.name} (${m.employeeId || 'N/A'})</option>`).join('')}
                                </select>
                            </div>
                            
                            <div class="inline-section-label" style="margin: 0.5rem 0 0.4rem; font-size: 0.6rem;">Assigned With (Team)</div>
                            <div style="max-height: 110px; overflow-y: auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.4rem;">
                                <div class="form-group" style="margin-bottom: 0.4rem;">
                                    <input type="text" id="wf-assign-with-filter" class="form-input" placeholder="Search team members..." style="font-size: 0.7rem; padding: 3px 6px;" oninput="window.adminApp.wfFilterTeam(this.value)">
                                </div>
                                <div id="wf-assign-with-list" class="wf-team-list" style="grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.4rem;">
                                    ${filteredMembers.map(m => `
                                        <label class="wf-team-item" style="padding: 4px 8px; font-size: 0.7rem; gap: 6px;">
                                            <input type="checkbox" name="wf-team-member" value="${m.id}" data-name="${m.name}" ${editData?.assignedWith?.includes(m.name) ? 'checked' : ''}>
                                            <span>${m.name}</span>
                                        </label>
                                    `).join('')}
                                </div>
                            </div>
                        </div>

                        <!-- GROUP: SHIFTS -->
                        <div class="wf-modal-group">
                            <div class="wf-group-title">
                                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                Employee Shift Details
                            </div>
                            <div class="wf-grid-2">
                                <div class="form-group">
                                    <label class="wf-form-label">Shift In</label>
                                    <input type="time" id="wf-assign-intime" class="form-input" style="padding: 0.4rem; font-size: 0.8rem;" value="${editData?.inTime || ''}">
                                </div>
                                <div class="form-group">
                                    <label class="wf-form-label">Shift Out</label>
                                    <input type="time" id="wf-assign-outtime" class="form-input" style="padding: 0.4rem; font-size: 0.8rem;" value="${editData?.outTime || ''}">
                                </div>
                            </div>
                        </div>

                        <!-- GROUP: PROGRESS & STATS -->
                        <div class="wf-modal-group">
                            <div class="wf-group-title">
                                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                                Calculated Overheads
                            </div>
                            <div id="wf-overhead-container" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.6rem;">
                                <div id="wf-overhead-list" style="display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.5rem; max-height: 80px; overflow-y: auto;">
                                    <!-- Populated by JS -->
                                </div>
                                <div style="display: flex; justify-content: space-between; border-top: 1px dashed #cbd5e1; padding-top: 0.4rem; font-weight: 700; font-size: 0.85rem; color: #0f172a;">
                                    <span>Total Overheads:</span>
                                    <span id="wf-overhead-total">₹0.00</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- RIGHT COLUMN: TASK DETAILS -->
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <!-- GROUP: WORK -->
                        <div class="wf-modal-group">
                            <div class="wf-group-title">
                                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
                                What is the Job?
                            </div>
                            <div class="form-group" style="margin-bottom: 0.75rem;">
                                <label class="wf-form-label">IO # (Auto-fills details)</label>
                                <input type="text" id="wf-assign-io" class="form-input" style="padding: 0.4rem; font-size: 0.8rem;" placeholder="e.g. 202526-530" list="wf-io-suggestions" value="${editData?.orderNo || ''}">
                                <datalist id="wf-io-suggestions"></datalist>
                            </div>
                            <div class="form-group" style="margin-bottom: 0.75rem;">
                                <label class="wf-form-label">Task Description *</label>
                                <textarea id="wf-assign-desc" class="form-input" placeholder="Task details..." style="min-height: 45px; max-height: 80px; padding: 0.4rem; font-size: 0.8rem; resize: none;">${editData?.description || ''}</textarea>
                            </div>
                            <div class="wf-grid-2">
                                <div class="form-group">
                                    <label class="wf-form-label">Drawing No</label>
                                    <input type="text" id="wf-assign-drg" class="form-input" style="padding: 0.4rem; font-size: 0.8rem;" placeholder="DRG #" value="${editData?.drawingNo || ''}">
                                </div>
                                <div class="form-group">
                                    <label class="wf-form-label">Customer</label>
                                    <input type="text" id="wf-assign-customer" class="form-input" style="padding: 0.4rem; font-size: 0.8rem;" placeholder="Client" value="${editData?.customer || ''}">
                                </div>
                            </div>
                        </div>

                        <!-- GROUP: SPECS -->
                        <div class="wf-modal-group">
                            <div class="wf-group-title">
                                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                                Timeline & Resources
                            </div>
                            <div class="wf-grid-3" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 0.5rem;">
                                <div class="form-group">
                                    <label class="wf-form-label">Start</label>
                                    <input type="time" id="wf-assign-workstart" class="form-input" style="padding: 0.35rem; font-size: 0.75rem;" value="${editData?.workStart || ''}">
                                </div>
                                <div class="form-group">
                                    <label class="wf-form-label">End</label>
                                    <input type="time" id="wf-assign-workend" class="form-input" style="padding: 0.35rem; font-size: 0.75rem;" value="${editData?.workEnd || ''}">
                                </div>
                                <div class="form-group">
                                    <label class="wf-form-label">MP</label>
                                    <input type="number" id="wf-assign-manpower" class="form-input" style="padding: 0.35rem; font-size: 0.75rem;" min="1" value="${editData?.manpower || '1'}">
                                </div>
                            </div>
                            <div class="wf-grid-3" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;">
                                <div class="form-group">
                                    <label class="wf-form-label">Total Qty</label>
                                    <input type="number" id="wf-assign-qty" class="form-input" style="padding: 0.35rem; font-size: 0.75rem;" min="0" value="${editData?.qty || ''}" oninput="window.adminApp.wfCalculateProdValue()">
                                </div>
                                <div class="form-group">
                                    <label class="wf-form-label">Prod. Cost/Unit</label>
                                    <input type="number" id="wf-assign-prod-cost" class="form-input" style="padding: 0.35rem; font-size: 0.75rem;" min="0" step="0.01" value="${editData?.prodValueEa || ''}" oninput="window.adminApp.wfCalculateProdValue()">
                                </div>
                                <div class="form-group">
                                    <label class="wf-form-label">Total Prod. Val</label>
                                    <input type="text" id="wf-assign-prod-total" class="form-input computed" style="padding: 0.35rem; font-size: 0.75rem; background: #f1f5f9;" readonly value="">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- FULL WIDTH: PROGRESS & NOTES -->
                    <div class="wf-full">
                        <div class="wf-modal-group" style="margin-bottom: 0;">
                            <div class="wf-group-title">
                                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                Priority, Status & Notes
                            </div>
                            <div style="display: flex; gap: 1rem; align-items: flex-end;">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; width: 35%;">
                                    <div class="form-group">
                                        <label class="wf-form-label">Priority</label>
                                        <select id="wf-assign-priority" class="form-input" style="padding: 0.4rem; font-size: 0.8rem;">
                                            <option value="Medium" ${editData?.priority === 'Medium' ? 'selected' : ''}>Medium</option>
                                            <option value="High" ${editData?.priority === 'High' ? 'selected' : ''}>High</option>
                                            <option value="Low" ${editData?.priority === 'Low' ? 'selected' : ''}>Low</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label class="wf-form-label">Status</label>
                                        <select id="wf-assign-status" class="form-input" style="padding: 0.4rem; font-size: 0.8rem;">
                                            <option value="Pending" ${editData?.status === 'Pending' ? 'selected' : ''}>Pending</option>
                                            <option value="Ongoing" ${editData?.status === 'Ongoing' ? 'selected' : ''}>Ongoing</option>
                                            <option value="Completed" ${editData?.status === 'Completed' ? 'selected' : ''}>Completed</option>
                                        </select>
                                    </div>
                                </div>
                                <div style="flex: 1;">
                                    <div class="form-group">
                                        <label class="wf-form-label">Additional Instructions</label>
                                        <input type="text" id="wf-assign-notes" class="form-input" style="padding: 0.4rem; font-size: 0.8rem;" placeholder="e.g. Finish by tomorrow" value="${editData?.notes || ''}">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="border-top: 1px solid #e2e8f0; padding-top: 1rem;">
                <button class="btn btn-secondary" onclick="document.getElementById('wf-assign-modal').classList.remove('active'); setTimeout(() => document.getElementById('wf-assign-modal')?.remove(), 300)">Cancel</button>
                <button class="btn btn-primary" onclick="window.adminApp.wfConfirmAssign()">${editData ? 'Update Assignment' : 'Assign Task'}</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    populateIOSuggestions();
    setupIOLookup();
    setupEmployeeTimingLookup();
    setupOverheadListeners();
    calculateProdValue(); // Initial calculation
    updateOverheadsDisplay(); // Initial calculation
};

export const calculateProdValue = () => {
    const qty = parseFloat(document.getElementById('wf-assign-qty')?.value) || 0;
    const cost = parseFloat(document.getElementById('wf-assign-prod-cost')?.value) || 0;
    const totalEl = document.getElementById('wf-assign-prod-total');
    if (totalEl) totalEl.value = (qty * cost).toFixed(2);
};

const setupOverheadListeners = () => {
    const empSelect = document.getElementById('wf-assign-employee');
    if (empSelect) {
        empSelect.addEventListener('change', updateOverheadsDisplay);
    }

    const teamList = document.getElementById('wf-assign-with-list');
    if (teamList) {
        teamList.addEventListener('change', (e) => {
            if (e.target.name === 'wf-team-member') {
                updateOverheadsDisplay();
            }
        });
    }
};

export const updateOverheadsDisplay = () => {
    const members = window.adminApp?.getCurrentMembers ? window.adminApp.getCurrentMembers() : [];
    const empSelect = document.getElementById('wf-assign-employee');
    const primaryId = empSelect?.value;

    const teamCheckboxes = document.querySelectorAll('input[name="wf-team-member"]:checked');
    const teamIds = Array.from(teamCheckboxes).map(cb => cb.value);

    const listEl = document.getElementById('wf-overhead-list');
    const totalEl = document.getElementById('wf-overhead-total');
    if (!listEl || !totalEl) return;

    let total = 0;
    let html = '';

    const allIds = [primaryId, ...teamIds].filter(Boolean);
    const uniqueIds = [...new Set(allIds)];

    uniqueIds.forEach(id => {
        const m = members.find(m => m.id === id);
        if (m) {
            const oh = parseFloat(m.overheads) || 0;
            total += oh;
            html += `
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #64748b;">
                    <span>${m.name}</span>
                    <span>₹${oh.toFixed(2)}</span>
                </div>`;
        }
    });

    if (!html) {
        html = '<div style="font-size: 0.75rem; color: #94a3b8; text-align: center;">No employees selected</div>';
    }

    listEl.innerHTML = html;
    totalEl.textContent = `₹${total.toFixed(2)}`;
};

const populateIOSuggestions = () => {
    const orders = window.adminApp?.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    const datalist = document.getElementById('wf-io-suggestions');
    if (!datalist) return;
    const pending = orders.filter(o => o.status === 'Pending' || o.status === 'Partially Delivered');
    datalist.innerHTML = pending.map(o => `<option value="${o.internalOrderNo}">`).join('');
};

const setupIOLookup = () => {
    const ioInput = document.getElementById('wf-assign-io');
    if (!ioInput) return;

    ioInput.addEventListener('input', () => {
        const val = ioInput.value.trim();
        if (!val) return;
        const orders = window.adminApp?.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
        const match = orders.find(o => o.internalOrderNo === val);
        if (match) {
            const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
            setVal('wf-assign-desc', match.description);
            setVal('wf-assign-drg', match.drawingNo);
            setVal('wf-assign-customer', match.customer);
            setVal('wf-assign-qty', match.qty);
            setVal('wf-assign-unit', match.qtyUnit || 'Nos');
            setVal('wf-assign-prod-cost', match.prodValueEa || '');
            calculateProdValue();
        }
    });
};

const setupEmployeeTimingLookup = () => {
    const empSelect = document.getElementById('wf-assign-employee');
    const inTimeInput = document.getElementById('wf-assign-intime');
    const outTimeInput = document.getElementById('wf-assign-outtime');

    if (!empSelect || !inTimeInput || !outTimeInput) return;

    empSelect.addEventListener('change', () => {
        const empId = empSelect.value;
        if (!empId) return;

        // Find if this employee already has an assignment today
        const existing = rosterRows.find(r => r.employeeId === empId);
        if (existing) {
            if (existing.inTime) inTimeInput.value = existing.inTime;
            if (existing.outTime) outTimeInput.value = existing.outTime;
        }
    });
};

// ===== CONFIRM ASSIGNMENT =====

export const confirmAssign = () => {
    const empSelect = document.getElementById('wf-assign-employee');
    if (!empSelect || !empSelect.value) {
        alert('Please select an employee.');
        return;
    }

    const getVal = id => (document.getElementById(id)?.value || '').trim();

    const desc = getVal('wf-assign-desc');
    const orderNo = getVal('wf-assign-io');
    if (!desc && !orderNo) {
        alert('Please enter a task description or IO number.');
        return;
    }

    const selectedOption = empSelect.options[empSelect.selectedIndex];
    const mainEmpId = empSelect.value;
    const mainEmpName = selectedOption.getAttribute('data-name');
    const mainEmpNo = selectedOption.getAttribute('data-empno');
    const mainEmpDept = selectedOption.getAttribute('data-dept') || currentWorkflowDept;
    const mainEmpRole = selectedOption.getAttribute('data-role') || '';

    // Get team members
    const teamCheckboxes = document.querySelectorAll('input[name="wf-team-member"]:checked');
    const teamMembers = Array.from(teamCheckboxes).map(cb => ({
        id: cb.value,
        name: cb.getAttribute('data-name')
    })).filter(tm => tm.id !== mainEmpId); // Exclude main employee if selected twice

    const taskId = currentEditIdx >= 0 ? rosterRows[currentEditIdx].taskId : crypto.randomUUID();
    const modalInTime = getVal('wf-assign-intime');
    const modalOutTime = getVal('wf-assign-outtime');

    const allAssignees = [
        { id: mainEmpId, name: mainEmpName, empNo: mainEmpNo, dept: mainEmpDept, role: mainEmpRole, overheads: parseFloat(selectedOption.getAttribute('data-overheads')) || 0 },
        ...teamMembers.map(tm => {
            const m = (window.adminApp.getCurrentMembers()).find(m => m.id === tm.id);
            return {
                id: tm.id,
                name: tm.name,
                empNo: m?.employeeId || '',
                dept: m?.section || m?.department || currentWorkflowDept,
                role: m?.role || m?.designation || '',
                overheads: parseFloat(m?.overheads) || 0
            };
        })
    ];

    const baseData = {
        type: orderNo ? 'order' : 'adhoc',
        orderNo,
        description: desc,
        drawingNo: getVal('wf-assign-drg'),
        customer: getVal('wf-assign-customer'),
        qty: parseFloat(getVal('wf-assign-qty')) || 0,
        unit: getVal('wf-assign-unit') || 'Nos',
        manpower: parseInt(getVal('wf-assign-manpower')) || 1,
        workStart: getVal('wf-assign-workstart'),
        workEnd: getVal('wf-assign-workend'),
        priority: getVal('wf-assign-priority') || 'Medium',
        notes: getVal('wf-assign-notes'),
        status: getVal('wf-assign-status') || 'Pending',
        prodValueEa: parseFloat(getVal('wf-assign-prod-cost')) || 0,
        taskId: taskId,
        totalOverheads: allAssignees.reduce((sum, a) => sum + (a.overheads || 0), 0)
    };

    if (currentEditIdx >= 0) {
        // Find ALL rows with this taskId and remove them first (to handle changes in team members)
        rosterRows = rosterRows.filter(r => r.taskId !== taskId);
    }

    // Add/Update for all assignees
    allAssignees.forEach(assignee => {
        // Other members in this task
        const others = allAssignees.filter(a => a.id !== assignee.id).map(a => a.name).join(', ');

        // Find existing time for THIS assignee in the roster
        const existingRow = rosterRows.find(r => r.employeeId === assignee.id);
        const existingIn = existingRow ? existingRow.inTime : '';
        const existingOut = existingRow ? existingRow.outTime : '';

        // Only the main employee takes the modal's timing. 
        // Team members keep their existing timing or stay empty.
        const finalIn = (assignee.id === mainEmpId) ? modalInTime : (existingIn || '');
        const finalOut = (assignee.id === mainEmpId) ? modalOutTime : (existingOut || '');

        const finalData = {
            ...baseData,
            employeeId: assignee.id,
            employeeName: assignee.name,
            employeeNo: assignee.empNo,
            department: assignee.dept,
            role: assignee.role,
            assignedWith: others,
            overheads: assignee.overheads,
            inTime: finalIn,
            outTime: finalOut
        };

        const lastIdx = rosterRows.map(r => r.employeeId).lastIndexOf(finalData.employeeId);
        if (lastIdx >= 0) {
            rosterRows.splice(lastIdx + 1, 0, finalData);
        } else {
            rosterRows.push(finalData);
        }

        // Sync times for THIS specific employee across all their rows
        if (finalIn || finalOut) {
            rosterRows.forEach(r => {
                if (r.employeeId === assignee.id) {
                    if (finalIn) r.inTime = finalIn;
                    if (finalOut) r.outTime = finalOut;
                }
            });
        }
    });

    // Close modal
    currentEditIdx = -1;
    window.adminApp.wfSaveAll(); // Refresh and save
    const modal = document.getElementById('wf-assign-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }

    renderTable();
    saveAll(); // Auto-save after addition/edit
};

// ===== SAVE =====

export const saveAll = async () => {
    if (!currentWorkflowDate) return;

    const notes = (document.getElementById('wf-supervisor-notes')?.value || '').trim();

    const grouped = {};
    rosterRows.forEach(row => {
        const key = row.employeeId;
        if (!grouped[key]) {
            grouped[key] = {
                employeeId: row.employeeId,
                employeeName: row.employeeName,
                employeeNo: row.employeeNo,
                department: row.department,
                role: row.role,
                tasks: []
            };
        }
        grouped[key].tasks.push({
            type: row.type,
            orderNo: row.orderNo,
            drawingNo: row.drawingNo,
            description: row.description,
            customer: row.customer,
            qty: row.qty,
            unit: row.unit,
            manpower: row.manpower,
            assignedWith: row.assignedWith,
            inTime: row.inTime,
            outTime: row.outTime,
            workStart: row.workStart,
            workEnd: row.workEnd,
            priority: row.priority,
            notes: row.notes,
            status: row.status,
            overheads: parseFloat(row.overheads) || 0,
            totalOverheads: parseFloat(row.totalOverheads) || 0,
            prodValueEa: parseFloat(row.prodValueEa) || 0,
            taskId: row.taskId
        });
    });

    const assignments = Object.values(grouped);

    if (currentWorkflowDept === 'All') {
        const byDept = {};
        assignments.forEach(a => {
            const dept = a.department || 'Unassigned';
            if (!byDept[dept]) byDept[dept] = [];
            byDept[dept].push(a);
        });

        // Ensure we update (clear) any department that was previously loaded but now has no assignments
        const allDeptsToUpdate = new Set([...Object.keys(byDept), ...loadedDepartments]);
        for (const dept of allDeptsToUpdate) {
            const deptAssignments = byDept[dept] || [];
            await DB.saveWorkflow(currentWorkflowDate, dept, deptAssignments, notes);
        }
    } else {
        await DB.saveWorkflow(currentWorkflowDate, currentWorkflowDept, assignments, notes);
    }

    // Visual feedback
    const saveBtn = document.querySelector('.wf-btn-save');
    if (saveBtn) {
        const original = saveBtn.innerHTML;
        saveBtn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Saved!`;
        saveBtn.style.background = '#059669';
        setTimeout(() => { if (saveBtn) { saveBtn.innerHTML = original; saveBtn.style.background = ''; } }, 1500);
    }
};

// ===== COPY PREVIOUS DAY =====

export const copyPreviousDay = async () => {
    if (!currentWorkflowDate) return;

    const prevDate = new Date(currentWorkflowDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    if (currentWorkflowDept === 'All') {
        alert('Please select a specific department to copy from previous day.');
        return;
    }

    const result = await DB.getWorkflow(prevDateStr, currentWorkflowDept);
    if (result.data && result.data.assignments && result.data.assignments.length > 0) {
        const totalTasks = result.data.assignments.reduce((sum, a) => sum + (a.tasks?.length || 0), 0);
        if (!confirm(`Copy ${totalTasks} task(s) from ${prevDateStr}?`)) return;

        rosterRows = [];
        result.data.assignments.forEach(a => {
            (a.tasks || []).forEach(t => {
                rosterRows.push({
                    employeeId: a.employeeId,
                    employeeName: a.employeeName,
                    employeeNo: a.employeeNo,
                    department: a.department,
                    role: a.role || '',
                    ...t,
                    status: 'Pending',
                    inTime: '',
                    outTime: '',
                    workStart: '',
                    workEnd: ''
                });
            });
        });
        renderTable();
        saveAll(); // Auto-save after copy
    } else {
        alert(`No assignments found for ${currentWorkflowDept} on ${prevDateStr}.`);
    }
};

// ===== UNASSIGNED ALERT =====

const updateUnassignedAlert = () => {
    const alertEl = document.getElementById('wf-unassigned-alert');
    const countEl = document.getElementById('wf-unassigned-count');
    if (!alertEl || !countEl) return;

    const orders = window.adminApp?.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    const pendingCount = orders.filter(o => o.status === 'Pending').length;

    if (pendingCount > 0) {
        countEl.textContent = `${pendingCount} pending order${pendingCount !== 1 ? 's' : ''}`;
        alertEl.classList.remove('hidden');
    } else {
        alertEl.classList.add('hidden');
    }
};

// ===== PRINT =====

export const printWorksheet = () => {
    if (rosterRows.length === 0) {
        alert('No assignments to print.');
        return;
    }

    const date = currentWorkflowDate;
    const dept = currentWorkflowDept === 'All' ? 'All Departments' : currentWorkflowDept;
    const notes = (document.getElementById('wf-supervisor-notes')?.value || '').trim();

    // Count unique employees
    const uniqueEmps = new Set(rosterRows.map(r => r.employeeId)).size;

    let printHtml = `
    <html>
    <head>
        <title>Daily Roster - ${dept} - ${date}</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 15px; color: #1e293b; font-size: 11px; }
            .print-header { text-align: center; border-bottom: 3px solid #0d9488; padding-bottom: 10px; margin-bottom: 12px; }
            .print-header h1 { font-size: 16px; color: #0d9488; letter-spacing: 1px; }
            .print-header .print-subtitle { font-size: 12px; color: #64748b; margin-top: 3px; }
            .print-meta { display: flex; justify-content: space-between; font-size: 11px; color: #475569; margin-bottom: 10px; padding: 6px 10px; background: #f8fafc; border-radius: 4px; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            th { background: #e2e8f0; padding: 5px 6px; text-align: left; font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; color: #334155; border: 1px solid #cbd5e1; }
            td { padding: 4px 6px; border: 1px solid #e2e8f0; vertical-align: top; }
            .emp-row { background: #f0fdf4; font-weight: 600; }
            .priority-high { color: #dc2626; font-weight: 700; }
            .priority-medium { color: #d97706; }
            .priority-low { color: #16a34a; }
            .status-done { background: #dcfce7; color: #166534; padding: 1px 6px; border-radius: 3px; font-size: 9px; }
            .status-ongoing { background: #dbeafe; color: #1e40af; padding: 1px 6px; border-radius: 3px; font-size: 9px; }
            .status-pending { background: #fff7ed; color: #c2410c; padding: 1px 6px; border-radius: 3px; font-size: 9px; }
            .supervisor-notes { margin-top: 12px; padding: 8px 10px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; font-size: 11px; }
            .supervisor-notes strong { color: #166534; }
            .footer { margin-top: 20px; text-align: center; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
            .signature-area { margin-top: 25px; display: flex; justify-content: space-between; }
            .signature-box { width: 200px; border-top: 1px solid #334155; text-align: center; padding-top: 4px; font-size: 10px; color: #475569; }
            @media print { body { padding: 8px; } }
        </style>
    </head>
    <body>
        <div class="print-header">
            <h1>INNOVATIVE ENGINEERING SOLUTIONS</h1>
            <div class="print-subtitle">Daily Roster</div>
        </div>
        <div class="print-meta">
            <span><strong>Date:</strong> ${new Date(date).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}</span>
            <span><strong>Department:</strong> ${dept}</span>
            <span><strong>Employees:</strong> ${uniqueEmps} | <strong>Tasks:</strong> ${rosterRows.length}</span>
        </div>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Employee & Timing</th>
                    <th>IO No</th>
                    <th>Drawing</th>
                    <th>Description</th>
                    <th>Customer</th>
                    <th>Qty</th>
                    <th>Prod. Value</th>
                    <th>Total Overhead</th>
                    <th>MP</th>
                    <th>Assigned With</th>
                    <th>Work Duration</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>`;

    let lastEmpId = '';
    let rowNum = 0;

    rosterRows.forEach((row) => {
        const isNewEmployee = row.employeeId !== lastEmpId;
        lastEmpId = row.employeeId;
        if (isNewEmployee) rowNum++;

        const pClass = row.priority === 'High' ? 'priority-high' : row.priority === 'Medium' ? 'priority-medium' : 'priority-low';
        const sClass = row.status === 'Completed' ? 'status-done' : row.status === 'Ongoing' ? 'status-ongoing' : 'status-pending';

        printHtml += `
                <tr class="${isNewEmployee ? 'emp-row' : ''}">
                    <td>${isNewEmployee ? rowNum : ''}</td>
                    <td>
                        ${isNewEmployee ? `<strong>${row.employeeName}</strong><br><small>${row.employeeNo || ''} · ${row.department || ''} · ${row.role || ''}</small><br><div style="font-size:8px; margin-top:3px; color:#64748b;">In: ${row.inTime || '-'} · Out: ${row.outTime || '-'}</div>` : ''}
                    </td>
                    <td style="font-weight:600">${row.orderNo || 'Ad-hoc'}</td>
                    <td>${row.drawingNo || '-'}</td>
                    <td class="${pClass}">${row.description || '-'}</td>
                    <td>${row.customer || '-'}</td>
                    <td>${row.qty || '-'} ${row.unit || ''}</td>
                    <td>${(row.prodValueEa > 0 && row.qty > 0) ? (row.prodValueEa * row.qty).toFixed(2) : '-'}</td>
                    <td>${row.totalOverheads > 0 ? `₹${row.totalOverheads.toFixed(2)}` : '-'}</td>
                    <td>${row.manpower || '-'}</td>
                    <td>${row.assignedWith || '-'}</td>
                    <td>${row.workStart || '-'} to ${row.workEnd || '-'}</td>
                    <td><span class="${sClass}">${row.status || 'Pending'}</span></td>
                </tr>`;
    });

    // Add Grand Total row for Print
    const taskOverheads = {};
    const taskProdValues = {};

    rosterRows.forEach(row => {
        if (row.taskId) {
            taskOverheads[row.taskId] = parseFloat(row.totalOverheads) || 0;
            taskProdValues[row.taskId] = (parseFloat(row.prodValueEa) || 0) * (parseFloat(row.qty) || 0);
        }
    });

    const grandTotalOverheads = Object.values(taskOverheads).reduce((sum, val) => sum + val, 0);
    const grandTotalProdValue = Object.values(taskProdValues).reduce((sum, val) => sum + val, 0);

    if (grandTotalOverheads > 0 || grandTotalProdValue > 0) {
        printHtml += `
            <tr style="background: #f8fafc; font-weight: 700;">
                <td colspan="7" style="text-align: right; border: 1px solid #cbd5e1;">GRAND TOTALS</td>
                <td style="border: 1px solid #cbd5e1; text-align: right;">₹${grandTotalProdValue.toFixed(2)}</td>
                <td style="border: 1px solid #cbd5e1; text-align: right;">₹${grandTotalOverheads.toFixed(2)}</td>
                <td colspan="3" style="border: 1px solid #cbd5e1;"></td>
            </tr>`;
    }

    printHtml += `</tbody></table>`;

    if (notes) {
        printHtml += `<div class="supervisor-notes"><strong>Supervisor Notes:</strong> ${notes}</div>`;
    }

    printHtml += `
        <div class="signature-area">
            <div class="signature-box">Supervisor Signature</div>
            <div class="signature-box">Manager Signature</div>
        </div>
        <div class="footer">Generated on ${new Date().toLocaleString('en-IN')} · IES Groups Admin Portal</div>
    </body></html>`;

    const printWindow = window.open('', '_blank', 'width=900,height=600');
    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
};

// ===== TEAM FILTER =====

export const filterTeam = (val) => {
    const list = document.getElementById('wf-assign-with-list');
    if (!list) return;
    const items = list.querySelectorAll('.wf-team-item');
    const search = val.toLowerCase();
    items.forEach(item => {
        const name = item.querySelector('span').textContent.toLowerCase();
        if (name.includes(search)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
};
