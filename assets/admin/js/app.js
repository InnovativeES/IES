import * as Auth from './auth.js';
import * as UI from './ui.js';
import * as DB from './db.js';
import * as Charts from './charts.js';
import * as Monitoring from './monitoring.js?v=9';
import * as DCRegister from './dc_register.js?v=9';
import * as Inventory from './inventory.js';
import * as Workflow from './workflow.js';
import * as Reporting from './reporting.js';
import * as Tracker from './progress_tracker.js';
import * as Costing from './costing.js';
import * as Payslip from './payslip.js?v=30';
import * as Units from './units.js';

// App State
let currentMembers = [];
let currentProjects = [];
let currentOrders = [];
let memberUnsubscribe = null;
let projectUnsubscribe = null;
let isTrashView = false;
let isProjectTrashView = false;
let projectViewMode = 'list';
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
    const rawList = Array.isArray(orders) ? orders : [];
    const activeRaw = rawList.filter(o => !o.isTrash && !o.deleted && !o.isDeleted);

    // Pre-calculate delivered quantities per IO No from delivery_report entries
    const deliveredByIo = {};
    activeRaw.forEach(o => {
        if (o.entryType === 'delivery_report') {
            const ioKey = String(o.internalOrderNo || '').trim().toUpperCase();
            if (!ioKey) return;
            const dQty = parseFloat(o.deliveryQty ?? o.qty) || 0;
            deliveredByIo[ioKey] = (deliveredByIo[ioKey] || 0) + dQty;
        }
    });

    // Sanitize internal orders (exclude delivery_report entries)
    const internalOrders = (Costing && Costing.getSanitizedInternalOrders)
        ? Costing.getSanitizedInternalOrders(activeRaw)
        : activeRaw.filter(o => o.entryType !== 'delivery_report');

    // Filter by month and department
    const filteredOrders = internalOrders.filter(o => {
        const matchesMonth = selectedMonth === 'all' || (o.date && o.date.startsWith(selectedMonth));
        const matchesDept = selectedDept === 'all' || o.department === selectedDept;
        return matchesMonth && matchesDept;
    });

    const parseNum = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.-]/g, '')) || 0;
        return 0;
    };

    // Map projects by IO No for Contract Review lookup
    const projectByIo = {};
    (currentProjects || []).forEach(p => {
        if (p.isDeleted) return;
        const ioKey = String(p.projectId || '').trim().toUpperCase();
        if (ioKey) projectByIo[ioKey] = p;
    });

    const activePendingOrders = [];
    const deliveredOrders = [];
    let pendingSaleRevenue = 0;
    let crPendingCount = 0;
    let crFiledForPendingCount = 0;

    filteredOrders.forEach(o => {
        const ioKey = String(o.internalOrderNo || '').trim().toUpperCase();
        const qty = parseNum(o.qty);
        const delQty = (ioKey && deliveredByIo[ioKey] !== undefined)
            ? deliveredByIo[ioKey]
            : parseNum(o.deliveryQty);

        let derivedStatus = o.status || 'Pending';
        if (qty > 0 && delQty >= qty) derivedStatus = 'Delivered';
        else if (delQty > 0) derivedStatus = 'Partially Delivered';

        if (derivedStatus === 'Delivered') {
            deliveredOrders.push({ ...o, derivedStatus });
        } else {
            activePendingOrders.push({ ...o, derivedStatus, pendingQty: Math.max(0, qty - delQty) });

            // Calculate Pending Sale Value (using Sale Value, NOT prodValueEa)
            const unitSale = parseNum(o.saleValueEa || o.value);
            const totalSale = parseNum(o.total || o.totalValue) || (qty * unitSale);
            const remainingQty = qty > 0 ? Math.max(0, qty - delQty) : 0;

            let orderPendingSale = totalSale;
            if (qty > 0 && delQty > 0 && remainingQty < qty) {
                orderPendingSale = unitSale > 0 ? (remainingQty * unitSale) : (totalSale * (remainingQty / qty));
            }
            pendingSaleRevenue += orderPendingSale;

            // Check Contract Review status for this Pending Order
            const proj = ioKey ? projectByIo[ioKey] : null;
            const isCrFiled = Boolean(
                o.contractFiled ||
                (proj && (proj.contractFiled || proj.crStatus === 'Finalized' || ['Approved', 'In Progress', 'Completed'].includes(proj.status)))
            );
            if (isCrFiled) {
                crFiledForPendingCount++;
            } else {
                crPendingCount++;
            }
        }
    });

    const pendingCount = activePendingOrders.length;
    const totalCount = pendingCount + deliveredOrders.length;

    // Pipeline percentages
    const pendingPct = totalCount > 0 ? Math.round((pendingCount / totalCount) * 100) : 0;
    const deliveredPct = totalCount > 0 ? Math.round((deliveredOrders.length / totalCount) * 100) : 0;

    return {
        revenue: pendingSaleRevenue,
        activeOrders: pendingCount,
        pendingCount,
        unassignedCount: crPendingCount,
        crPendingCount,
        crFiledForPendingCount,
        totalMembers: currentMembers.length,
        pendingPct,
        deliveredPct,
        filteredOrders: activePendingOrders,
        allFilteredOrders: filteredOrders
    };
}

// Helper: Refresh Dashboard UI
function refreshDashboard() {
    const monthFilter = document.getElementById('dashboard-month-filter');
    const deptFilter = document.getElementById('dashboard-dept-filter');

    // Dynamically populate month dropdown from currentOrders so current months are always selectable
    if (monthFilter && Array.isArray(currentOrders) && currentOrders.length > 0) {
        const prevVal = monthFilter.value || 'all';
        const monthSet = new Set();
        currentOrders.forEach(o => {
            if (!o.isTrash && !o.deleted && o.date && o.date.length >= 7) {
                monthSet.add(o.date.substring(0, 7));
            }
        });
        const sortedMonths = Array.from(monthSet).sort().reverse();
        const formatMonthLabel = (ym) => {
            const [y, m] = ym.split('-');
            const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
            return isNaN(d) ? ym : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        };
        monthFilter.innerHTML = `<option value="all">All Time</option>` +
            sortedMonths.map(ym => `<option value="${ym}">${formatMonthLabel(ym)}</option>`).join('');
        monthFilter.value = (prevVal === 'all' || monthSet.has(prevVal)) ? prevVal : 'all';
    }

    const selectedMonth = monthFilter ? monthFilter.value : 'all';
    const selectedDept = deptFilter ? deptFilter.value : 'all';

    // Ensure Contract Review subcollection statuses are enriched in background
    if (window.adminApp && window.adminApp.enrichProjectsWithContractReviews) {
        window.adminApp.enrichProjectsWithContractReviews();
    }

    const stats = calculateDashboardStats(currentOrders, selectedMonth, selectedDept);
    UI.updateStats(stats);
    UI.renderDashboardPendingOrders(stats.filteredOrders);
    UI.renderDashboardRecentActivity(stats.allFilteredOrders || stats.filteredOrders);
}

// Multi-Unit Facility Management
function updateUnitUI() {
    const activeUnit = Units.getActiveUnit();
    const config = Units.getActiveUnitConfig();

    // 1. Sidebar Widget (Expanded + Collapsed Pill)
    const sidebarUnitIndicator = document.getElementById('sidebar-unit-indicator');
    const sidebarUnitCode = document.getElementById('sidebar-unit-code');
    const sidebarUnitSelect = document.getElementById('sidebar-unit-select');
    const collapsedPill = document.getElementById('sidebar-unit-collapsed-pill');
    const collapsedDot = document.getElementById('sidebar-unit-collapsed-dot');
    const collapsedCode = document.getElementById('sidebar-unit-collapsed-code');

    if (sidebarUnitIndicator) {
        sidebarUnitIndicator.style.backgroundColor = config.color;
        sidebarUnitIndicator.style.boxShadow = `0 0 8px ${config.color}`;
    }
    if (collapsedDot) {
        collapsedDot.style.backgroundColor = config.color;
        collapsedDot.style.boxShadow = `0 0 6px ${config.color}`;
    }
    if (collapsedCode) {
        collapsedCode.textContent = config.code;
    }
    if (collapsedPill) {
        if (activeUnit === 'unit2') {
            collapsedPill.style.borderColor = 'rgba(99, 102, 241, 0.55)';
            collapsedPill.style.color = '#a5b4fc';
        } else {
            collapsedPill.style.borderColor = 'rgba(16, 185, 129, 0.55)';
            collapsedPill.style.color = '#6ee7b7';
        }
    }
    if (sidebarUnitCode) {
        sidebarUnitCode.textContent = config.code;
        if (activeUnit === 'unit2') {
            sidebarUnitCode.style.backgroundColor = '#312e81';
            sidebarUnitCode.style.color = '#a5b4fc';
            sidebarUnitCode.style.borderColor = '#6366f1';
        } else {
            sidebarUnitCode.style.backgroundColor = '#064e3b';
            sidebarUnitCode.style.color = '#6ee7b7';
            sidebarUnitCode.style.borderColor = '#059669';
        }
    }
    if (sidebarUnitSelect) {
        sidebarUnitSelect.value = activeUnit;
    }

    // 2. Header Dropdown & Dot
    const headerUnitDot = document.getElementById('header-unit-dot');
    const headerUnitSelect = document.getElementById('header-unit-select');
    if (headerUnitDot) headerUnitDot.style.backgroundColor = config.color;
    if (headerUnitSelect) headerUnitSelect.value = activeUnit;

    // 3. Modal Card Selection
    document.querySelectorAll('.unit-select-card').forEach(card => {
        card.classList.remove('active');
        card.style.borderColor = '#e2e8f0';
        card.style.background = '#ffffff';
    });
    const activeCard = document.getElementById(`unit-option-${activeUnit}`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.style.borderColor = config.color;
        activeCard.style.background = config.badgeBg;
    }
    const check1 = document.getElementById('unit-check-unit1');
    const check2 = document.getElementById('unit-check-unit2');
    if (check1) check1.classList.toggle('hidden', activeUnit !== 'unit1');
    if (check2) check2.classList.toggle('hidden', activeUnit !== 'unit2');
}

function stopUnitSubscriptions() {
    if (memberUnsubscribe) { memberUnsubscribe(); memberUnsubscribe = null; }
    if (window.unsubscribeMembers) { window.unsubscribeMembers(); window.unsubscribeMembers = null; }
    if (projectUnsubscribe) { projectUnsubscribe(); projectUnsubscribe = null; }
    if (window.unsubscribeProjects) { window.unsubscribeProjects(); window.unsubscribeProjects = null; }
    if (window.unsubscribeOrders) { window.unsubscribeOrders(); window.unsubscribeOrders = null; }
    if (inventoryUnsubscribe) { inventoryUnsubscribe(); inventoryUnsubscribe = null; }
    if (transactionUnsubscribe) { transactionUnsubscribe(); transactionUnsubscribe = null; }
}

function startUnitSubscriptions() {
    // 1. Members
    if (memberUnsubscribe) memberUnsubscribe();
    memberUnsubscribe = DB.subscribeToMembers((members) => {
        currentMembers = members || [];
        const memberView = document.getElementById('subview-members');
        if (memberView && !memberView.classList.contains('hidden')) {
            UI.renderMemberList(currentMembers);
        }
        refreshDashboard();
    });
    window.unsubscribeMembers = memberUnsubscribe;

    // 2. Projects
    if (projectUnsubscribe) projectUnsubscribe();
    projectUnsubscribe = DB.subscribeToProjects((projects) => {
        currentProjects = projects || [];
        const customerFilter = document.getElementById('project-customer-filter');
        if (customerFilter) {
            const customers = [...new Set(currentProjects.map(p => p.customerName ? String(p.customerName).trim().toUpperCase() : '').filter(Boolean))].sort();
            const currentVal = customerFilter.value;
            customerFilter.innerHTML = '<option value="all">All Customers</option>' +
                customers.map(c => `<option value="${c}">${c}</option>`).join('');
            customerFilter.value = customers.includes(currentVal) ? currentVal : 'all';
        }

        const view = document.getElementById('view-project_management');
        if (view && !view.classList.contains('hidden')) {
            window.adminApp.filterProjects();
        }
        window.adminApp.updateProjectStats();
        refreshDashboard();
    });
    window.unsubscribeProjects = projectUnsubscribe;

    // 3. Orders
    if (window.unsubscribeOrders) window.unsubscribeOrders();
    window.unsubscribeOrders = DB.subscribeToOrders((orders) => {
        currentOrders = orders || [];

        currentOrders.forEach(o => {
            if (o.status === 'In Progress' && o.id) {
                DB.updateOrder(o.id, { status: 'Pending' });
                o.status = 'Pending';
            }
        });

        const monitoringView = document.getElementById('view-monitoring');
        if (monitoringView && !monitoringView.classList.contains('hidden')) {
            Monitoring.renderTable(currentOrders);
        }

        const dcRegisterView = document.getElementById('view-dc_register');
        if (dcRegisterView && !dcRegisterView.classList.contains('hidden')) {
            DCRegister.renderDCTable(currentOrders);
        }

        const trackerView = document.getElementById('view-progress_tracker');
        if (trackerView && !trackerView.classList.contains('hidden')) {
            Tracker.renderTracker();
        }

        const pendingView = document.getElementById('view-pending_assignment');
        if (pendingView && !pendingView.classList.contains('hidden')) {
            window.adminApp.renderPendingAssignment();
        }

        const deliveryView = document.getElementById('view-delivery_report');
        if (deliveryView && !deliveryView.classList.contains('hidden')) {
            const weekPicker = document.getElementById('delivery-week-picker');
            if (weekPicker && weekPicker.value) {
                Monitoring.renderDeliveryReport(weekPicker.value);
            }
        }

        const costingView = document.getElementById('view-costing_report');
        if (costingView && !costingView.classList.contains('hidden')) {
            Costing.renderCostingOrderList();
        }

        const costingDetailView = document.getElementById('view-costing_detail');
        if (costingDetailView && !costingDetailView.classList.contains('hidden')) {
            Costing.renderCostingDetailContent();
        }

        const projectOverviewView = document.getElementById('view-project_overview');
        if (projectOverviewView && !projectOverviewView.classList.contains('hidden') && window.adminApp.renderProjectOverview) {
            window.adminApp.renderProjectOverview();
        }

        refreshDashboard();
    }, isTrashView);
}

function switchActiveUnit(unitId) {
    if (!Units.UNITS[unitId]) return;
    const currentUnit = Units.getActiveUnit();
    if (currentUnit === unitId) {
        window.adminApp.closeUnitModal();
        return;
    }

    stopUnitSubscriptions();

    currentMembers = [];
    currentProjects = [];
    currentOrders = [];
    currentInventory = [];
    currentTransactions = [];

    Units.setActiveUnit(unitId);
    updateUnitUI();
    window.adminApp.closeUnitModal();

    startUnitSubscriptions();

    const activeView = UI.getActiveView();
    if (activeView === 'monitoring') {
        Monitoring.renderTable(currentOrders);
    } else if (activeView === 'dc_register') {
        DCRegister.renderDCTable(currentOrders);
    } else if (activeView === 'project_management') {
        window.adminApp.filterProjects();
        window.adminApp.updateProjectStats();
    } else if (activeView === 'team_org') {
        UI.renderMemberList(currentMembers);
    } else if (activeView === 'inventory_management') {
        window.adminApp.initInventory();
    } else if (activeView === 'payslip') {
        Payslip.renderPayslipDashboard(currentMembers);
    }

    refreshDashboard();
}

// Global App Object
window.adminApp = {
    toggleSidebar: () => {
        const container = document.getElementById('dashboard-container');
        if (!container) return;
        container.classList.toggle('sidebar-collapsed');
        const isCollapsed = container.classList.contains('sidebar-collapsed');
        localStorage.setItem('ies_sidebar_collapsed', isCollapsed ? 'true' : 'false');
    },
    // Multi-Unit Facility Management
    openUnitModal: () => {
        const modal = document.getElementById('modal-unit-selector');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('active');
            updateUnitUI();
        }
    },
    closeUnitModal: () => {
        const modal = document.getElementById('modal-unit-selector');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('active');
        }
    },
    selectUnit: (unitId) => switchActiveUnit(unitId),
    switchActiveUnit: (unitId) => switchActiveUnit(unitId),
    getActiveUnit: () => Units.getActiveUnit(),
    getActiveUnitConfig: () => Units.getActiveUnitConfig(),
    currentEditingProjectId: null,
    switchView: (viewName) => {
        // Payroll Security Gate: Intercept BEFORE switching view
        if (viewName === 'payslip' || viewName === 'payslip_detail') {
            if (!Payslip.isPayrollUnlocked()) {
                Payslip.openPayrollPasswordModal();
                return;
            }
        }

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

        if (viewName === 'progress_tracker') {
            Tracker.renderTracker();
        }

        if (viewName === 'costing_report') {
            Costing.renderCostingOrderList();
        }

        if (viewName === 'payslip') {
            Payslip.renderPayslipDashboard(currentMembers);
        }
    },

    // Payslip Module Methods
    renderPayslipDashboard: () => Payslip.renderPayslipDashboard(currentMembers),
    openNewPayslipForm: () => Payslip.openPayslipForm(),
    openEditPayslip: (id) => Payslip.openPayslipForm(id),
    savePayslip: () => Payslip.savePayslip(),
    deletePayslipConfirm: (id) => Payslip.deletePayslipConfirm(id),
    backToPayslipDashboard: () => Payslip.backToPayslipDashboard(),
    setPayslipMonth: (month) => Payslip.setPayslipMonth(month),
    filterPayslips: (query) => Payslip.filterPayslips(query),
    exportMonthlyPayrollCSV: () => Payslip.exportMonthlyPayrollCSV(),
    openPayrollPasswordModal: () => Payslip.openPayrollPasswordModal(),
    closePayrollPasswordModal: () => Payslip.closePayrollPasswordModal(),
    submitPayrollPassword: () => Payslip.submitPayrollPassword(),
    lockPayroll: () => Payslip.lockPayroll(),
    onPayslipEmployeeSelected: (id) => Payslip.onEmployeeSelected(id),
    addEarningRow: () => Payslip.addEarningRow(),
    addDeductionRow: () => Payslip.addDeductionRow(),
    onEarningAmountChange: (el) => Payslip.onEarningAmountChange(el),
    onEarningLabelChange: (el) => Payslip.onEarningLabelChange(el),
    onDeductionAmountChange: (el) => Payslip.onDeductionAmountChange(el),
    onDeductionLabelChange: (el) => Payslip.onDeductionLabelChange(el),
    onPayPeriodChange: () => Payslip.onPayPeriodChange(),
    updateLiveCalculations: () => Payslip.updateLiveCalculations(),
    triggerYTDRecalculation: () => Payslip.triggerYTDRecalculation(),
    cloneFromLastMonth: () => Payslip.cloneFromLastMonth(),
    applySelectedFormat: (id) => Payslip.applySelectedFormat(id),
    saveCurrentFormatAsTemplate: () => Payslip.saveCurrentFormatAsTemplate(),
    viewPrintPayslip: (id) => Payslip.viewPrintPayslip(id),
    printCurrentPayslip: () => Payslip.printCurrentPayslip(),
    downloadSinglePayslipPDF: (id) => Payslip.downloadSinglePayslipPDF(id),
    downloadCurrentPayslipPDF: () => Payslip.downloadCurrentPayslipPDF(),

    // Costing Report Methods
    renderCostingReport: () => Costing.renderCostingOrderList(),
    openCostingDetail: (orderId) => Costing.openCostingDetail(orderId),
    backToCostingOrders: () => Costing.backToOrderList(),
    openAddCostingExpense: () => Costing.openExpenseModal(),
    openEditCostingExpense: (expenseId) => Costing.openExpenseModal(expenseId),
    handleSaveCostingExpense: (e) => Costing.handleSaveExpense(e),
    deleteCostingExpense: (expenseId) => Costing.handleDeleteExpense(expenseId),
    setCostingSearch: (query) => Costing.setCostingSearch(query),
    setCostingStatusFilter: (status) => Costing.setCostingStatusFilter(status),
    setCostingMonthFilter: (month) => Costing.setCostingMonthFilter(month),
    printCostingReport: () => Costing.printCostingReport(),
    exportCostingPDF: () => Costing.exportCostingPDF(),
    exportCostingCSV: () => Costing.exportCostingCSV(),
    exportAllCostingOrdersCSV: () => Costing.exportAllOrdersCostingCSV(),
    handleCostingOrderFieldChange: (field, val) => Costing.updateOrderField(field, val),
    handleInlineExpenseEdit: (id, field, val) => Costing.updateExpenseField(id, field, val),
    addQuickCostingExpenseRow: () => Costing.addQuickExpenseRow(),

    trackerInlineEdit: (id, field, val) => Tracker.handleInlineEdit(id, field, val),
    trackerFilterCustomer: (val) => Tracker.setFilterCustomer(val),
    trackerSort: (key) => Tracker.setSortTracker(key),
    exportTrackerCSV: () => Tracker.exportTrackerCSV(),


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
    departmentsList: ["Management", "Admin", "Fabrication", "CNC & VMC", "SPM", "HR"],
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
        setField('pan', member.pan || '');
        setField('uan', member.uan || '');

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
            reportingManagerId: formData.get('reportingManager') || null,
            pan: (formData.get('pan') || '').trim().toUpperCase(),
            uan: (formData.get('uan') || '').trim()
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
        const customerFilter = document.getElementById('project-customer-filter')?.value || 'all';

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
            const matchesCustomer = customerFilter === 'all' || (p.customerName && p.customerName.trim().toUpperCase() === customerFilter.toUpperCase());

            return matchesSearch && matchesStatus && matchesType && matchesCustomer;
        });

        window.adminApp.renderProjectCards(filtered);
        window.adminApp.updateProjectStats();
    },

    setProjectView: (mode) => {
        window.adminApp.projectViewMode = 'list';
        localStorage.setItem('projectViewMode', 'list');
        window.adminApp.filterProjects();
    },

    renderProjectTable: (projects) => {
        const tbody = document.getElementById('project-list-body');
        if (!tbody) return;

        if (projects.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center py-12 text-slate-400">No projects found.</td></tr>';
            return;
        }

        const allOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
        const allExpenses = Costing.getAllExpenses ? Costing.getAllExpenses() : [];

        tbody.innerHTML = projects.map((p, idx) => {
            const statusClass = (p.status || 'draft').toLowerCase().replace(/\s+/g, '-');
            const isTrashed = !!p.isDeleted;
            const ioKey = String(p.projectId || '').trim().toUpperCase();
            const matchingOrder = allOrders.find(o => String(o.internalOrderNo || '').trim().toUpperCase() === ioKey && o.entryType !== 'delivery_report');

            const drgNo = p.drawingNo || (matchingOrder ? matchingOrder.drawingNo : '') || '-';
            const teamName = p.crTeam || p.jobType || (matchingOrder ? matchingOrder.department : '') || 'Admin';
            const rawTargetDel = p.crDeliveryDate || p.expectedCompletion || (matchingOrder ? matchingOrder.deliveryDateActual : '');
            const deliveryDate = rawTargetDel ? new Date(rawTargetDel).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';

            const isContractFiled = p.contractFiled || p.crStatus === 'Finalized' || ['Approved', 'In Progress', 'Completed'].includes(p.status);
            const crBadge = isContractFiled
                ? `<button class="pm-badge-filed" onclick="event.stopPropagation(); window.adminApp.viewProjectDetails('${p.id}', 'review')" title="Contract Review Filed (Click to View/Edit)">✓ Filled</button>`
                : `<button class="pm-badge-pending" onclick="event.stopPropagation(); window.adminApp.viewProjectDetails('${p.id}', 'review')" title="Contract Review Pending (Click to Fill)">Pending</button>`;

            const orderExpenses = allExpenses.filter(e =>
                (matchingOrder && e.orderId === matchingOrder.id) ||
                String(e.internalOrderNo || '').trim().toUpperCase() === ioKey
            );
            const totalExp = orderExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
            const hasCosting = orderExpenses.length > 0 || (p.costingItems && p.costingItems.length > 0) || (p.expenses && p.expenses.length > 0) || (parseFloat(p.totalCost) > 0);
            const costingBadge = hasCosting
                ? `<button class="pm-badge-filed" onclick="event.stopPropagation(); window.adminApp.viewProjectDetails('${p.id}', 'costing')" title="Costing Filled: ₹${totalExp.toLocaleString('en-IN')} (Click to View Sheet)">✓ Filled</button>`
                : `<button class="pm-badge-pending" onclick="event.stopPropagation(); window.adminApp.viewProjectDetails('${p.id}', 'costing')" title="Costing Pending (Click to Open Sheet)">Pending</button>`;

            // Dynamic Project Status Dropdown (syncs across PM, Master Order Tracker & Dashboard)
            const currentStatus = p.status || 'Draft';
            const wfClass = 'wf-' + currentStatus.toLowerCase().replace(/\s+/g, '-');
            const safeProjId = String(p.id || '').replace(/'/g, "\\'");
            const safeIoAttr = String(p.projectId || '').replace(/'/g, "\\'");
            const stageOptions = (window.adminApp.PROJECT_WORKFLOW_STAGES || ['Draft', 'Under Review', 'Approved', 'In Progress', 'Completed']).map(s =>
                `<option value="${s}" ${s === currentStatus ? 'selected' : ''}>${s}</option>`
            ).join('');
            const statusDropdown = `
                <div class="po-wf-cell" onclick="event.stopPropagation();">
                    <select class="po-wf-select ${wfClass}" title="Change Project Status"
                        onchange="window.adminApp.changeOverviewStatus(this, '${safeIoAttr}', '${safeProjId}')">
                        ${stageOptions}
                    </select>
                </div>
            `;

            const rowStatusCls = p.status === 'Completed' ? 'row-delivered' : (isContractFiled ? 'row-portion' : 'row-pending');

            const actions = isTrashed ? `
                <div class="flex gap-1.5 justify-center">
                    <button class="pm-action-btn restore-btn" onclick="event.stopPropagation(); window.adminApp.restoreProject('${p.id}')">Restore</button>
                    <button class="pm-action-btn" style="color:#ef4444;" onclick="event.stopPropagation(); window.adminApp.permanentDeleteProject('${p.id}')">Delete</button>
                </div>
            ` : `
                <div class="flex gap-1.5 justify-center items-center">
                    <button class="pm-quick-jump-btn cr-btn" onclick="event.stopPropagation(); window.adminApp.viewProjectDetails('${p.id}', 'review')" title="Open Contract Review">
                        📋 CR
                    </button>
                    <button class="pm-quick-jump-btn cost-btn" onclick="event.stopPropagation(); window.adminApp.viewProjectDetails('${p.id}', 'costing')" title="Open Costing Sheet">
                        💰 Costing
                    </button>
                    <button class="action-btn edit" onclick="event.stopPropagation(); window.adminApp.editProject('${p.id}')" title="Edit Project">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                    </button>
                    <button class="action-btn delete" onclick="event.stopPropagation(); window.adminApp.trashProject('${p.id}')" title="Move to Trash">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            `;

            return `
                <tr class="${rowStatusCls} ${isTrashed ? 'opacity-50' : ''} cursor-pointer" onclick="window.adminApp.viewProjectDetails('${p.id}', 'review')">
                    <td class="sticky-pm-sno text-center font-mono text-slate-400">${idx + 1}</td>
                    <td class="sticky-pm-io"><span class="io-order-pill">${p.projectId || '-'}</span></td>
                    <td class="font-bold text-slate-800">${(p.customerName || '-').toUpperCase()}</td>
                    <td class="font-mono text-slate-700 font-semibold">${String(drgNo).toUpperCase()}</td>
                    <td class="font-semibold text-slate-700 max-w-[220px] truncate" title="${(p.name || '').toUpperCase()}">${(p.name || '-').toUpperCase()}</td>
                    <td class="text-center"><span class="version-tag">${teamName}</span></td>
                    <td class="text-center">${crBadge}</td>
                    <td class="text-center font-mono text-slate-600">${deliveryDate}</td>
                    <td class="text-center">${costingBadge}</td>
                    <td class="text-center">${statusDropdown}</td>
                    <td class="text-center">${actions}</td>
                </tr>
            `;
        }).join('');
    },

    updateProjectStats: () => {
        const active = currentProjects.filter(p => !p.isDeleted);
        const completed = active.filter(p => p.status === 'Completed');
        const trashed = currentProjects.filter(p => !!p.isDeleted);
        const crFiledCount = active.filter(p => p.contractFiled || p.crStatus === 'Finalized' || ['Approved', 'In Progress', 'Completed'].includes(p.status)).length;

        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl('pm-stat-total', active.length);
        setEl('pm-stat-active', active.length - completed.length);
        setEl('pm-stat-cr-filed', `${crFiledCount} / ${active.length}`);
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
        const table = body ? body.closest('table') : null;
        const thead = table ? table.querySelector('thead') : null;
        if (!body) return;

        // Filter items based on trash view
        const displayItems = items.filter(item => !!item.isDeleted === isInventoryTrashView);

        // Adjust 2-Tier Table Header for Active vs Trash View
        if (thead) {
            const sortIcon = (col) => {
                if (inventorySortState.column !== col) return '<span class="inv-sort-icon" style="opacity:0.5; margin-left:4px;">⇅</span>';
                return inventorySortState.direction === 'asc'
                    ? '<span class="inv-sort-icon active" style="color:#34d399; margin-left:4px;">▲</span>'
                    : '<span class="inv-sort-icon active" style="color:#34d399; margin-left:4px;">▼</span>';
            };
            if (isInventoryTrashView) {
                thead.innerHTML = `
                    <tr class="group-header-row">
                        <th rowspan="2" class="group-sno sticky-col-header text-center" style="width: 48px; min-width: 48px;">S.No</th>
                        <th colspan="4" class="group-io text-center">Deleted Inventory Items (Trash)</th>
                        <th rowspan="2" class="group-actions text-center" style="width: 170px; min-width: 170px;">Actions</th>
                    </tr>
                    <tr class="sub-header-row">
                        <th class="sub-header" style="min-width: 220px;">Item Details</th>
                        <th class="sub-header text-center" style="min-width: 130px;">Category</th>
                        <th class="sub-header text-center" style="min-width: 130px;">Last Stock</th>
                        <th class="sub-header section-end text-center" style="min-width: 120px;">Deleted On</th>
                    </tr>
                `;
            } else {
                thead.innerHTML = `
                    <tr class="group-header-row">
                        <th rowspan="2" class="group-sno sticky-col-header text-center" style="width: 48px; min-width: 48px;">S.No</th>
                        <th colspan="3" class="group-io text-center">1. Item Specification &amp; Storage</th>
                        <th colspan="2" class="group-price text-center">2. Stock Level &amp; Status</th>
                        <th rowspan="2" class="group-actions text-center" style="width: 170px; min-width: 170px;">Actions</th>
                    </tr>
                    <tr class="sub-header-row">
                        <th class="sub-header inv-sortable cursor-pointer" style="min-width: 220px;" onclick="window.adminApp.sortInventory('name')">Item Details ${sortIcon('name')}</th>
                        <th class="sub-header text-center inv-sortable cursor-pointer" style="min-width: 130px;" onclick="window.adminApp.sortInventory('category')">Category ${sortIcon('category')}</th>
                        <th class="sub-header section-end" style="min-width: 130px;">Location / Bin</th>
                        <th class="sub-header text-center inv-sortable cursor-pointer" style="min-width: 130px;" onclick="window.adminApp.sortInventory('stock')">Current Stock ${sortIcon('stock')}</th>
                        <th class="sub-header section-end text-center inv-sortable cursor-pointer" style="min-width: 120px;" onclick="window.adminApp.sortInventory('status')">Status ${sortIcon('status')}</th>
                    </tr>
                `;
            }
        }

        if (displayItems.length === 0) {
            const colspan = isInventoryTrashView ? 6 : 7;
            body.innerHTML = `
                <tr>
                    <td colspan="${colspan}" class="p-12 text-center text-slate-400">
                        <div class="flex flex-col items-center gap-2">
                            <p class="italic">No ${isInventoryTrashView ? 'deleted' : 'inventory'} items found.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        body.innerHTML = displayItems.map((item, idx) => {
            const isLow = item.currentStock <= item.minimumLevel && item.currentStock > 0;
            const isOut = item.currentStock <= 0;

            let statusBadge = `<span class="status-badge status-delivered">In Stock</span>`;
            if (isOut) statusBadge = `<span class="status-badge" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca;">Out of Stock</span>`;
            else if (isLow) statusBadge = `<span class="status-badge status-portion">Low Stock</span>`;

            const rowClass = isOut ? 'row-pending' : (isLow ? 'row-portion' : '');

            // Thumbnail Logic
            let thumb = `
                <div class="inventory-icon-placeholder" style="width:32px; height:32px; border-radius:7px; background:#f1f5f9; border:1px solid #e2e8f0; display:inline-flex; align-items:center; justify-content:center; font-size:13px; flex-shrink:0;">
                    <span>${item.category === 'Tool' ? '🔧' : (item.category === 'Raw Material' ? '🏗️' : '📦')}</span>
                </div>
            `;
            if (item.photoUrl) {
                const safeName = (item.name || '').replace(/'/g, "\\'");
                thumb = `<img src="${item.photoUrl}" class="inventory-thumb cursor-pointer hover:ring-2 hover:ring-teal-500 transition-all" style="width:32px; height:32px; border-radius:7px; object-fit:cover; flex-shrink:0;" alt="${item.name}" onclick="event.stopPropagation(); window.adminApp.openPhotoViewer('${item.photoUrl}', '${safeName}')">`;
            }

            if (isInventoryTrashView) {
                return `
                    <tr>
                        <td class="sticky-col text-center font-mono text-slate-400">${idx + 1}</td>
                        <td>
                            <div class="flex items-center gap-2.5">
                                ${thumb}
                                <span class="font-bold text-slate-800">${item.name}</span>
                            </div>
                        </td>
                        <td class="text-center"><span class="version-tag">${item.category || '-'}</span></td>
                        <td class="text-center font-bold text-slate-700">${item.currentStock} ${item.unit || ''}</td>
                        <td class="section-end text-center text-slate-500 font-mono text-xs">${item.updatedAt ? new Date(item.updatedAt.seconds * 1000).toLocaleDateString('en-IN') : 'Recently'}</td>
                        <td class="text-center">
                            <div class="flex justify-center gap-1.5">
                                <button class="btn btn-secondary btn-sm text-emerald-700" onclick="window.adminApp.restoreInventoryItem('${item.id}')" title="Restore">Restore</button>
                                <button class="btn btn-danger btn-sm" onclick="window.adminApp.permanentDeleteInventoryItem('${item.id}', '${item.name}')" title="Delete Permanently">Delete</button>
                            </div>
                        </td>
                    </tr>
                `;
            }

            return `
                <tr class="${rowClass}">
                    <td class="sticky-col text-center font-mono text-slate-400">${idx + 1}</td>
                    <td>
                        <div class="flex items-center gap-2.5">
                            ${thumb}
                            <div>
                                <div class="font-bold text-slate-800">${item.name}</div>
                                ${item.price ? `<div class="text-[10px] text-slate-400 font-mono">₹${Number(item.price).toLocaleString('en-IN')}/${item.unit || 'unit'}</div>` : ''}
                            </div>
                        </div>
                    </td>
                    <td class="text-center"><span class="version-tag">${item.category || '-'}</span></td>
                    <td class="section-end font-semibold text-slate-600">${item.location || '-'}</td>
                    <td class="text-center">
                        <span class="font-extrabold text-slate-800 text-sm">${item.currentStock}</span>
                        <span class="text-[10px] text-slate-500 uppercase font-bold ml-1">${item.unit || ''}</span>
                    </td>
                    <td class="section-end text-center">${statusBadge}</td>
                    <td class="text-center">
                        <div class="flex justify-center items-center gap-1.5">
                            <button class="pm-quick-jump-btn cr-btn" onclick='window.adminApp.openAdjustStockModal("${item.id}")'>Adjust</button>
                            <button class="action-btn edit" onclick="window.adminApp.editInventoryItem('${item.id}')" title="Edit Item">
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
            body.innerHTML = '<tr><td colspan="12" class="p-8 text-center text-slate-400 italic">No transactions found.</td></tr>';
            return;
        }

        body.innerHTML = transactions.map((t, idx) => {
            const date = t.timestamp?.toDate ? t.timestamp.toDate() : (t.timestamp?.seconds ? new Date(t.timestamp.seconds * 1000) : new Date());
            const formattedDate = date.toLocaleDateString('en-IN');
            const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const unitPrice = t.unitPrice || 0;
            const totalCost = t.totalCost || (t.quantity * unitPrice);
            const performedBy = t.user || t.performedBy || '-';
            const isIn = (t.type || '').toUpperCase() === 'IN';

            return `
                <tr>
                    <td class="sticky-col text-center font-mono text-slate-400">${idx + 1}</td>
                    <td>
                        <div class="text-slate-800 font-bold text-xs font-mono">${formattedDate}</div>
                        <div class="text-slate-400 text-[10px] uppercase font-mono">${formattedTime}</div>
                    </td>
                    <td class="font-bold text-slate-800">${t.itemName || '-'}</td>
                    <td class="section-end text-center"><span class="version-tag">${t.category || 'General'}</span></td>
                    <td class="text-center">
                        <span class="status-badge ${isIn ? 'status-delivered' : 'status-portion'}">${t.type || 'OUT'}</span>
                    </td>
                    <td class="text-center font-extrabold ${isIn ? 'text-emerald-700' : 'text-rose-600'}">${isIn ? '+' : '-'}${t.quantity}</td>
                    <td class="text-right font-mono text-slate-600">₹${unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="section-end text-right font-mono font-bold text-slate-800">₹${totalCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="text-slate-600 truncate max-w-[160px]" title="${t.reason || ''}">${t.reason || '-'}</td>
                    <td class="text-center">${t.orderId ? `<span class="io-order-pill">${t.orderId}</span>` : '<span class="text-slate-400">-</span>'}</td>
                    <td class="section-end font-semibold text-slate-700">${performedBy}</td>
                    <td class="text-center">
                        <button class="action-btn delete" onclick="window.adminApp.deleteTransactionRow('${t.id}')" title="Delete Transaction">
                            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        const pw = window.open('', '_blank', 'width=900,height=1000');
        if (!pw) return;

        // --- Helpers ---
        const v = (id) => document.getElementById(id)?.value || '';
        const formatDate = (isoStr) => {
            if (!isoStr || !isoStr.includes('-')) return isoStr || '';
            const [y, m, d] = isoStr.split('-');
            return `${d}-${m}-${y}`;
        };
        const selText = (id) => { const s = document.getElementById(id); return s ? (s.options?.[s.selectedIndex]?.text || s.value || '') : ''; };
        const tagText = (containerId) => {
            const c = document.getElementById(containerId);
            if (!c) return '';
            // Try reading visible tag text first
            const tags = Array.from(c.querySelectorAll('.search-tag-text, .tag-text')).map(t => t.textContent.trim()).filter(Boolean);
            if (tags.length) return tags.join(', ');
            // Fallback: hidden input (may contain JSON array string like '["Name"]')
            let raw = c.querySelector('input[type=hidden]')?.value || '';
            try { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.join(', '); } catch(e) {}
            return raw.replace(/^\["?|"?\]$/g, '').replace(/","/g, ', ');
        };

        const ioNo = v('cr-review-no');
        const poNo = v('cr-po-no');
        const drgNo = v('cr-drawing-no');
        const crDate = formatDate(v('cr-date'));
        const delDate = formatDate(v('cr-delivery-date'));
        const contactPerson = v('cr-contact-person');
        const phone = v('cr-phone');
        const intDate = formatDate(v('cr-internal-date'));
        const ioNumber = v('cr-io-number');
        const team = selText('cr-team').replace('Select Team', '');
        const accountability = tagText('cr-search-accountability');
        const teamLeader = tagText('cr-search-team-leader');
        const members = tagText('cr-search-members');
        const instructions = v('cr-important-instructions');
        const printDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        // 6M comments
        const cmt = (f) => document.querySelector(`[data-field="cmt-${f}"]`)?.value || '';
        const sixM = [
            ['Matl', cmt('matl')], ['Machine', cmt('machine')], ['Man', cmt('man')],
            ['Method', cmt('method')], ['Measure', cmt('measure')], ['Tools', cmt('tools')]
        ];

        // Decisions
        const decCap = selText('cr-decision-cap') === '-' ? '' : (document.querySelector('[data-field="cr-decision-cap"]')?.value || '');
        const decOA = selText('cr-decision-oa') === '-' ? '' : (document.querySelector('[data-field="cr-decision-oa"]')?.value || '');
        const preparedBy = tagText('cr-search-prepared');
        const reviewedBy = tagText('cr-search-reviewed');
        const approvedBy = tagText('cr-search-approved');

        // Checklist rows from DOM
        const checklistRows = [];
        document.querySelectorAll('#cr-excel-checklist .cr-item-row').forEach((row, i) => {
            const label = row.querySelector('.cr-custom-label')?.value || row.querySelector('span.px-3')?.textContent?.trim() || '';
            const req = row.dataset.reqVal || '';
            const out = row.dataset.outVal || '';
            const more = row.dataset.moreVal || 'false';
            const remarks = row.querySelector('.cr-remarks-input')?.value || '';
            checklistRows.push({ num: i + 1, label, req, out, more, remarks });
        });

        // --- Build checklist rows HTML ---
        const tick = '✓';
        const circle = '○';
        const checklistHTML = checklistRows.map(r => `
            <tr>
                <td style="text-align:center;color:#64748b;">${r.num}</td>
                <td style="font-weight:600;">${r.label}</td>
                <td class="chk ${r.req === 'yes' ? 'yes' : ''}">${r.req === 'yes' ? tick : circle}</td>
                <td class="chk ${r.req === 'no' ? 'no' : ''}">${r.req === 'no' ? tick : circle}</td>
                <td class="chk ${r.out === 'ok' ? 'ok' : ''}">${r.out === 'ok' ? tick : circle}</td>
                <td class="chk ${r.out === 'nok' ? 'nok' : ''}">${r.out === 'nok' ? tick : circle}</td>
                <td class="chk ${r.out === 'na' ? 'na' : ''}">${r.out === 'na' ? tick : circle}</td>
                <td class="chk ${r.more === 'true' ? 'more' : ''}">${r.more === 'true' ? tick : circle}</td>
                <td style="color:#475569;">${r.remarks}</td>
            </tr>
        `).join('');

        // --- Write the complete self-contained document ---
        pw.document.write(`<!DOCTYPE html><html><head>
        <title>Contract Review - ${ioNo}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
            @page { size: A4 portrait; margin: 10mm 12mm; }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Inter', sans-serif; font-size: 9.5pt; color: #1e293b; line-height: 1.4;
                -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

            /* === HEADER === */
            .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
            .hdr-left .company { font-size: 18pt; font-weight: 800; color: #0f172a; letter-spacing: 0.02em; }
            .hdr-left .tagline { font-size: 8.5pt; color: #64748b; letter-spacing: 0.08em; margin-top: 2px; }
            .hdr-right { text-align: right; }
            .hdr-right .title { font-size: 15pt; font-weight: 700; color: #0f172a; }
            .hdr-right .date { font-size: 9pt; color: #64748b; white-space: nowrap; }
            .hdr-right .io { font-size: 11pt; font-weight: 700; color: #059669; margin-top: 2px; white-space: nowrap; }

            /* === TABLES === */
            table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
            td, th { border: 1.5px solid #94a3b8; padding: 4px 8px; font-size: 9pt; vertical-align: middle; }

            /* Section headers */
            .sec-hdr { background: #f0fdf4; color: #166534; font-weight: 800; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; padding: 6px 10px; }

            /* Master data labels */
            .lbl { background: #f8fafc; font-weight: 700; font-size: 8pt; color: #334155; white-space: normal; overflow: visible; }
            .val { font-weight: 600; color: #0f172a; white-space: normal; overflow-wrap: break-word; overflow: visible; }
            .val.nowrap { white-space: nowrap; }

            /* Checklist Table specifically needs fixed layout for alignment */
            .chk-table { table-layout: fixed; }

            /* Checklist Colors */
            .chk { text-align: center; width: 35px; font-size: 11pt; color: #cbd5e1; }
            .chk.yes, .chk.ok { background: #dcfce7; color: #16a34a; font-weight: 800; }
            .chk.no, .chk.nok { background: #fee2e2; color: #dc2626; font-weight: 800; }
            .chk.na { background: #f1f5f9; color: #64748b; font-weight: 700; }
            .chk.more { background: #fef3c7; color: #d97706; font-weight: 800; }

            /* Sub-header row */
            .sub-hdr td { background: #f0fdf4; color: #166534; font-weight: 800; font-size: 8pt; text-align: center; text-transform: uppercase; padding: 4px; }

            /* Spacing between sections */
            .spacer { height: 8px; }

            /* Instructions area */
            .instr-box { min-height: 80px; padding: 8px 10px; white-space: pre-wrap; font-size: 9pt; color: #334155; vertical-align: top; }

            /* Decision */
            .dec-val { font-weight: 800; text-align: center; font-size: 10pt; }
            .dec-ok { color: #16a34a; }
            .dec-nok { color: #dc2626; }

            /* Footer notes */
            .notes { font-size: 8pt; color: #64748b; padding: 8px 10px; border-top: 1px dashed #cbd5e1; margin-top: 10px; }
            .notes strong { font-size: 8.5pt; color: #334155; text-transform: uppercase; letter-spacing: 0.05em; }
        </style></head><body>

        <!-- HEADER -->
        <div class="hdr">
            <div class="hdr-left">
                <div class="company">INNOVATIVE ENGINEERING SOLUTIONS</div>
                <div class="tagline">PRECISION • QUALITY • DELIVERY</div>
            </div>
            <div class="hdr-right">
                <div class="title">Contract Review</div>
                <div class="date">${printDate}</div>
                <div class="io">${ioNo}</div>
            </div>
        </div>

        <!-- SECTION 1: CUSTOMER DATA + INTERNAL ORDER -->
        <table>
            <colgroup>
                <col style="width:8%"><col style="width:15%">
                <col style="width:8%"><col style="width:14%">
                <col style="width:9%"><col style="width:18%">
                <col style="width:8%"><col style="width:14%">
                <col style="width:6%">
            </colgroup>
            <tr>
                <td colspan="4" class="sec-hdr">Customer Data</td>
                <td colspan="5" class="sec-hdr">Internal Order</td>
            </tr>
            <tr>
                <td class="lbl">PO No</td>
                <td class="val">${poNo}</td>
                <td class="lbl">Date</td>
                <td class="val nowrap">${crDate}</td>
                <td class="lbl">Date</td>
                <td class="val nowrap">${intDate}</td>
                <td class="lbl">IO Num</td>
                <td class="val nowrap" colspan="2" style="color:#059669;font-weight:800;">${ioNumber}</td>
            </tr>
            <tr>
                <td class="lbl">Drg No</td>
                <td class="val">${drgNo}</td>
                <td class="lbl">Del Date</td>
                <td class="val nowrap">${delDate}</td>
                <td class="lbl">Account</td>
                <td class="val" colspan="2">${accountability}</td>
                <td class="lbl">Team</td>
                <td class="val">${team}</td>
            </tr>
            <tr>
                <td class="lbl">Contact</td>
                <td class="val">${contactPerson}</td>
                <td class="lbl">Ph No</td>
                <td class="val nowrap">${phone}</td>
                <td class="lbl">Team Ldr</td>
                <td class="val" colspan="2">${teamLeader}</td>
                <td class="lbl">Members</td>
                <td class="val">${members}</td>
            </tr>
        </table>

        <div class="spacer"></div>

        <!-- SECTION 2: CHECKLIST -->
        <table class="chk-table">
            <tr class="sub-hdr">
                <td rowspan="2" style="width:40px;">S.No</td>
                <td rowspan="2">Checklist Items</td>
                <td colspan="2" style="width:80px;">Req</td>
                <td colspan="4" style="width:160px;">Review Outcome</td>
                <td rowspan="2" style="width:250px;">Remarks</td>
            </tr>
            <tr class="sub-hdr">
                <td style="width:40px;">Yes</td><td style="width:40px;">No</td>
                <td style="width:40px;">Ok</td><td style="width:40px;">Nok</td>
                <td style="width:40px;">N.A</td><td style="width:40px;">Clarity</td>
            </tr>
            ${checklistHTML}
        </table>

        <div class="spacer"></div>

        <!-- SECTION 3: INSTRUCTIONS + 6M -->
        <table>
            <tr>
                <td colspan="2" class="sec-hdr" style="width:55%;">Important Instructions</td>
                <td class="sec-hdr" style="width:15%;">6M Points</td>
                <td class="sec-hdr" style="width:30%;">Comments</td>
            </tr>
            <tr>
                <td colspan="2" rowspan="6" class="instr-box">${instructions.replace(/\n/g, '<br>')}</td>
                <td class="lbl">Matl</td><td class="val">${sixM[0][1]}</td>
            </tr>
            <tr><td class="lbl">Machine</td><td class="val">${sixM[1][1]}</td></tr>
            <tr><td class="lbl">Man</td><td class="val">${sixM[2][1]}</td></tr>
            <tr><td class="lbl">Method</td><td class="val">${sixM[3][1]}</td></tr>
            <tr><td class="lbl">Measure</td><td class="val">${sixM[4][1]}</td></tr>
            <tr><td class="lbl">Tools</td><td class="val">${sixM[5][1]}</td></tr>
        </table>

        <div class="spacer"></div>

        <!-- SECTION 4: FINAL VERIFICATION -->
        <table>
            <tr><td colspan="8" class="sec-hdr">Final Verification & Order Acceptance</td></tr>
            <tr class="sub-hdr">
                <td colspan="2">Decision</td>
                <td style="width:80px;">Ok/Nok</td>
                <td colspan="2">Prepared By</td>
                <td colspan="2">Reviewed By</td>
                <td>Approved By</td>
            </tr>
            <tr>
                <td colspan="2" class="lbl" style="text-align:right;">Capability</td>
                <td class="dec-val ${decCap === 'ok' ? 'dec-ok' : decCap === 'nok' ? 'dec-nok' : ''}">${decCap ? decCap.toUpperCase() : ''}</td>
                <td colspan="2" rowspan="2" class="val wrap" style="text-align:center;height:45px;">${preparedBy}</td>
                <td colspan="2" rowspan="2" class="val wrap" style="text-align:center;">${reviewedBy}</td>
                <td rowspan="2" class="val wrap" style="text-align:center;">${approvedBy}</td>
            </tr>
            <tr>
                <td colspan="2" class="lbl" style="text-align:right;">Order Acceptance</td>
                <td class="dec-val ${decOA === 'ok' ? 'dec-ok' : decOA === 'nok' ? 'dec-nok' : ''}">${decOA ? decOA.toUpperCase() : ''}</td>
            </tr>
        </table>

        <!-- FOOTER NOTES -->
        <div class="notes">
            <strong>Execution Guidelines:</strong>
            1. PL to prepare Job Card and plan for resources from Day 1 itself for smooth completion.
            2. TL to own full Responsibility for Job Quality and Delivery.
        </div>

        <script>window.onload = () => setTimeout(() => window.print(), 400);</script>
        </body></html>`);
        pw.document.close();
    },

    renderProjectCards: (projects) => {
        const grid = document.getElementById('project-grid');
        const listView = document.getElementById('project-list-view');
        if (grid) grid.classList.add('hidden');
        if (listView) listView.classList.remove('hidden');
        window.adminApp.renderProjectTable(projects);
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

    registerProjectInMemory: (projectObj) => {
        if (!projectObj || !projectObj.id) return;
        const idx = currentProjects.findIndex(p => p.id === projectObj.id);
        if (idx >= 0) {
            currentProjects[idx] = { ...currentProjects[idx], ...projectObj };
        } else {
            currentProjects.unshift(projectObj);
        }
    },

    openProjectContractReview: async (projectDocId, orderData = null) => {
        await window.adminApp.viewProjectDetails(projectDocId, 'review', orderData);
    },

    viewProjectDetails: async (id, initialTab = 'review', fallbackOrderData = null) => {
        window.adminApp.currentEditingProjectId = id;
        let project = currentProjects.find(p => p.id === id);
        if (!project && fallbackOrderData) {
            project = {
                id,
                projectId: fallbackOrderData.internalOrderNo || '',
                name: fallbackOrderData.description || '',
                customerName: fallbackOrderData.customer || '',
                jobType: fallbackOrderData.department || 'CNC',
                drawingNo: fallbackOrderData.drawingNo || '',
                poNo: fallbackOrderData.poNo || '',
                status: 'Draft',
                currentStage: 'Intake'
            };
            currentProjects.unshift(project);
        }
        if (!project) return;

        window.adminApp.switchView('project_detail');

        // Populate Basic Info + Quick Metadata Pills
        const idDisplay = document.getElementById('detail-project-id');
        const nameDisplay = document.getElementById('detail-project-name');
        const statusDisplay = document.getElementById('detail-project-status');
        const headerStats = document.getElementById('dd-header-stats');

        const ioKey = String(project.projectId || '').trim().toUpperCase();
        const matchingOrder = currentOrders.find(o => String(o.internalOrderNo || '').trim().toUpperCase() === ioKey && o.entryType !== 'delivery_report') || fallbackOrderData;

        if (idDisplay) idDisplay.textContent = project.projectId;
        if (nameDisplay) nameDisplay.textContent = (project.name || project.projectDescription || project.projectName || matchingOrder?.description || 'PROJECT').toUpperCase();
        if (statusDisplay) {
            const textSpan = statusDisplay.querySelector('.dd-status-text') || statusDisplay.querySelector('span:last-of-type') || statusDisplay.querySelector('span');
            if (textSpan) textSpan.textContent = project.status || 'Draft';
            const statusCls = (project.status || 'Draft').toLowerCase().replace(/\s+/g, '-');
            statusDisplay.className = `status-badge ${statusCls} flex items-center gap-1.5 group`;
        }
        if (headerStats) {
            const cust = (project.customerName || matchingOrder?.customer || '-').toUpperCase();
            const drg = (project.drawingNo || matchingOrder?.drawingNo || '-').toUpperCase();
            const po = project.poNo || matchingOrder?.poNo || '-';
            const inDc = project.customerDcNo || matchingOrder?.customerDcNo || '-';
            const qty = matchingOrder?.qty || project.orderQty || '-';
            headerStats.innerHTML = `
                <div class="pm-meta-chip"><span class="pm-meta-lbl">CUSTOMER</span><span class="pm-meta-val">${cust}</span></div>
                <div class="pm-meta-chip"><span class="pm-meta-lbl">DRG NO</span><span class="pm-meta-val">${drg}</span></div>
                <div class="pm-meta-chip"><span class="pm-meta-lbl">PO NO</span><span class="pm-meta-val">${po}</span></div>
                <div class="pm-meta-chip"><span class="pm-meta-lbl">INWARD DC</span><span class="pm-meta-val">${inDc}</span></div>
                <div class="pm-meta-chip"><span class="pm-meta-lbl">QTY</span><span class="pm-meta-val">${qty}</span></div>
            `;
        }

        // Subscribe to Project Sub-collections (Files & Logs)
        DB.subscribeToProjectFiles(id, (files) => {
            window.adminApp.renderProjectFiles(files);
        });

        DB.subscribeToProjectAuditLogs(id, (logs) => {
            window.adminApp.renderProjectAuditLogs(logs);
        });

        // Load Contract Review form for this project
        await window.adminApp.loadContractReview(id);

        // Load Embedded Costing Sheet for this project
        Costing.loadEmbeddedProjectCosting(project.projectId, project);

        // Switch to requested tab ('review' or 'costing' or 'files')
        window.adminApp.switchDeepDiveTab(initialTab || 'review');
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
                Costing.loadEmbeddedProjectCosting(project.projectId, project);
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
            breakdownBody.innerHTML = '<tr><td colspan="5" style="padding: 0.6rem 1rem; text-align: center; color: #94a3b8; font-style: italic; font-size: 0.72rem; background: #f8fafc;">No delivery records found for this order.</td></tr>';
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

        // Set default department to Admin
        const deptInput = form ? form.querySelector('[name="department"]') : null;
        if (deptInput) deptInput.value = 'Admin';

        // Auto-generate next Order ID (YYYYYY-NNNN)
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
        
        // Use 4 digits padding from financial year 2026 onwards (i.e. prefix "202627-")
        const padLength = fyStart >= 2026 ? 4 : 3;
        const nextNum = String(maxNum + 1).padStart(padLength, '0');
        
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
                window.adminApp.addDCRow(existingOrder.dcNo, existingOrder.deliveryDateActual || existingOrder.date, existingOrder.deliveryQty || existingOrder.qty, existingOrder.total || '', existingOrder.billNo || '');
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
            setVal('billNo', existingOrder.billNo || '');
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

    addDCRow: (dcNo = '', date = '', qty = '', value = '', billNo = '') => {
        const container = document.getElementById('dc-rows-container');
        if (!container) return;

        const dateVal = date || new Date().toISOString().split('T')[0];
        const tr = document.createElement('tr');
        tr.className = 'dc-row';
        tr.innerHTML = `
            <td style="padding: 4px;"><input type="text" name="dcNo_row" class="form-input text-xs" style="padding: 4px 6px;" value="${dcNo}" placeholder="DC #"></td>
            <td style="padding: 4px;"><input type="date" name="dcDate_row" class="form-input text-xs" style="padding: 4px 6px;" value="${dateVal}"></td>
            <td style="padding: 4px;"><input type="text" name="billNo_row" class="form-input text-xs" style="padding: 4px 6px;" value="${billNo}" placeholder="Bill #"></td>
            <td style="padding: 4px;"><input type="number" name="dcQty_row" class="form-input text-xs text-right" style="padding: 4px 6px;" value="${qty}" placeholder="0" oninput="window.adminApp.calculateDCRowVal(this)"></td>
            <td style="padding: 4px;"><input type="number" name="dcVal_row" class="form-input text-xs text-right" style="padding: 4px 6px;" value="${value}" placeholder="₹0"></td>
            <td style="padding: 4px; text-align: center;">
                <button type="button" class="text-rose-500 hover:text-rose-700" onclick="this.closest('tr').remove()" title="Remove Row">
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
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
        if (order.billNo) {
            setVal('billNo', order.billNo);
            const firstBillRow = document.querySelector('#dc-rows-container [name="billNo_row"]');
            if (firstBillRow && !firstBillRow.value) {
                firstBillRow.value = order.billNo;
            }
        }
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
                const billNo = tr.querySelector('[name="billNo_row"]')?.value.trim() || '';
                const dcQty = parseFloat(tr.querySelector('[name="dcQty_row"]')?.value) || 0;
                const dcVal = parseFloat(tr.querySelector('[name="dcVal_row"]')?.value) || 0;

                if (dcNo || dcQty > 0 || billNo) {
                    dcRows.push({ dcNo, dcDate, billNo, dcQty, dcVal });
                }
            });
        }

        if (dcRows.length === 0) {
            alert("Please add at least one DC entry (DC Number, Bill Number, or Quantity).");
            return;
        }

        const baseData = {
            date: formData.get('date'),
            customer: (formData.get('customer') || '').trim().toUpperCase(),
            drawingNo: (formData.get('drawingNo') || '').trim().toUpperCase(),
            billNo: formData.get('billNo')?.trim() || '',
            description: (formData.get('description') || '').trim().toUpperCase(),
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
        try {
            for (let i = 0; i < dcRows.length; i++) {
                const row = dcRows[i];
                const entryData = {
                    ...baseData,
                    dcNo: row.dcNo,
                    deliveryDateActual: row.dcDate,
                    billNo: row.billNo || baseData.billNo || '',
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
                    (o.internalOrderNo || '').trim().toUpperCase() === ioNo.trim().toUpperCase() && (!o.entryType || o.entryType !== 'delivery_report')
                );

                if (originalOrder) {
                    const existingDeliveries = currentOrders.filter(o =>
                        o.entryType === 'delivery_report' &&
                        (o.internalOrderNo || '').trim().toUpperCase() === ioNo.trim().toUpperCase() && !o.isDeleted && !o.deleted &&
                        o.id !== orderId
                    );

                    const totalDelivered = existingDeliveries.reduce((sum, o) => sum + (parseFloat(o.deliveryQty) || 0), 0) +
                        dcRows.reduce((sum, r) => sum + r.dcQty, 0);

                    let allDCs = existingDeliveries.map(o => o.dcNo?.trim()).filter(dc => dc);
                    dcRows.forEach(r => {
                        if (r.dcNo && !allDCs.includes(r.dcNo)) allDCs.push(r.dcNo);
                    });
                    const pooledDCs = allDCs.join(', ');

                    let allBills = existingDeliveries.map(o => o.billNo?.trim()).filter(b => b);
                    dcRows.forEach(r => {
                        if (r.billNo && !allBills.includes(r.billNo)) allBills.push(r.billNo);
                    });
                    const pooledBills = allBills.join(', ');

                    const orderedQty = parseFloat(originalOrder.qty) || 0;
                    let newStatus = 'Pending';
                    if (totalDelivered >= orderedQty && orderedQty > 0) newStatus = 'Delivered';
                    else if (totalDelivered > 0) newStatus = 'Partially Delivered';

                    await DB.updateOrder(originalOrder.id, {
                        deliveryDateActual: dcRows[dcRows.length - 1]?.dcDate || baseData.date || originalOrder.deliveryDateActual || '', deliveryQty: totalDelivered,
                        dcNo: pooledDCs,
                        billNo: pooledBills,
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

    forceCloseOrder: (id) => {
        const password = prompt("Enter Administration Password to Force Close:");
        if (password !== 'IES') {
            alert("Incorrect Password. Access Denied.");
            return;
        }

        // Open choices modal
        window.adminApp.openModal('force-close-modal');

        // Setup listeners for the choice buttons
        const delBtn = document.getElementById('force-delivered-btn');
        const admBtn = document.getElementById('force-admin-close-btn');
        const commentEl = document.getElementById('force-close-comment');
        if (commentEl) commentEl.value = ''; // Reset

        // Clone and replace to remove old listeners
        const newDelBtn = delBtn.cloneNode(true);
        const newAdmBtn = admBtn.cloneNode(true);
        delBtn.parentNode.replaceChild(newDelBtn, delBtn);
        admBtn.parentNode.replaceChild(newAdmBtn, admBtn);

        newDelBtn.onclick = async () => {
            const comment = document.getElementById('force-close-comment')?.value.trim() || '';
            if (confirm("Mark this order as DELIVERED directly?")) {
                try {
                    await DB.updateOrder(id, {
                        status: 'Delivered',
                        deliveryDateActual: new Date().toISOString().slice(0, 10),
                        forceClosed: true,
                        closedBy: 'Administration',
                        forceCloseComment: comment
                    });
                    window.adminApp.closeModal('force-close-modal');
                    alert("Order marked as Delivered.");
                    // Refresh view
                    if (window.adminApp.loadOrders) window.adminApp.loadOrders();
                } catch (e) {
                    alert("Error updating order: " + e.message);
                }
            }
        };

        newAdmBtn.onclick = async () => {
            const comment = document.getElementById('force-close-comment')?.value.trim() || '';
            if (confirm("Mark this order as CLOSED BY ADMIN? (Will hide from pending)")) {
                try {
                    await DB.updateOrder(id, {
                        status: 'Closed by Admin',
                        forceClosed: true,
                        closedBy: 'Administration',
                        forceCloseComment: comment
                    });
                    window.adminApp.closeModal('force-close-modal');
                    alert("Order marked as Closed by Admin.");
                    // Refresh view
                    if (window.adminApp.loadOrders) window.adminApp.loadOrders();
                } catch (e) {
                    alert("Error updating order: " + e.message);
                }
            }
        };
    },

    editFCComment: async (id) => {
        const order = currentOrders.find(o => o.id === id);
        if (!order) return;
        const newComment = prompt("Edit FC Comment:", order.forceCloseComment || '');
        if (newComment !== null) {
            try {
                await DB.updateOrder(id, { forceCloseComment: newComment });
                if (window.adminApp.loadOrders) window.adminApp.loadOrders();
            } catch(e) {
                alert("Failed to update comment: " + e.message);
            }
        }
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

    exportToCSV: () => {
        Monitoring.exportToCSV();
    },

    // DC Register Methods
    renderDCRegister: () => {
        DCRegister.renderDCTable(currentOrders);
    },
    sortDC: (key) => {
        DCRegister.sortDC(key);
    },
    toggleShowDCGaps: () => {
        const isGapsOn = DCRegister.toggleShowMissingGaps();
        const textEl = document.getElementById('dc-toggle-gaps-text');
        if (textEl) textEl.textContent = isGapsOn ? 'Gap Highlights: ON' : 'Gap Highlights: OFF';
    },
    exportDCCSV: () => {
        DCRegister.exportDCCSV();
    },
    openAddDeliveryWithDC: (dcNo) => {
        window.adminApp.openAddDeliveryModal();
        const firstDcInput = document.querySelector('#dc-rows-container [name="dcNo_row"]');
        if (firstDcInput) firstDcInput.value = dcNo;
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

    pendingSortState: { key: '', direction: 'asc' },

    pendingSort: (key) => {
        if (window.adminApp.pendingSortState.key === key) {
            window.adminApp.pendingSortState.direction = window.adminApp.pendingSortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            window.adminApp.pendingSortState.key = key;
            window.adminApp.pendingSortState.direction = 'asc';
        }
        window.adminApp.renderPendingAssignment();
    },

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
            (o.status === 'Pending' || o.status === 'Partially Delivered' || o.status === 'Portion Delivered') && !o.deleted
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

        // Get sort options
        const dropdownSortBy = document.getElementById('pending-sort-by')?.value || 'priority';
        const clickSortKey = window.adminApp.pendingSortState.key;
        const clickSortDir = window.adminApp.pendingSortState.direction;

        // Sort based on selection
        pendingOrders.sort((a, b) => {
            if (clickSortKey) {
                let valA = a[clickSortKey] || '';
                let valB = b[clickSortKey] || '';
                
                if (clickSortKey === 'total' || clickSortKey === 'priorityNumber' || clickSortKey === 'qty') {
                    valA = parseFloat(valA) || 0;
                    valB = parseFloat(valB) || 0;
                } else {
                    valA = valA.toString().toLowerCase();
                    valB = valB.toString().toLowerCase();
                }

                if (valA < valB) return clickSortDir === 'asc' ? -1 : 1;
                if (valA > valB) return clickSortDir === 'asc' ? 1 : -1;
                return 0;
            } else {
                if (dropdownSortBy === 'priority') {
                    // 1. Group by Department
                    const deptA = a.department || 'zzz';
                    const deptB = b.department || 'zzz';
                    if (deptA !== deptB) return deptA.localeCompare(deptB);

                    // 2. Sort by Priority Number
                    const pNumA = parseInt(a.priorityNumber) || 999;
                    const pNumB = parseInt(b.priorityNumber) || 999;
                    if (pNumA !== pNumB) return pNumA - pNumB;

                    // 3. Original urgency
                    const urgentA = a.priority === 'urgent' ? 0 : 1;
                    const urgentB = b.priority === 'urgent' ? 0 : 1;
                    if (urgentA !== urgentB) return urgentA - urgentB;

                    // 4. Due Date
                    const dateA = new Date(a.estimatedCompletion || '2099-12-31');
                    const dateB = new Date(b.estimatedCompletion || '2099-12-31');
                    return dateA - dateB;
                } else if (dropdownSortBy === 'dueDate') {
                    const dateA = new Date(a.estimatedCompletion || '2099-12-31');
                    const dateB = new Date(b.estimatedCompletion || '2099-12-31');
                    return dateA - dateB;
                } else if (dropdownSortBy === 'orderId') {
                    const idA = a.internalOrderNo || a.id || '';
                    const idB = b.internalOrderNo || b.id || '';
                    return idA.localeCompare(idB);
                }
                return 0;
            }
        });

        // Update count badge
        if (countBadge) {
            countBadge.textContent = `${pendingOrders.length} orders`;
        }

        // Build table rows
        if (pendingOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="18" class="text-center py-8 text-slate-400">No pending orders found</td></tr>';
            return;
        }

        // Build member dropdown options
        const memberOptions = currentMembers.map(m =>
            `<option value="${m.id}">${m.name}</option>`
        ).join('');

        tbody.innerHTML = pendingOrders.map((order, index) => {
            const assignedList = (order.assignedTo || []).map(id => {
                const member = currentMembers.find(m => m.id === id);
                let displayName = id;
                if(member) {
                    const roleSuffix = member.role ? ` - ${member.role}` : (member.designation ? ` - ${member.designation}` : '');
                    displayName = `${member.name}${roleSuffix}`;
                }
                return {
                    id: id,
                    name: displayName,
                    rawName: member?.name || id
                };
            });
            
            const formatDateForInput = (dateStr) => {
                if (!dateStr || dateStr === '-') return '';
                try {
                    return new Date(dateStr).toISOString().split('T')[0];
                } catch(e) {
                    return '';
                }
            };
            
            const formatDateForDisplay = (dateStr) => {
                if (!dateStr || dateStr === '-') return '-';
                try {
                    return new Date(dateStr).toLocaleDateString('en-IN');
                } catch(e) {
                    return '-';
                }
            };

            const assignedDateValue = order.assignedDate ? formatDateForInput(order.assignedDate) : '';
            const internalOrderDate = formatDateForDisplay(order.date);

            let priorityOptions = '<option value="">-</option>';
            for(let i = 1; i <= 100; i++) {
                priorityOptions += `<option value="${i}" ${order.priorityNumber == i ? 'selected' : ''}>${i}</option>`;
            }

            const depts = ['Admin', 'Fab', 'CNC', 'VMC', 'Assembly'];
            let deptOptions = '<option value="">-</option>';
            depts.forEach(d => {
                deptOptions += `<option value="${d}" ${order.department === d ? 'selected' : ''}>${d}</option>`;
            });

            const activeMembers = currentMembers.filter(m => m.status !== 'Inactive');
            const memberDropdownOptions = `<option value="">+ Add Member</option>` + activeMembers.map(m => {
                const roleSuffix = m.role ? ` - ${m.role}` : (m.designation ? ` - ${m.designation}` : '');
                return `<option value="${m.id}">${m.name}${roleSuffix}</option>`;
            }).join('');

            const sNo = index + 1;
            const ioNo = order.internalOrderNo || order.id;
            const statusVal = order.status || 'Pending';
            const valueDisplay = order.saleValueEa || order.total || order.value || '-';
            const rowColorStyle = assignedList.length > 0 ? 'background-color: #dcfce7;' : 'background-color: #fce8e8;';
            
            return `
                <tr class="pending-assignment-row" style="${rowColorStyle}">
                    <td style="text-align: center; vertical-align: top; padding-top: 1rem;">${sNo}</td>
                    <td style="vertical-align: top; padding-top: 1rem;"><span class="order-id-badge">${ioNo}</span></td>
                    <td style="vertical-align: top; padding-top: 1rem; color: #64748b; font-size: 13px; font-weight: 500;">${internalOrderDate}</td>
                    <td style="vertical-align: top; padding-top: 1rem;"><span style="font-weight: 600; color: var(--brand-600);">${order.drawingNo || '-'}</span></td>
                    <td style="vertical-align: top; padding-top: 1rem;"><div style="max-height: 80px; overflow-y: auto; font-size: 13px;">${order.description || '-'}</div></td>
                    <td style="font-weight: 600; text-align: center; vertical-align: top; padding-top: 1rem;">${order.qty || '-'}</td>
                    <td style="text-align: center; vertical-align: top; padding-top: 1rem;">${order.qtyUnit || '-'}</td>
                    <td style="text-align: right; font-weight: 600; vertical-align: top; padding-top: 1rem;">${valueDisplay}</td>
                    <td style="font-weight: 500; vertical-align: top; padding-top: 1rem;">${order.customer || '-'}</td>
                    <td style="vertical-align: top; padding-top: 1rem;"><span class="status-badge status-pending">${statusVal}</span></td>
                    <td style="vertical-align: top; padding: 0.5rem;">
                        <textarea class="table-form-input p-2" 
                                  placeholder="Update remarks..."
                                  onblur="window.adminApp.pendingInlineUpdate('${order.id}', 'updateRemarks', this.value)"
                                  style="min-height: 80px; width: 100%; resize: vertical; font-size: 11px; line-height: 1.4;"
                        >${order.updateRemarks || ''}</textarea>
                    </td>
                    <td style="vertical-align: top; padding: 0.5rem;">
                        <select class="table-form-input p-2"
                                onchange="window.adminApp.pendingInlineUpdate('${order.id}', 'priorityNumber', this.value)"
                                style="width: 100%; font-size: 11px;">
                            ${priorityOptions}
                        </select>
                    </td>
                    <td style="vertical-align: top; padding: 0.5rem;">
                        <select class="table-form-input p-2"
                                onchange="window.adminApp.pendingInlineUpdate('${order.id}', 'department', this.value)"
                                style="width: 100%; font-size: 11px;">
                            ${deptOptions}
                        </select>
                    </td>
                    <td style="vertical-align: top; padding: 0.5rem;">
                        <input type="date" class="table-form-input p-2" 
                               value="${formatDateForInput(order.plannedDeliveryDate)}"
                               onchange="window.adminApp.pendingInlineUpdate('${order.id}', 'plannedDeliveryDate', this.value)"
                               title="Set planned delivery date"
                               style="font-size: 11px; width: 100%;">
                    </td>
                    <td style="vertical-align: top; padding: 0.5rem;">
                        <input type="date" class="table-form-input p-2" 
                               value="${formatDateForInput(order.expectedDeliveryDate)}"
                               onchange="window.adminApp.pendingInlineUpdate('${order.id}', 'expectedDeliveryDate', this.value)"
                               title="Set delivery date"
                               style="font-size: 11px; width: 100%;">
                    </td>
                    <td style="vertical-align: top; padding: 0.5rem;">
                        <textarea class="table-form-input p-2"
                                  placeholder="Add comments..."
                                  onblur="window.adminApp.pendingInlineUpdate('${order.id}', 'remarks', this.value)"
                                  style="min-height: 80px; width: 100%; resize: vertical; font-size: 11px; line-height: 1.4;"
                        >${order.remarks || ''}</textarea>
                    </td>
                    <td style="vertical-align: top; padding: 0.5rem;">
                        <input type="date" class="table-form-input p-2" 
                               value="${assignedDateValue}"
                               onchange="window.adminApp.pendingInlineUpdate('${order.id}', 'assignedDate', this.value)"
                               title="Set assigned date"
                               style="font-size: 11px; width: 100%;">
                    </td>
                    <td class="assign-cell" style="vertical-align: top; padding: 0.5rem;">
                        <select class="assign-dropdown" 
                                onchange="window.adminApp.updateAssignment('${order.id}', this.value); this.value='';"
                                style="width: 100%; font-size: 11px; padding: 0.3rem;"
                                id="assign-${order.id}">
                            ${memberDropdownOptions}
                        </select>
                        ${assignedList.length > 0 ? `
                        <div class="assign-chips mt-2" style="display: flex; flex-wrap: wrap; gap: 4px;">
                            ${assignedList.map(m => {
                                const initials = m.rawName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                                return `
                                <span class="assign-chip" style="font-size: 10px; background: #f1f5f9; border-radius: 4px; padding: 2px 6px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #e2e8f0;">
                                    <span style="background: #0f172a; color: white; display: inline-block; width: 16px; height: 16px; border-radius: 50%; text-align: center; line-height: 16px; font-size: 8px;">${initials}</span>
                                    <span class="assign-chip-name">${m.name}</span>
                                    <button class="assign-chip-remove" 
                                            onclick="window.adminApp.removeAssignment('${order.id}', '${m.id}')"
                                            title="Remove" style="color: #ef4444; font-weight: bold; cursor: pointer; border:none; background:none;">×</button>
                                </span>`;
                            }).join('')}
                        </div>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    },

    pendingInlineUpdate: async (orderId, fieldName, value) => {
        const targetOrder = currentOrders.find(o => o.id === orderId);
        if (!targetOrder) return;

        // Use the new value for the field being updated, else use the existing value
        const targetDept = fieldName === 'department' ? value : (targetOrder.department || '');
        const targetPriority = fieldName === 'priorityNumber' ? value : (targetOrder.priorityNumber || '');

        if (targetPriority && (fieldName === 'priorityNumber' || fieldName === 'department')) {
            const existing = currentOrders.find(o => 
                o.priorityNumber == targetPriority && 
                o.department == targetDept &&
                o.id !== orderId && 
                (o.status === 'Pending' || o.status === 'Partially Delivered' || o.status === 'Portion Delivered') && 
                !o.deleted
            );
            if (existing) {
                alert(`Priority ${targetPriority} is already assigned to Order No ${existing.internalOrderNo || existing.id} in the ${targetDept} department. Please choose another.`);
                window.adminApp.renderPendingAssignment();
                return;
            }
        }

        const updateData = {};
        updateData[fieldName] = value;
        const result = await DB.updateOrder(orderId, updateData);
        if (result.error) {
            console.error(`Failed to save ${fieldName}:`, result.error);
        } else {
            // Optional: Show visual success cue without fully re-rendering table
            // However, depending on priority filtering/sorting, we might want to re-render.
            if(fieldName === 'priorityNumber' || fieldName === 'assignedTo') {
                window.adminApp.renderPendingAssignment();
            }
        }
    },

    updateAssignment: async (orderId, memberId) => {
        if (!memberId) return;
        const order = currentOrders.find(o => o.id === orderId);
        if (!order) return;
        
        let assigned = order.assignedTo || [];
        if (!assigned.includes(memberId)) {
            assigned = [...assigned, memberId];
            await window.adminApp.pendingInlineUpdate(orderId, 'assignedTo', assigned);
        }
    },

    removeAssignment: async (orderId, memberId) => {
        const order = currentOrders.find(o => o.id === orderId);
        if (!order) return;
        
        let assigned = order.assignedTo || [];
        assigned = assigned.filter(id => id !== memberId);
        await window.adminApp.pendingInlineUpdate(orderId, 'assignedTo', assigned);
    },
    
    exportPendingToCSV: () => {
        const pendingOrders = currentOrders.filter(o => 
            (o.status === 'Pending' || o.status === 'Partially Delivered' || o.status === 'Portion Delivered') && !o.deleted
        );

        // Get filters
        const deptFilter = document.getElementById('pending-filter-department')?.value || '';
        const assignedFilter = document.getElementById('pending-filter-assigned')?.value || '';
        const priorityFilter = document.getElementById('pending-filter-priority')?.value || '';

        // Apply filters
        let exportOrders = pendingOrders;
        if (deptFilter) exportOrders = exportOrders.filter(o => o.department === deptFilter);
        if (assignedFilter === 'assigned') exportOrders = exportOrders.filter(o => o.assignedTo && o.assignedTo.length > 0);
        else if (assignedFilter === 'unassigned') exportOrders = exportOrders.filter(o => !o.assignedTo || o.assignedTo.length === 0);
        if (priorityFilter) exportOrders = exportOrders.filter(o => (o.priority || 'normal') === priorityFilter);

        // Sort based on selection
        const dropdownSortBy = document.getElementById('pending-sort-by')?.value || 'priority';
        const clickSortKey = window.adminApp.pendingSortState.key;
        const clickSortDir = window.adminApp.pendingSortState.direction;

        exportOrders.sort((a, b) => {
            if (clickSortKey) {
                let valA = a[clickSortKey] || '';
                let valB = b[clickSortKey] || '';
                
                if (clickSortKey === 'total' || clickSortKey === 'priorityNumber' || clickSortKey === 'qty') {
                    valA = parseFloat(valA) || 0;
                    valB = parseFloat(valB) || 0;
                } else {
                    valA = valA.toString().toLowerCase();
                    valB = valB.toString().toLowerCase();
                }

                if (valA < valB) return clickSortDir === 'asc' ? -1 : 1;
                if (valA > valB) return clickSortDir === 'asc' ? 1 : -1;
                return 0;
            } else {
                if (dropdownSortBy === 'priority') {
                    const priorityA = a.priority === 'urgent' ? 0 : 1;
                    const priorityB = b.priority === 'urgent' ? 0 : 1;
                    if (priorityA !== priorityB) return priorityA - priorityB;
                    const dateA = new Date(a.estimatedCompletion || '2099-12-31');
                    const dateB = new Date(b.estimatedCompletion || '2099-12-31');
                    return dateA - dateB;
                } else if (dropdownSortBy === 'dueDate') {
                    const dateA = new Date(a.estimatedCompletion || '2099-12-31');
                    const dateB = new Date(b.estimatedCompletion || '2099-12-31');
                    return dateA - dateB;
                } else if (dropdownSortBy === 'orderId') {
                    const idA = a.internalOrderNo || a.id || '';
                    const idB = b.internalOrderNo || b.id || '';
                    return idA.localeCompare(idB);
                }
                return 0;
            }
        });

        if (exportOrders.length === 0) {
            alert('No pending orders to export.');
            return;
        }

        const headers = [
            'S.No', 'In. Order No', 'IO Date', 'Drg No', 'Description', 'Qty', 'Unit', 'Value', 
            'Customer', 'Status', 'Update', 'Priority', 'Department', 'Planned Del. Date', 
            'Delivery Date', 'Comments', 'Assigned Date', 'Assigned To'
        ];

        const rows = exportOrders.map((o, index) => {
            const escapeCSV = (str) => {
                if (!str) return '-';
                const s = String(str).replace(/"/g, '""');
                return /[",\n]/.test(s) ? `"${s}"` : s;
            };

            const assignedUserNames = (o.assignedTo && o.assignedTo.length > 0) 
                 ? o.assignedTo.map(id => currentMembers.find(m => m.id === id)?.name || id).join(', ') 
                 : '-';
            
            const formatDate = (dateStr) => {
                if (!dateStr || dateStr === '-') return '-';
                try {
                    return new Date(dateStr).toLocaleDateString('en-IN');
                } catch(e) {
                    return '-';
                }
            };

            return [
                index + 1,
                escapeCSV(o.internalOrderNo || o.id),
                formatDate(o.date),
                escapeCSV(o.drawingNo),
                escapeCSV(o.description),
                escapeCSV(o.qty),
                escapeCSV(o.qtyUnit),
                escapeCSV(o.saleValueEa || o.total || o.value),
                escapeCSV(o.customer),
                escapeCSV(o.status || 'Pending'),
                escapeCSV(o.updateRemarks),
                escapeCSV(o.priorityNumber),
                escapeCSV(o.department),
                formatDate(o.plannedDeliveryDate),
                formatDate(o.expectedDeliveryDate),
                escapeCSV(o.remarks),
                formatDate(o.assignedDate),
                escapeCSV(assignedUserNames)
            ];
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Pending_Assignments_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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

    // Initialize Multi-Unit UI & Live Subscriptions
    updateUnitUI();
    startUnitSubscriptions();

    // Filter Listeners: Internal Orders
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

    // Filter Listeners: DC Register
    const dcMonthFromInput = document.getElementById('dc-month-from');
    const dcMonthToInput = document.getElementById('dc-month-to');
    const dcSearchInput = document.getElementById('dc-search-filter');

    if (dcMonthFromInput && dcMonthToInput) {
        const updateDCFilters = () => {
            DCRegister.setFilters(dcMonthFromInput.value, dcMonthToInput.value, undefined);
            DCRegister.renderDCTable(currentOrders);
        };
        dcMonthFromInput.addEventListener('change', updateDCFilters);
        dcMonthToInput.addEventListener('change', updateDCFilters);
    }

    if (dcSearchInput) {
        dcSearchInput.addEventListener('input', (e) => {
            DCRegister.setFilters(undefined, undefined, e.target.value);
            DCRegister.renderDCTable(currentOrders);
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
                    const user = result.user;
                    if (!user.email || !user.email.endsWith('@iesgroups.com')) {
                        const errEl = document.getElementById('login-error');
                        if (errEl) {
                            errEl.innerHTML = `Access Denied: <strong>${user.email}</strong> does not have administrator privileges. <a href="#" id="force-logout-btn" style="color:#6366f1;text-decoration:underline">Sign out</a>`;
                            errEl.classList.remove('hidden');
                            document.getElementById('force-logout-btn')?.addEventListener('click', (e) => { 
                                e.preventDefault(); 
                                Auth.logout(); 
                            });
                        }
                        return;
                    }

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
            // Enforce Admin Access (Only @iesgroups.com emails)
            if (!user.email || !user.email.endsWith('@iesgroups.com')) {
                const errEl = document.getElementById('login-error');
                if (errEl) {
                    errEl.innerHTML = `Access Denied: <strong>${user.email}</strong> does not have administrator privileges. <a href="#" id="force-logout-btn" style="color:#6366f1;text-decoration:underline">Sign out</a>`;
                    errEl.classList.remove('hidden');
                    document.getElementById('force-logout-btn')?.addEventListener('click', (e) => { 
                        e.preventDefault(); 
                        Auth.logout(); 
                    });
                }
                if (authDiv) {
                    authDiv.style.display = 'flex';
                    authDiv.classList.remove('hidden');
                }
                if (dashDiv) {
                    dashDiv.style.display = 'none';
                    dashDiv.classList.add('hidden');
                }
                return;
            }

            // Valid Admin
            const errEl = document.getElementById('login-error');
            if (errEl) errEl.classList.add('hidden');

            if (authDiv) {
                authDiv.style.display = 'none';
                authDiv.classList.add('hidden');
            }
            if (dashDiv) {
                dashDiv.style.display = 'flex';
                dashDiv.classList.remove('hidden');
            }
            if (emailSpan) emailSpan.textContent = user.email;

            // Update Unit UI indicators
            updateUnitUI();

            // Prompt Unit Selection if not selected in this browser session
            if (!Units.hasSessionUnitSelection()) {
                window.adminApp.openUnitModal();
            }

            // Ensure subscriptions are running for active unit
            startUnitSubscriptions();

            // Ensure dashboard is ready immediately
            refreshDashboard();

            // Auto-generate report if past 7 PM IST
            window.adminApp.checkAutoGenerateReport();
        } else {
            const errEl = document.getElementById('login-error');
            if (errEl) errEl.classList.add('hidden');
            if (authDiv) {
                authDiv.style.display = 'flex';
                authDiv.classList.remove('hidden');
            }
            if (dashDiv) {
                dashDiv.style.display = 'none';
                dashDiv.classList.add('hidden');
            }

            // Teardown active listeners and reset data on logout
            stopUnitSubscriptions();
            currentMembers = [];
            currentProjects = [];
            currentOrders = [];
            currentInventory = [];
            currentTransactions = [];
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
        setVal('cr-internal-date', reviewData.internalDate || (matchingOrder ? matchingOrder.date : '') || today);
        setVal('cr-accountability', reviewData.accountability || '');
        setVal('cr-team', reviewData.team || (matchingOrder ? matchingOrder.department : '') || project.jobType || '');
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

        // Update project with filed status + Contract Review summary fields for Project Overview
        const crUpdates = {
            contractFiled: isFiled,
            crStatus: isFiled ? 'Finalized' : 'Draft',
            crTeam: reviewData.team || project.jobType || '',
            crAccountability: reviewData.accountability || '',
            crTeamLeader: reviewData.teamLeader || '',
            crDeliveryDate: reviewData.deliveryDate || project.expectedCompletion || '',
            crDecisionOa: reviewData.decisionOa || '',
            crDecisionCap: reviewData.decisionCap || '',
            drawingNo: reviewData.drawingNo || project.drawingNo || '',
            poNo: reviewData.poNo || project.poNo || ''
        };
        Object.assign(project, crUpdates);
        if (window.adminApp.invalidateProjectCrCache) {
            window.adminApp.invalidateProjectCrCache(projectDocId);
        }
        await DB.updateProject(projectDocId, crUpdates, 'Contract Review ' + (isFiled ? 'Finalized' : 'Draft Saved'));

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
    // Restore sidebar state if saved
    if (localStorage.getItem('ies_sidebar_collapsed') === 'true') {
        document.getElementById('dashboard-container')?.classList.add('sidebar-collapsed');
    }

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
        localStorage.setItem('projectViewMode', 'list');
        window.adminApp.setProjectView('list');

        // Handle initial view logic
        const activeView = UI.getActiveView();
        if (activeView === 'inventory_management') {
            console.log("Auto-initializing inventory on load");
            window.adminApp.initInventory();
        }

        // Initialize Monitoring logic
        Monitoring.setupCostCalculation();

        // Initialize Costing Module
        Costing.initCosting();
        Costing.setupExpenseModalCalculations();

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


// ==========================================
// PROJECT OVERVIEW & CROSS-MODULE AGGREGATION
// ==========================================
const _crEnrichedCache = new Set();
let _crEnrichInProgress = false;

const formatCrMemberDisplay = (rawVal) => {
    if (!rawVal) return '';
    if (Array.isArray(rawVal)) return rawVal.filter(Boolean).join(', ');
    const str = String(rawVal).trim();
    if (!str || str === '-' || str === '[]') return '';
    if (str.startsWith('[')) {
        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) return parsed.filter(Boolean).join(', ');
        } catch (e) { /* ignore */ }
    }
    return str;
};

window.adminApp.invalidateProjectCrCache = (projectId) => {
    if (projectId) _crEnrichedCache.delete(projectId);
    else _crEnrichedCache.clear();
};

window.adminApp.enrichProjectsWithContractReviews = async () => {
    if (_crEnrichInProgress || !currentProjects || currentProjects.length === 0) return;
    const toEnrich = currentProjects.filter(p => p.id && !_crEnrichedCache.has(p.id));
    if (toEnrich.length === 0) return;

    _crEnrichInProgress = true;
    let updatedAny = false;
    try {
        const batch = toEnrich.slice(0, 30);
        await Promise.all(batch.map(async (p) => {
            _crEnrichedCache.add(p.id);
            try {
                const res = await DB.getContractReview(p.id);
                const review = (res && res.data) ? res.data : null;
                if (review && Object.keys(review).length > 0) {
                    const isFinalized = Boolean(p.contractFiled || review.status === 'Finalized');
                    p.crStatus = isFinalized ? 'Finalized' : 'Draft';
                    p.crTeam = review.team || p.crTeam || p.jobType || '';
                    p.crAccountability = formatCrMemberDisplay(review.accountability || p.crAccountability);
                    p.crTeamLeader = formatCrMemberDisplay(review.teamLeader || p.crTeamLeader);
                    p.crDeliveryDate = review.deliveryDate || p.crDeliveryDate || p.expectedCompletion || '';
                    p.crDecisionOa = review.decisionOa || p.crDecisionOa || '';
                    p.crDecisionCap = review.decisionCap || p.crDecisionCap || '';
                    updatedAny = true;
                } else if (!p.crStatus) {
                    p.crStatus = p.contractFiled ? 'Finalized' : 'Pending';
                    updatedAny = true;
                }
            } catch (err) {
                console.warn('Could not enrich CR for project:', p.id, err);
            }
        }));
    } finally {
        _crEnrichInProgress = false;
    }

    if (updatedAny) {
        const poView = document.getElementById('view-project_overview');
        if (poView && !poView.classList.contains('hidden')) {
            window.adminApp.renderProjectOverview();
        }
        const pmView = document.getElementById('view-project_management');
        if (pmView && !pmView.classList.contains('hidden')) {
            window.adminApp.filterProjects();
        }
        window.adminApp.updateProjectStats();
        refreshDashboard();
    }

    // Continue enriching remaining projects if more exist
    if (currentProjects.some(p => p.id && !_crEnrichedCache.has(p.id))) {
        setTimeout(() => window.adminApp.enrichProjectsWithContractReviews(), 100);
    }
};

// Project workflow stages shown & editable in the Master Order Tracker
window.adminApp.PROJECT_WORKFLOW_STAGES = ['Draft', 'Under Review', 'Approved', 'In Progress', 'Completed'];

window.adminApp.getProjectWorkflowStatus = (proj) => {
    if (!proj) return 'Not Started';
    const s = String(proj.status || '').trim();
    if (window.adminApp.PROJECT_WORKFLOW_STAGES.includes(s)) return s;
    if (proj.contractFiled || proj.crStatus === 'Finalized') return 'Approved';
    return 'Draft';
};

// Ensure a project workspace exists for an IO (auto-creates it from the Internal Order if missing)
window.adminApp.ensureProjectForIo = async (ioNo, projectDocId) => {
    const cleanIo = String(ioNo || '').trim();
    let proj = null;
    if (projectDocId) proj = (currentProjects || []).find(p => p.id === projectDocId);
    if (!proj && cleanIo && cleanIo !== '-') {
        proj = (currentProjects || []).find(p => String(p.projectId || '').trim() === cleanIo);
    }
    if (proj) return proj;

    const matchingOrder = (currentOrders || []).find(o => !o.isTrash && o.entryType !== 'delivery_report' && String(o.internalOrderNo || '').trim() === cleanIo) || null;
    if (!matchingOrder) return null;

    const newProjPayload = {
        projectName: matchingOrder.description || `Order ${cleanIo}`,
        projectId: cleanIo,
        customerName: matchingOrder.customer || '',
        projectDescription: matchingOrder.description || '',
        drawingNo: matchingOrder.drawingNo || '',
        poNo: matchingOrder.poNo || '',
        orderQty: matchingOrder.qty || 1,
        startDate: matchingOrder.date || new Date().toISOString().split('T')[0],
        expectedCompletion: matchingOrder.deliveryDate || '',
        jobType: matchingOrder.department || 'Admin',
        status: 'Draft',
        assignedMembers: []
    };
    const createdId = await DB.addProject(newProjPayload);
    proj = { id: createdId, ...newProjPayload };
    window.adminApp.registerProjectInMemory(proj);
    return proj;
};

// Inline status change from the Master Order Tracker table
window.adminApp.changeOverviewStatus = async (selectEl, ioNo, projectDocId) => {
    const newStatus = selectEl.value;
    if (!window.adminApp.PROJECT_WORKFLOW_STAGES.includes(newStatus)) return;
    selectEl.disabled = true;
    try {
        const proj = await window.adminApp.ensureProjectForIo(ioNo, projectDocId);
        if (!proj || !proj.id) throw new Error('Could not find or create project workspace for this order.');

        const result = await DB.updateProjectStatus(proj.id, newStatus);
        if (result && result.error) throw new Error(result.error);

        proj.status = newStatus;
        if (['Approved', 'In Progress', 'Completed'].includes(newStatus)) {
            proj.contractFiled = true;
            proj.crStatus = 'Finalized';
        }
        const isMilestone = ['Approved', 'In Progress', 'Completed'].includes(newStatus);
        DB.addAuditLog(proj.id, 'Status Updated', `Status moved to ${newStatus} from Master Order Tracker${isMilestone ? ' (Contract Auto-filed)' : ''}`).catch(() => {});

        window.adminApp.renderProjectOverview();
        if (window.adminApp.filterProjects) window.adminApp.filterProjects();
        if (window.adminApp.updateProjectStats) window.adminApp.updateProjectStats();
        if (typeof refreshDashboard === 'function') refreshDashboard();
    } catch (err) {
        console.error('Inline status update failed:', err);
        alert('Error updating status: ' + err.message);
        window.adminApp.renderProjectOverview();
        if (window.adminApp.filterProjects) window.adminApp.filterProjects();
    } finally {
        selectEl.disabled = false;
    }
};

window.adminApp.buildUnifiedProjectRows = () => {
    const rawOrders = Array.isArray(currentOrders) ? currentOrders : [];
    const activeOrders = rawOrders.filter(o => !o.isTrash && !o.deleted && !o.isDeleted);

    const sanitizedOrders = (Costing && Costing.getSanitizedInternalOrders)
        ? Costing.getSanitizedInternalOrders(activeOrders)
        : activeOrders.filter(o => o.entryType !== 'delivery_report');

    const allExpenses = (Costing && Costing.getAllExpenses) ? Costing.getAllExpenses() : [];

    // Pre-calculate delivered quantities per IO No from delivery_report entries
    const deliveredByIo = {};
    activeOrders.forEach(o => {
        if (o.entryType === 'delivery_report') {
            const ioKey = String(o.internalOrderNo || '').trim().toUpperCase();
            if (!ioKey) return;
            const dQty = parseFloat(o.deliveryQty ?? o.qty) || 0;
            deliveredByIo[ioKey] = (deliveredByIo[ioKey] || 0) + dQty;
        }
    });

    // Group expenses by both orderId (doc ID) and internalOrderNo
    const expenseByOrderId = {};
    const expenseByIoNo = {};
    allExpenses.forEach(exp => {
        const amt = parseFloat(exp.amount) || ((parseFloat(exp.qty) || 0) * (parseFloat(exp.rate) || 0));
        if (!amt) return;
        const ordId = String(exp.orderId || '').trim();
        const ioKey = String(exp.internalOrderNo || '').trim().toUpperCase();
        if (ordId) expenseByOrderId[ordId] = (expenseByOrderId[ordId] || 0) + amt;
        if (ioKey && ioKey !== ordId.toUpperCase()) {
            expenseByIoNo[ioKey] = (expenseByIoNo[ioKey] || 0) + amt;
        }
    });

    // Map projects by projectId (IO No, case-insensitive)
    const projectByIo = {};
    (currentProjects || []).forEach(p => {
        if (p.isTrash || p.deleted || p.isDeleted) return;
        const ioKey = String(p.projectId || '').trim().toUpperCase();
        if (ioKey) {
            projectByIo[ioKey] = p;
        }
    });

    const parseMoney = (val) => {
        if (typeof val === 'number') return isNaN(val) ? 0 : val;
        if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.-]/g, '')) || 0;
        return 0;
    };

    const unifiedRows = [];
    const seenProjectIds = new Set();
    const seenIoKeys = new Set();

    sanitizedOrders.forEach(order => {
        const ioNo = String(order.internalOrderNo || '').trim();
        const ioKey = ioNo.toUpperCase();
        if (ioKey) seenIoKeys.add(ioKey);

        const proj = (ioKey && projectByIo[ioKey]) ? projectByIo[ioKey] : null;
        if (proj && proj.id) seenProjectIds.add(proj.id);

        const qty = parseFloat(order.qty) || (proj ? parseFloat(proj.orderQty) || 0 : 0);

        // Calculate delivered qty from delivery_report entries or fallback to order.deliveryQty
        const reportDelQty = ioKey ? (deliveredByIo[ioKey] || 0) : 0;
        const directDelQty = parseFloat(order.deliveryQty) || 0;
        let delQty = Math.max(reportDelQty, directDelQty);
        if (delQty === 0 && String(order.status || '').toLowerCase() === 'delivered' && qty > 0) {
            delQty = qty;
        }
        const pendQty = Math.max(0, qty - delQty);

        let delStatus = 'Pending';
        const rawStatus = String(order.status || '').toLowerCase();
        if ((qty > 0 && delQty >= qty) || rawStatus === 'delivered') {
            delStatus = 'Delivered';
        } else if (delQty > 0 || rawStatus.includes('partial') || rawStatus.includes('portion')) {
            delStatus = 'Portion';
        }

        // Sale Value: use Costing.getOrderSaleValue or order.total / order.saleValueEa
        let totalSale = (Costing && Costing.getOrderSaleValue) ? Costing.getOrderSaleValue(order) : 0;
        if (!totalSale) {
            const unitSale = parseMoney(order.saleValueEa ?? order.value ?? order.prodValueEa);
            totalSale = parseMoney(order.total ?? order.totalValue) || (qty * unitSale);
        }

        // Expenses: match by order.id or ioNo without double counting
        const matchingExpenses = allExpenses.filter(e =>
            (order.id && e.orderId === order.id) ||
            (ioKey && String(e.internalOrderNo || '').trim().toUpperCase() === ioKey) ||
            (ioKey && String(e.orderId || '').trim().toUpperCase() === ioKey) ||
            (proj && proj.id && e.orderId === proj.id)
        );
        const totalExp = matchingExpenses.reduce((sum, e) => {
            const amt = parseFloat(e.amount) || ((parseFloat(e.qty) || 0) * (parseFloat(e.rate) || 0));
            return sum + amt;
        }, 0);

        const profit = totalSale - totalExp;
        const marginPct = totalSale > 0 ? ((profit / totalSale) * 100) : 0;

        const cleanPl = proj ? formatCrMemberDisplay(proj.crAccountability) : '';
        const cleanTl = proj ? formatCrMemberDisplay(proj.crTeamLeader) : '';

        let crStatus = 'Pending';
        if (proj) {
            if (proj.contractFiled || proj.crStatus === 'Finalized' || proj.status === 'Approved' || proj.status === 'Completed') {
                crStatus = 'Finalized';
            } else if (proj.crStatus === 'Draft' || cleanPl || cleanTl || proj.crDecisionOa) {
                crStatus = 'Draft';
            }
        }

        const woDate = order.date || (proj ? proj.startDate : '') || '';
        const dept = (proj && proj.crTeam) || order.department || (proj ? proj.jobType : '') || '-';
        const workflowStatus = window.adminApp.getProjectWorkflowStatus(proj);

        unifiedRows.push({
            ioNo: ioNo || '-',
            orderId: order.id || '',
            projectDocId: proj ? proj.id : '',
            woDate,
            customer: order.customer || (proj ? proj.customerName : '') || '-',
            poNo: order.poNo || (proj ? (proj.poNo || proj.poNumber) : '') || '-',
            inwardDc: order.customerDcNo || (proj ? proj.customerDcNo : '') || '-',
            drawingNo: order.drawingNo || (proj ? proj.drawingNo : '') || '-',
            description: order.description || (proj ? (proj.projectDescription || proj.name || proj.projectName) : '') || '-',
            qty,
            unit: order.qtyUnit || order.unit || 'Nos',
            crStatus,
            workflowStatus,
            dept,
            accountability: cleanPl || '-',
            teamLeader: cleanTl || '-',
            targetDelDate: (proj && (proj.crDeliveryDate || proj.expectedCompletion)) || order.deliveryDate || order.expectedDeliveryDate || '-',
            decisionOa: (proj && proj.crDecisionOa) ? proj.crDecisionOa : '-',
            totalSale,
            totalExp,
            profit,
            marginPct,
            delQty,
            pendQty,
            delStatus,
            rawOrder: order,
            rawProject: proj
        });
    });

    // Also include any projects in currentProjects that didn't match an Internal Order
    (currentProjects || []).forEach(proj => {
        if (proj.isTrash || proj.deleted || proj.isDeleted) return;
        if (proj.id && seenProjectIds.has(proj.id)) return;
        const ioNo = String(proj.projectId || '').trim();
        const ioKey = ioNo.toUpperCase();
        if (ioKey && seenIoKeys.has(ioKey)) return;

        const qty = parseFloat(proj.orderQty ?? proj.qty) || 0;
        const matchingExpenses = allExpenses.filter(e =>
            (proj.id && e.orderId === proj.id) ||
            (ioKey && String(e.internalOrderNo || '').trim().toUpperCase() === ioKey) ||
            (ioKey && String(e.orderId || '').trim().toUpperCase() === ioKey)
        );
        const totalExp = matchingExpenses.reduce((sum, e) => {
            const amt = parseFloat(e.amount) || ((parseFloat(e.qty) || 0) * (parseFloat(e.rate) || 0));
            return sum + amt;
        }, 0);

        const cleanPl = formatCrMemberDisplay(proj.crAccountability);
        const cleanTl = formatCrMemberDisplay(proj.crTeamLeader);

        let crStatus = 'Pending';
        if (proj.contractFiled || proj.crStatus === 'Finalized') {
            crStatus = 'Finalized';
        } else if (proj.crStatus === 'Draft' || cleanPl || cleanTl || proj.crDecisionOa) {
            crStatus = 'Draft';
        }

        unifiedRows.push({
            ioNo: ioNo || '-',
            orderId: '',
            projectDocId: proj.id || '',
            woDate: proj.startDate || '',
            customer: proj.customerName || '-',
            poNo: proj.poNo || proj.poNumber || '-',
            inwardDc: proj.customerDcNo || '-',
            drawingNo: proj.drawingNo || '-',
            description: proj.projectDescription || proj.name || proj.projectName || '-',
            qty,
            unit: proj.qtyUnit || 'Nos',
            crStatus,
            workflowStatus: window.adminApp.getProjectWorkflowStatus(proj),
            dept: proj.crTeam || proj.jobType || '-',
            accountability: cleanPl || '-',
            teamLeader: cleanTl || '-',
            targetDelDate: proj.crDeliveryDate || proj.expectedCompletion || '-',
            decisionOa: proj.crDecisionOa || '-',
            totalSale: 0,
            totalExp,
            profit: -totalExp,
            marginPct: 0,
            delQty: 0,
            pendQty: qty,
            delStatus: proj.status === 'Completed' ? 'Delivered' : 'Pending',
            rawOrder: null,
            rawProject: proj
        });
    });

    // Sort newest IO / WO Date first
    unifiedRows.sort((a, b) => {
        const cmpIo = String(b.ioNo || '').localeCompare(String(a.ioNo || ''), undefined, { numeric: true });
        if (cmpIo !== 0) return cmpIo;
        return String(b.woDate || '').localeCompare(String(a.woDate || ''));
    });

    return unifiedRows;
};

window.adminApp.renderProjectOverview = () => {
    const tbody = document.getElementById('project-overview-body');
    if (!tbody) return;

    // Trigger background enrichment for any un-enriched projects
    window.adminApp.enrichProjectsWithContractReviews();

    const allRows = window.adminApp.buildUnifiedProjectRows();

    const searchVal = (document.getElementById('po-overview-search')?.value || '').toLowerCase().trim();
    const monthFrom = (document.getElementById('po-overview-month-from')?.value || document.getElementById('po-overview-month')?.value || '').trim();
    const monthTo = (document.getElementById('po-overview-month-to')?.value || '').trim();
    const selectedDept = document.getElementById('po-overview-dept')?.value || 'all';
    const selectedCr = document.getElementById('po-overview-cr-status')?.value || 'all';
    const selectedDel = document.getElementById('po-overview-del-status')?.value || 'all';

    const getYearMonth = (dateStr) => {
        if (!dateStr || typeof dateStr !== 'string') return '';
        const clean = dateStr.trim();
        if (clean.includes('-')) {
            const parts = clean.split('-');
            if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}`;
            if (parts[2] && parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}`;
        }
        if (clean.includes('/')) {
            const parts = clean.split('/');
            if (parts[2] && parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}`;
            if (parts[0] && parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}`;
        }
        return clean.slice(0, 7);
    };

    const filtered = allRows.filter(r => {
        const matchesSearch = !searchVal ||
            String(r.ioNo).toLowerCase().includes(searchVal) ||
            String(r.customer).toLowerCase().includes(searchVal) ||
            String(r.poNo).toLowerCase().includes(searchVal) ||
            String(r.drawingNo).toLowerCase().includes(searchVal) ||
            String(r.description).toLowerCase().includes(searchVal) ||
            String(r.accountability).toLowerCase().includes(searchVal) ||
            String(r.teamLeader).toLowerCase().includes(searchVal);

        let matchesMonth = true;
        if (monthFrom || monthTo) {
            const rowMonth = getYearMonth(r.woDate);
            if (!rowMonth) {
                matchesMonth = false;
            } else {
                if (monthFrom && monthTo) {
                    matchesMonth = rowMonth >= monthFrom && rowMonth <= monthTo;
                } else if (monthFrom) {
                    matchesMonth = rowMonth >= monthFrom;
                } else if (monthTo) {
                    matchesMonth = rowMonth <= monthTo;
                }
            }
        }

        const matchesDept = selectedDept === 'all' || String(r.dept).toLowerCase() === selectedDept.toLowerCase();
        const matchesCr = selectedCr === 'all' ||
            (selectedCr === 'Pending' && r.crStatus !== 'Finalized') ||
            (selectedCr === 'Finalized' && r.crStatus === 'Finalized') ||
            r.workflowStatus === selectedCr;
        const matchesDel = selectedDel === 'all' ||
            r.delStatus === selectedDel ||
            (selectedDel === 'Partially Delivered' && r.delStatus === 'Portion');

        return matchesSearch && matchesMonth && matchesDept && matchesCr && matchesDel;
    });

    window.adminApp.lastFilteredOverviewRows = filtered;

    // Update KPI Cards
    const totalCount = filtered.length;
    const finalizedCount = filtered.filter(r => r.crStatus === 'Finalized').length;
    const totalSales = filtered.reduce((acc, r) => acc + (r.totalSale || 0), 0);
    const totalProfit = filtered.reduce((acc, r) => acc + (r.profit || 0), 0);

    const fmtCurrency = (val) => '₹' + Math.round(val).toLocaleString('en-IN');

    const kpiTotalEl = document.getElementById('po-kpi-total');
    const kpiCrEl = document.getElementById('po-kpi-cr');
    const kpiSalesEl = document.getElementById('po-kpi-sales');
    const kpiProfitEl = document.getElementById('po-kpi-profit');

    if (kpiTotalEl) kpiTotalEl.textContent = totalCount;
    if (kpiCrEl) kpiCrEl.textContent = `${finalizedCount} / ${totalCount}`;
    if (kpiSalesEl) kpiSalesEl.textContent = fmtCurrency(totalSales);
    if (kpiProfitEl) {
        kpiProfitEl.textContent = (totalProfit >= 0 ? '+' : '-') + fmtCurrency(Math.abs(totalProfit));
        kpiProfitEl.style.color = totalProfit >= 0 ? '#059669' : '#dc2626';
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="23" style="text-align: center; padding: 3rem; color: #94a3b8; font-weight: 500;">No matching projects or internal orders found for the selected filters.</td></tr>`;
        return;
    }

    const formatDateShort = (d) => {
        if (!d || d === '-') return '-';
        const parts = String(d).split('-');
        if (parts.length === 3 && parts[0].length === 4) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return d;
    };

    tbody.innerHTML = filtered.map((r, idx) => {
        const rowStateClass = r.delStatus === 'Delivered' ? 'row-delivered' : (r.delStatus === 'Portion' ? 'row-portion' : 'row-pending');

        // Inline-editable workflow / CR status select
        const wf = r.workflowStatus || 'Not Started';
        const wfClass = 'wf-' + wf.toLowerCase().replace(/\s+/g, '-');
        const safeIoAttr = String(r.ioNo || '').replace(/'/g, "\\'");
        const safeProjAttr = String(r.projectDocId || '').replace(/'/g, "\\'");
        const stageOptions = (wf === 'Not Started' ? `<option value="Not Started" selected disabled>Not Started</option>` : '') +
            window.adminApp.PROJECT_WORKFLOW_STAGES.map(s => `<option value="${s}" ${s === wf ? 'selected' : ''}>${s}</option>`).join('');
        const crBadge = `
            <div class="po-wf-cell" onclick="event.stopPropagation();">
                <select class="po-wf-select ${wfClass}" title="Change project / CR status"
                    onchange="window.adminApp.changeOverviewStatus(this, '${safeIoAttr}', '${safeProjAttr}')">${stageOptions}</select>
                ${r.crStatus === 'Finalized' ? `<span class="po-cr-filed" title="Contract Review filed">✓</span>` : ''}
            </div>`;

        // OA = Order Acceptance decision from the Contract Review sign-off (OK / NOK)
        const oaUpper = String(r.decisionOa || '').trim().toUpperCase();
        const oaBadge = (['OK', 'Y', 'YES'].includes(oaUpper))
            ? `<span class="po-oa-pill po-oa-ok" title="Order Accepted">✓ Accepted</span>`
            : ((['NOK', 'N', 'NO'].includes(oaUpper)) ? `<span class="po-oa-pill po-oa-nok" title="Order Not Accepted">✗ Rejected</span>` : `<span style="color:#94a3b8;">—</span>`);

        const delBadge = r.delStatus === 'Delivered'
            ? `<span class="status-pill status-delivered">DELIVERED</span>`
            : (r.delStatus === 'Portion'
                ? `<span class="status-pill status-portion">PORTION</span>`
                : `<span class="status-pill status-pending">PENDING</span>`);

        const profitColor = r.profit >= 0 ? '#059669' : '#dc2626';
        const marginBadgeBg = r.totalSale > 0
            ? (r.marginPct >= 20 ? '#dcfce7' : (r.marginPct >= 0 ? '#fef3c7' : '#ffe4e6'))
            : '#f1f5f9';
        const marginBadgeColor = r.totalSale > 0
            ? (r.marginPct >= 20 ? '#15803d' : (r.marginPct >= 0 ? '#b45309' : '#be123c'))
            : '#64748b';
        const marginText = r.totalSale > 0 ? `${r.marginPct.toFixed(1)}%` : '-';

        const safeIo = String(r.ioNo || '').replace(/'/g, "\\'");
        const safeProjId = String(r.projectDocId || '').replace(/'/g, "\\'");

        return `
            <tr class="${rowStateClass}" style="cursor: pointer;" onclick="window.adminApp.openOverviewWorkspace('${safeIo}', '${safeProjId}', 'review')">
                <!-- Col 1: S.No (Frozen) -->
                <td class="sticky-po-sno" style="font-weight: 700; color: #64748b; text-align: center;">${idx + 1}</td>
                <!-- Col 2: IO No (Frozen) -->
                <td class="sticky-po-io" style="white-space: nowrap;">
                    <span class="io-badge">${r.ioNo}</span>
                </td>
                <!-- Col 3: WO Date (Frozen) -->
                <td class="sticky-po-date" style="font-size: 0.78rem; color: #475569; text-align: center; white-space: nowrap;">${formatDateShort(r.woDate)}</td>
                <!-- Col 4: Customer (Frozen) -->
                <td class="sticky-po-cust" style="font-weight: 700; color: #0f172a; max-width: 165px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.customer}">${r.customer}</td>
                <!-- Col 5: PO No -->
                <td style="font-size: 0.78rem; color: #334155; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.poNo}">${r.poNo}</td>
                <td style="font-size: 0.78rem; color: #334155; white-space: nowrap;">${r.inwardDc}</td>
                <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.76rem; color: #334155; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.drawingNo}">${r.drawingNo}</td>
                <td style="max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1e293b; font-weight: 500;" class="section-end" title="${r.description}">${r.description}</td>

                <!-- Group 2 (6 cols): CR Status, Team, Accountability (PL), Team Leader, Target Del., OA -->
                <td style="text-align: center;">${crBadge}</td>
                <td style="text-align: center;"><span style="background: #f1f5f9; color: #334155; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 700;">${r.dept}</span></td>
                <td style="font-weight: 600; color: #1e293b; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.accountability}">${r.accountability}</td>
                <td style="font-weight: 600; color: #1e293b; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.teamLeader}">${r.teamLeader}</td>
                <td style="font-size: 0.78rem; color: #475569; text-align: center; white-space: nowrap;">${formatDateShort(r.targetDelDate)}</td>
                <td style="text-align: center;" class="section-end">${oaBadge}</td>

                <!-- Group 3 (4 cols): Sale Value, Expenses, Profit / Loss, Margin % -->
                <td style="text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #0f172a; white-space: nowrap;">${r.totalSale > 0 ? r.totalSale.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
                <td style="text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #b45309; white-space: nowrap;">${r.totalExp > 0 ? r.totalExp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</td>
                <td style="text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 800; color: ${profitColor}; white-space: nowrap;">${(r.totalSale > 0 || r.totalExp > 0) ? r.profit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
                <td style="text-align: center;" class="section-end">
                    <span style="background: ${marginBadgeBg}; color: ${marginBadgeColor}; padding: 2px 7px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; font-weight: 800;">${marginText}</span>
                </td>

                <!-- Group 4 (5 cols): Qty, Del. Qty, Pend. Qty, Status, Open Workspace -->
                <td style="text-align: center; font-weight: 700; color: #0f172a;">${r.qty}</td>
                <td style="text-align: center; font-weight: 700; color: #059669;">${r.delQty}</td>
                <td style="text-align: center; font-weight: 800; color: ${r.pendQty > 0 ? '#d97706' : '#64748b'};">${r.pendQty}</td>
                <td style="text-align: center;">${delBadge}</td>
                <td style="text-align: center; white-space: nowrap;" onclick="event.stopPropagation();">
                    <button class="pm-quick-jump-btn" onclick="window.adminApp.openOverviewWorkspace('${safeIo}', '${safeProjId}', 'review')" title="Open Contract Review">📋 CR</button>
                    <button class="pm-quick-jump-btn" onclick="window.adminApp.openOverviewWorkspace('${safeIo}', '${safeProjId}', 'costing')" title="Open Project Costing Sheet">💰 Costing</button>
                </td>
            </tr>
        `;
    }).join('');
};

window.adminApp.openOverviewWorkspace = async (ioNo, projectDocId, tab = 'review') => {
    const cleanIo = String(ioNo || '').trim();
    const matchingOrder = (currentOrders || []).find(o => !o.isTrash && String(o.internalOrderNo || '').trim() === cleanIo) || null;

    // 1. Check if project exists in memory by doc ID or IO number
    let proj = null;
    if (projectDocId) {
        proj = (currentProjects || []).find(p => p.id === projectDocId);
    }
    if (!proj && cleanIo && cleanIo !== '-') {
        proj = (currentProjects || []).find(p => String(p.projectId || '').trim() === cleanIo);
    }

    // 2. If project doesn't exist yet for this Internal Order, create it on the fly
    if (!proj && matchingOrder) {
        try {
            const newProjPayload = {
                projectName: matchingOrder.description || `Order ${cleanIo}`,
                projectId: cleanIo,
                customerName: matchingOrder.customer || '',
                projectDescription: matchingOrder.description || '',
                drawingNo: matchingOrder.drawingNo || '',
                poNo: matchingOrder.poNo || '',
                orderQty: matchingOrder.qty || 1,
                startDate: matchingOrder.date || new Date().toISOString().split('T')[0],
                expectedCompletion: matchingOrder.deliveryDate || '',
                jobType: matchingOrder.department || 'Admin',
                status: 'Contract Review',
                assignedMembers: []
            };
            const createdId = await DB.addProject(newProjPayload);
            proj = { id: createdId, ...newProjPayload };
            window.adminApp.registerProjectInMemory(proj);
        } catch (err) {
            console.error('Failed to auto-create project workspace from overview:', err);
        }
    }

    if (proj && proj.id) {
        window.adminApp.viewProjectDetails(proj.id, tab, matchingOrder);
    }
};

window.adminApp.exportProjectOverviewCSV = () => {
    const allRows = window.adminApp.lastFilteredOverviewRows || window.adminApp.buildUnifiedProjectRows();
    if (!allRows || allRows.length === 0) {
        alert('No data available to export.');
        return;
    }

    const headers = [
        'S.No', 'IO No', 'WO Date', 'Customer', 'PO No', 'Inward DC', 'Drawing No', 'Description', 'Order Qty',
        'Workflow Status', 'CR Filed', 'Dept / Team', 'PL / Accountability', 'Team Leader', 'Target Delivery', 'Order Acceptance',
        'Sale Value', 'Total Expenses', 'Profit / Loss', 'Margin %',
        'Delivered Qty', 'Pending Qty', 'Delivery Status'
    ];

    const esc = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

    const csvLines = [
        headers.map(esc).join(','),
        ...allRows.map((r, i) => [
            i + 1,
            r.ioNo,
            r.woDate,
            r.customer,
            r.poNo,
            r.inwardDc,
            r.drawingNo,
            r.description,
            r.qty,
            r.workflowStatus,
            r.crStatus === 'Finalized' ? 'Yes' : 'No',
            r.dept,
            r.accountability,
            r.teamLeader,
            r.targetDelDate,
            r.decisionOa,
            r.totalSale.toFixed(2),
            r.totalExp.toFixed(2),
            r.profit.toFixed(2),
            r.totalSale > 0 ? r.marginPct.toFixed(1) + '%' : '-',
            r.delQty,
            r.pendQty,
            r.delStatus
        ].map(esc).join(','))
    ];

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Project_Overview_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// Hook switchView & updateProjectStats to keep Project Overview synchronized
const _origSwitchView = window.adminApp.switchView;
window.adminApp.switchView = (viewName) => {
    _origSwitchView(viewName);
    if (viewName === 'project_overview') {
        window.adminApp.renderProjectOverview();
    }
};

const _origUpdateProjectStats = window.adminApp.updateProjectStats;
window.adminApp.updateProjectStats = () => {
    if (_origUpdateProjectStats) _origUpdateProjectStats();
    const poView = document.getElementById('view-project_overview');
    if (poView && !poView.classList.contains('hidden')) {
        window.adminApp.renderProjectOverview();
    }
    window.adminApp.enrichProjectsWithContractReviews();
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-link[data-view="project_overview"]').forEach(link => {
        link.addEventListener('click', () => {
            setTimeout(() => {
                window.adminApp.renderProjectOverview();
            }, 50);
        });
    });
});


// ==========================================
// MODERNIZED PROJECT DETAIL & CONTRACT REVIEW PRINT
// ==========================================
window.adminApp.switchDeepDiveTab = (tabName) => {
    document.querySelectorAll('.dd-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.dd-panel').forEach(p => {
        p.classList.toggle('active', p.id === `dd-panel-${tabName}`);
    });

    const crToolbar = document.getElementById('cr-top-toolbar');
    if (crToolbar) {
        crToolbar.style.display = tabName === 'review' ? 'flex' : 'none';
    }

    if (tabName === 'costing') {
        const currentId = window.adminApp.currentEditingProjectId;
        const project = currentProjects.find(p => p.id === currentId);
        if (project) {
            Costing.loadEmbeddedProjectCosting(project.projectId, project);
        }
    }
};

window.adminApp.updateProjectStatus = async (newStatus) => {
    const id = window.adminApp.currentEditingProjectId;
    if (!id) return;

    const result = await DB.updateProjectStatus(id, newStatus);
    if (result.error) {
        alert('Error updating status: ' + result.error);
    } else {
        const statusDisplay = document.getElementById('detail-project-status');
        if (statusDisplay) {
            const textSpan = statusDisplay.querySelector('.dd-status-text') || statusDisplay.querySelector('span:last-of-type') || statusDisplay.querySelector('span');
            if (textSpan) textSpan.textContent = newStatus;
            statusDisplay.className = `status-badge ${newStatus.toLowerCase().replace(/\s+/g, '-')} flex items-center gap-1.5 group`;
        }
        const menu = document.getElementById('dd-status-menu');
        if (menu) menu.classList.add('hidden');

        const isMilestone = ['Approved', 'In Progress', 'Completed'].includes(newStatus);
        const detail = `Status changed to ${newStatus}${isMilestone ? ' (Contract Auto-filed)' : ''}`;
        await DB.addAuditLog(id, 'Status Updated', detail);
    }
};

window.adminApp.printContractReview = () => {
    const pw = window.open('', '_blank', 'width=1050,height=950');
    if (!pw) return;

    const v = (id) => document.getElementById(id)?.value || '';
    const formatDate = (isoStr) => {
        if (!isoStr || !isoStr.includes('-')) return isoStr || '-';
        const [y, m, d] = isoStr.split('-');
        return `${d}-${m}-${y}`;
    };
    const selText = (id) => {
        const s = document.getElementById(id) || document.querySelector(`[data-field="${id}"]`);
        return s ? (s.options?.[s.selectedIndex]?.text || s.value || '') : '';
    };
    const tagText = (containerId) => {
        const c = document.getElementById(containerId);
        if (!c) return '-';
        const tags = Array.from(c.querySelectorAll('.member-tag, .search-tag-text, .tag-text'))
            .map(t => t.textContent.replace('×', '').trim())
            .filter(Boolean);
        if (tags.length) return tags.join(', ');
        const inlineVal = c.querySelector('.search-input-inline')?.value?.trim();
        if (inlineVal) return inlineVal;
        let raw = c.querySelector('input[type=hidden]')?.value || '';
        try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length) return arr.join(', ');
        } catch (e) {}
        return raw.replace(/^\["?|"?\]$/g, '').replace(/","/g, ', ') || '-';
    };

    const currentId = window.adminApp.currentEditingProjectId;
    const project = (currentProjects || []).find(p => p.id === currentId) || {};
    const ioNumber = v('cr-io-number') || document.getElementById('detail-project-id')?.textContent || project.projectId || '-';
    const matchingOrder = (currentOrders || []).find(o => !o.isTrash && String(o.internalOrderNo || '').trim() === String(ioNumber).trim()) || {};

    const customerName = (project.customerName || matchingOrder.customer || '-').toUpperCase();
    const itemDesc = (project.name || project.projectDescription || matchingOrder.description || document.getElementById('detail-project-name')?.textContent || '-').toUpperCase();
    const orderQty = matchingOrder.qty ? `${matchingOrder.qty} ${matchingOrder.unit || 'Nos'}` : (project.orderQty ? `${project.orderQty} Nos` : '-');
    const inwardDc = matchingOrder.customerDcNo || project.customerDcNo || '-';

    const ioNo = v('cr-review-no') || `CR - ${ioNumber}`;
    const poNo = v('cr-po-no') || '-';
    const drgNo = v('cr-drawing-no') || '-';
    const crDate = formatDate(v('cr-date'));
    const delDate = formatDate(v('cr-delivery-date'));
    const contactPerson = v('cr-contact-person') || '-';
    const phone = v('cr-phone') || '-';
    const intDate = formatDate(v('cr-internal-date'));
    const team = selText('cr-team').replace('Select Team', '') || '-';
    const accountability = tagText('cr-search-accountability');
    const teamLeader = tagText('cr-search-team-leader');
    const members = tagText('cr-search-members');
    const instructions = v('cr-important-instructions') || '';
    const printDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

    const cmt = (f) => document.querySelector(`[data-field="cmt-${f}"]`)?.value || '-';
    const sixM = [
        ['MATL', cmt('matl')],
        ['MACHINE', cmt('machine')],
        ['MAN', cmt('man')],
        ['METHOD', cmt('method')],
        ['MEASURE', cmt('measure')],
        ['TOOLS', cmt('tools')]
    ];

    const decCapRaw = document.querySelector('[data-field="cr-decision-cap"]')?.value || '';
    const decOARaw = document.querySelector('[data-field="cr-decision-oa"]')?.value || '';
    const preparedBy = tagText('cr-search-prepared');
    const reviewedBy = tagText('cr-search-reviewed');
    const approvedBy = tagText('cr-search-approved');

    const checklistRows = [];
    document.querySelectorAll('#cr-excel-checklist .cr-item-row').forEach((row, i) => {
        const label = row.querySelector('.cr-custom-label')?.value || row.querySelector('span')?.textContent?.trim() || '';
        const req = row.dataset.reqVal || '';
        const out = row.dataset.outVal || '';
        const more = row.dataset.moreVal || 'false';
        const remarks = row.querySelector('.cr-remarks-input')?.value || '';
        checklistRows.push({ num: i + 1, label, req, out, more, remarks });
    });

    const tick = '✓';
    const circle = '·';
    const checklistHTML = checklistRows.map(r => `
        <tr>
            <td style="text-align:center;color:#475569;font-weight:700;">${r.num}</td>
            <td style="font-weight:700;color:#0f172a;">${r.label}</td>
            <td class="chk ${r.req === 'yes' ? 'yes' : ''}">${r.req === 'yes' ? tick : circle}</td>
            <td class="chk ${r.req === 'no' ? 'no' : ''}">${r.req === 'no' ? tick : circle}</td>
            <td class="chk ${r.out === 'ok' ? 'ok' : ''}">${r.out === 'ok' ? tick : circle}</td>
            <td class="chk ${r.out === 'nok' ? 'nok' : ''}">${r.out === 'nok' ? tick : circle}</td>
            <td class="chk ${r.out === 'na' ? 'na' : ''}">${r.out === 'na' ? tick : circle}</td>
            <td class="chk ${r.more === 'true' ? 'more' : ''}">${r.more === 'true' ? tick : circle}</td>
            <td style="color:#1e293b;font-weight:600;">${r.remarks || ''}</td>
        </tr>
    `).join('');

    pw.document.write(`<!DOCTYPE html><html><head>
    <title>Contract Review - ${ioNumber}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        @page { size: A4 portrait; margin: 8mm 10mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 8.5pt;
            color: #0f172a;
            line-height: 1.35;
            background: #ffffff;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        .doc-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #0f172a;
            color: #ffffff;
            padding: 10px 14px;
            border-radius: 6px;
            margin-bottom: 8px;
        }
        .doc-company { font-size: 14pt; font-weight: 800; letter-spacing: 0.02em; }
        .doc-sub { font-size: 7.5pt; color: #94a3b8; letter-spacing: 0.08em; margin-top: 2px; text-transform: uppercase; }
        .doc-meta { text-align: right; }
        .doc-title { font-size: 12pt; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em; }
        .doc-ref { font-size: 9pt; font-weight: 700; color: #ffffff; margin-top: 2px; }
        .doc-date { font-size: 7.5pt; color: #cbd5e1; }

        .summary-strip {
            display: grid;
            grid-template-columns: 2fr 2.2fr 1fr 1fr;
            border: 1.5px solid #0f172a;
            border-radius: 5px;
            overflow: hidden;
            margin-bottom: 8px;
            background: #f8fafc;
        }
        .summary-cell {
            padding: 5px 9px;
            border-right: 1px solid #cbd5e1;
        }
        .summary-cell:last-child { border-right: none; }
        .summary-lbl { font-size: 6.5pt; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
        .summary-val { font-size: 9pt; font-weight: 800; color: #0f172a; margin-top: 1px; }

        table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
        td, th { border: 1px solid #94a3b8; padding: 4px 7px; font-size: 8pt; vertical-align: middle; }

        .sec-hdr-indigo { background: #1e3a8a; color: #ffffff; font-weight: 800; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em; padding: 5px 8px; }
        .sec-hdr-teal { background: #0f766e; color: #ffffff; font-weight: 800; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em; padding: 5px 8px; }
        .sec-hdr-slate { background: #1e293b; color: #ffffff; font-weight: 800; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em; padding: 5px 8px; }

        .lbl { background: #f1f5f9; font-weight: 800; font-size: 7.5pt; color: #334155; text-transform: uppercase; }
        .val { font-weight: 700; color: #0f172a; }

        .chk-table { table-layout: fixed; }
        .sub-hdr th, .sub-hdr td {
            background: #334155;
            color: #ffffff;
            font-weight: 800;
            font-size: 7.2pt;
            text-align: center;
            text-transform: uppercase;
            padding: 4px 3px;
        }
        .chk { text-align: center; font-size: 9.5pt; color: #cbd5e1; font-weight: 700; }
        .chk.yes, .chk.ok { background: #dcfce7; color: #15803d; font-weight: 900; }
        .chk.no, .chk.nok { background: #ffe4e6; color: #be123c; font-weight: 900; }
        .chk.na { background: #f1f5f9; color: #475569; font-weight: 800; }
        .chk.more { background: #fef3c7; color: #b45309; font-weight: 900; }

        .instr-box { min-height: 75px; padding: 6px 8px; white-space: pre-wrap; font-size: 8pt; font-weight: 600; color: #0f172a; vertical-align: top; }

        .dec-ok { background: #dcfce7; color: #15803d; font-weight: 900; text-align: center; }
        .dec-nok { background: #ffe4e6; color: #be123c; font-weight: 900; text-align: center; }
        .notes { font-size: 7.2pt; color: #475569; padding: 5px 8px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; }
    </style></head><body>

    <div class="doc-header">
        <div>
            <div class="doc-company">INNOVATIVE ENGINEERING SOLUTIONS</div>
            <div class="doc-sub">Precision • Quality • On-Time Delivery</div>
        </div>
        <div class="doc-meta">
            <div class="doc-title">Contract Review Form</div>
            <div class="doc-ref">${ioNo}</div>
            <div class="doc-date">Printed: ${printDate}</div>
        </div>
    </div>

    <div class="summary-strip">
        <div class="summary-cell">
            <div class="summary-lbl">Customer Name</div>
            <div class="summary-val">${customerName}</div>
        </div>
        <div class="summary-cell">
            <div class="summary-lbl">Item / Project Description</div>
            <div class="summary-val">${itemDesc}</div>
        </div>
        <div class="summary-cell">
            <div class="summary-lbl">Order Qty</div>
            <div class="summary-val">${orderQty}</div>
        </div>
        <div class="summary-cell">
            <div class="summary-lbl">Inward DC</div>
            <div class="summary-val">${inwardDc}</div>
        </div>
    </div>

    <table>
        <colgroup>
            <col style="width:12%"><col style="width:21%">
            <col style="width:12%"><col style="width:21%">
            <col style="width:14%"><col style="width:20%">
        </colgroup>
        <tr>
            <td colspan="2" class="sec-hdr-indigo">Customer Data</td>
            <td colspan="4" class="sec-hdr-teal">Internal Order &amp; Project Assignment</td>
        </tr>
        <tr>
            <td class="lbl">PO No</td><td class="val">${poNo}</td>
            <td class="lbl">IO Number</td><td class="val" style="color:#0f766e;font-weight:900;">${ioNumber}</td>
            <td class="lbl">WO Date</td><td class="val">${intDate}</td>
        </tr>
        <tr>
            <td class="lbl">Drawing No</td><td class="val">${drgNo}</td>
            <td class="lbl">Dept / Team</td><td class="val">${team}</td>
            <td class="lbl">CR Date</td><td class="val">${crDate}</td>
        </tr>
        <tr>
            <td class="lbl">Delivery Date</td><td class="val">${delDate}</td>
            <td class="lbl">Accountability / PL</td><td class="val">${accountability}</td>
            <td class="lbl">Team Leader</td><td class="val">${teamLeader}</td>
        </tr>
        <tr>
            <td class="lbl">Contact / Ph</td><td class="val">${contactPerson} ${phone !== '-' ? '• ' + phone : ''}</td>
            <td class="lbl">Team Members</td><td colspan="3" class="val">${members}</td>
        </tr>
    </table>

    <table class="chk-table">
        <colgroup>
            <col style="width:5%"><col style="width:29%">
            <col style="width:6%"><col style="width:6%">
            <col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:7%">
            <col style="width:29%">
        </colgroup>
        <tr class="sub-hdr">
            <th rowspan="2">S.No</th>
            <th rowspan="2" style="text-align:left;padding-left:8px;">Checklist Items</th>
            <th colspan="2" style="background:#1e3a8a;">Requirement</th>
            <th colspan="4" style="background:#0f766e;">Review Outcome</th>
            <th rowspan="2">Remarks</th>
        </tr>
        <tr class="sub-hdr">
            <th>YES</th><th>NO</th>
            <th>OK</th><th>NOK</th><th>N.A</th><th>CLARITY</th>
        </tr>
        ${checklistHTML}
    </table>

    <table>
        <colgroup>
            <col style="width:52%"><col style="width:14%"><col style="width:34%">
        </colgroup>
        <tr>
            <td class="sec-hdr-slate">Important Instructions &amp; Special Notes</td>
            <td class="sec-hdr-slate" style="text-align:center;">6M Point</td>
            <td class="sec-hdr-slate">Resource / Production Plan</td>
        </tr>
        <tr>
            <td rowspan="6" class="instr-box">${instructions.replace(/\n/g, '<br>')}</td>
            <td class="lbl">${sixM[0][0]}</td><td class="val">${sixM[0][1]}</td>
        </tr>
        <tr><td class="lbl">${sixM[1][0]}</td><td class="val">${sixM[1][1]}</td></tr>
        <tr><td class="lbl">${sixM[2][0]}</td><td class="val">${sixM[2][1]}</td></tr>
        <tr><td class="lbl">${sixM[3][0]}</td><td class="val">${sixM[3][1]}</td></tr>
        <tr><td class="lbl">${sixM[4][0]}</td><td class="val">${sixM[4][1]}</td></tr>
        <tr><td class="lbl">${sixM[5][0]}</td><td class="val">${sixM[5][1]}</td></tr>
    </table>

    <table>
        <colgroup>
            <col style="width:22%"><col style="width:12%">
            <col style="width:22%"><col style="width:22%"><col style="width:22%">
        </colgroup>
        <tr>
            <td colspan="5" class="sec-hdr-teal">Final Verification &amp; Order Acceptance</td>
        </tr>
        <tr class="sub-hdr">
            <td style="text-align:left;padding-left:8px;">Decision Parameter</td>
            <td>Status</td>
            <td>Prepared By</td>
            <td>Reviewed By</td>
            <td>Approved By</td>
        </tr>
        <tr>
            <td class="lbl">Capability</td>
            <td class="${decCapRaw === 'ok' ? 'dec-ok' : (decCapRaw === 'nok' ? 'dec-nok' : '')}" style="text-align:center;font-weight:800;">${decCapRaw ? decCapRaw.toUpperCase() : '-'}</td>
            <td rowspan="2" class="val" style="text-align:center;height:38px;">${preparedBy}</td>
            <td rowspan="2" class="val" style="text-align:center;">${reviewedBy}</td>
            <td rowspan="2" class="val" style="text-align:center;">${approvedBy}</td>
        </tr>
        <tr>
            <td class="lbl">Order Acceptance</td>
            <td class="${decOARaw === 'ok' ? 'dec-ok' : (decOARaw === 'nok' ? 'dec-nok' : '')}" style="text-align:center;font-weight:800;">${decOARaw ? decOARaw.toUpperCase() : '-'}</td>
        </tr>
    </table>

    <div class="notes">
        <strong>Execution Guidelines:</strong>
        1. PL to prepare Job Card and plan for resources from Day 1 itself for smooth completion. &nbsp;|&nbsp;
        2. TL owns full responsibility for Job Quality and On-Time Delivery.
    </div>

    <script>window.onload = () => setTimeout(() => window.print(), 350);</script>
    </body></html>`);
    pw.document.close();
};


// ==========================================
// ENHANCED ACTIVE MEMBER DROPDOWN & IO SPEC SYNC IN CONTRACT REVIEW
// ==========================================
window.adminApp.setupEnhancedMemberDropdown = (containerId, hiddenInputId, initialValue = '') => {
    const rawContainer = document.getElementById(containerId);
    if (!rawContainer) return;

    // Clone container to strip any competing legacy setupMemberSearch event listeners
    const container = rawContainer.cloneNode(true);
    rawContainer.parentNode.replaceChild(container, rawContainer);

    const hiddenInput = container.querySelector(`#${hiddenInputId}`) || document.getElementById(hiddenInputId);
    const tagsContainer = container.querySelector('.search-tags-container') || container;
    const searchInput = container.querySelector('.search-input-inline');
    const dropdown = container.querySelector('.search-suggestions-dropdown');
    if (!searchInput || !dropdown || !hiddenInput) return;

    if (!searchInput.dataset.origPlaceholder) {
        searchInput.dataset.origPlaceholder = searchInput.getAttribute('placeholder') || 'Select...';
    }

    let selectedMembers = [];
    const seedVal = initialValue || hiddenInput.value || '';
    if (seedVal) {
        try {
            const parsed = JSON.parse(seedVal);
            selectedMembers = Array.isArray(parsed)
                ? parsed.map(s => String(s).trim()).filter(Boolean)
                : [String(parsed).trim()].filter(Boolean);
        } catch (e) {
            selectedMembers = String(seedVal).split(',').map(s => s.trim()).filter(Boolean);
        }
    }

    const updateHiddenInput = () => {
        hiddenInput.value = JSON.stringify(selectedMembers);
        hiddenInput.dispatchEvent(new Event('change'));
    };

    const renderTags = () => {
        tagsContainer.querySelectorAll('.member-tag').forEach(t => t.remove());

        selectedMembers.forEach((name, idx) => {
            const tag = document.createElement('span');
            tag.className = 'member-tag';
            tag.innerHTML = `
                <span class="member-tag-text">${name}</span>
                <span class="remove-tag" data-idx="${idx}" title="Remove ${name}">&times;</span>
            `;
            tagsContainer.insertBefore(tag, searchInput);
        });

        // Hide placeholder once at least one member is selected so tags have full space
        searchInput.placeholder = selectedMembers.length > 0 ? '' : (searchInput.dataset.origPlaceholder || 'Select...');
        searchInput.style.minWidth = selectedMembers.length > 0 ? '36px' : '80px';

        tagsContainer.querySelectorAll('.remove-tag').forEach(btn => {
            btn.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx, 10);
                if (!isNaN(idx)) {
                    selectedMembers.splice(idx, 1);
                    renderTags();
                    updateHiddenInput();
                }
            };
        });
    };

    const showSuggestions = (term = '') => {
        const cleanTerm = (term || '').toLowerCase().trim();
        const activeList = (currentMembers || []).filter(m =>
            !m.isDeleted &&
            (m.status || 'Active').toLowerCase() !== 'inactive' &&
            m.name
        );

        const filtered = activeList.filter(m =>
            (!cleanTerm ||
             m.name.toLowerCase().includes(cleanTerm) ||
             (m.role || '').toLowerCase().includes(cleanTerm) ||
             (m.department || '').toLowerCase().includes(cleanTerm)) &&
            !selectedMembers.includes(m.name)
        );

        // Close other open member dropdowns first
        document.querySelectorAll('.search-suggestions-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.add('hidden');
        });

        if (filtered.length === 0) {
            dropdown.innerHTML = `<div class="suggestion-empty">${selectedMembers.length > 0 ? 'All matching members selected' : 'No matching active members'}</div>`;
            dropdown.classList.remove('hidden');
            return;
        }

        dropdown.innerHTML = `
            <div class="suggestion-header">
                <span>ACTIVE TEAM MEMBERS (${filtered.length})</span>
                <span>CLICK TO ADD</span>
            </div>
            ${filtered.map(m => {
                const badge = m.department || m.role || 'Active';
                const safeName = m.name.replace(/"/g, '&quot;');
                return `
                    <div class="suggestion-item" data-name="${safeName}">
                        <div class="suggestion-name-wrap">
                            <span class="suggestion-avatar">${m.name.charAt(0).toUpperCase()}</span>
                            <span class="name">${m.name}</span>
                        </div>
                        <span class="role">${badge}</span>
                    </div>
                `;
            }).join('')}
        `;

        dropdown.classList.remove('hidden');

        dropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const name = item.dataset.name;
                if (name && !selectedMembers.includes(name)) {
                    selectedMembers.push(name);
                    searchInput.value = '';
                    renderTags();
                    updateHiddenInput();
                    showSuggestions('');
                }
            };
        });
    };

    searchInput.onfocus = () => showSuggestions(searchInput.value);
    searchInput.onclick = (e) => {
        e.stopPropagation();
        showSuggestions(searchInput.value);
    };
    searchInput.oninput = (e) => showSuggestions(e.target.value);
    searchInput.onkeydown = (e) => {
        if (e.key === 'Backspace' && searchInput.value === '' && selectedMembers.length > 0) {
            selectedMembers.pop();
            renderTags();
            updateHiddenInput();
            showSuggestions('');
        } else if (e.key === 'Escape') {
            dropdown.classList.add('hidden');
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const firstItem = dropdown.querySelector('.suggestion-item');
            if (firstItem) {
                firstItem.dispatchEvent(new MouseEvent('mousedown'));
            }
        }
    };

    container.onclick = (e) => {
        if (e.target.closest('.remove-tag') || e.target.closest('.suggestion-item')) return;
        e.stopPropagation();
        searchInput.focus();
        showSuggestions(searchInput.value);
    };

    renderTags();
    updateHiddenInput();
};

if (!window._crOutsideClickBound) {
    window._crOutsideClickBound = true;
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.member-search-container')) {
            document.querySelectorAll('.search-suggestions-dropdown').forEach(d => d.classList.add('hidden'));
        }
    });
}

window.adminApp.findMatchingInternalOrder = (project) => {
    if (!project) return null;
    const ioNumber = String(project.projectId || document.getElementById('cr-io-number')?.value || '').trim().toUpperCase();
    if (!ioNumber) return null;
    return (currentOrders || []).find(o =>
        !o.isTrash &&
        !o.deleted &&
        o.entryType !== 'delivery_report' &&
        String(o.internalOrderNo || '').trim().toUpperCase() === ioNumber
    ) || null;
};

window.adminApp.isAvailYes = (rawVal) => {
    if (rawVal === true) return true;
    const s = String(rawVal || '').trim().toUpperCase();
    return s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1';
};

window.adminApp.populateCrOrderSpec = (projectId) => {
    const project = (currentProjects || []).find(p => p.id === projectId);
    if (!project) return;

    const matchingOrder = window.adminApp.findMatchingInternalOrder(project);

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
            el.value = val ?? '';
        } else {
            el.textContent = val ?? '';
        }
    };

    const desc = matchingOrder?.description || project.projectDescription || project.name || '';
    const inwardDc = matchingOrder?.customerDcNo || project.customerDcNo || '';
    const qty = matchingOrder?.qty ?? project.orderQty ?? '';
    const unit = matchingOrder?.qtyUnit || matchingOrder?.unit || project.qtyUnit || 'Nos';
    const unitVal = parseFloat(matchingOrder?.saleValueEa ?? matchingOrder?.value ?? project.saleValueEa ?? 0) || 0;
    const totalSale = parseFloat(matchingOrder?.total ?? matchingOrder?.totalValue ?? ((Number(qty) || 0) * unitVal)) || 0;

    setVal('cr-spec-description', desc);
    setVal('cr-spec-inward-dc', inwardDc);
    setVal('cr-spec-qty', qty);
    setVal('cr-spec-unit', unit);
    setVal('cr-spec-unit-val', `₹${unitVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setVal('cr-spec-total-val', `₹${totalSale.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    const renderPill = (btnId, rawVal) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const isYes = window.adminApp.isAvailYes(rawVal);
        const stateSpan = btn.querySelector('.cr-avail-state, .avail-state');
        if (stateSpan) stateSpan.textContent = isYes ? 'YES' : 'NO';
        btn.classList.toggle('is-yes', isYes);
        btn.classList.toggle('is-no', !isYes);
    };

    const getAvail = (field, altField) => {
        if (matchingOrder && matchingOrder[field] !== undefined) return matchingOrder[field];
        if (matchingOrder && altField && matchingOrder[altField] !== undefined) return matchingOrder[altField];
        if (project[field] !== undefined) return project[field];
        if (altField && project[altField] !== undefined) return project[altField];
        return 'n';
    };

    renderPill('cr-pill-drg', getAvail('drgAvail'));
    renderPill('cr-pill-raw', getAvail('rawAvail', 'rawMatAvail'));
    renderPill('cr-pill-labor', getAvail('isLaborJob'));
    renderPill('cr-pill-fin', getAvail('finishAvail', 'finPartAvail'));
};

window.adminApp.syncCrOrderField = async (field, value) => {
    const currentId = window.adminApp.currentEditingProjectId;
    const project = (currentProjects || []).find(p => p.id === currentId);
    if (!project) return;

    const matchingOrder = window.adminApp.findMatchingInternalOrder(project);

    const qtyVal = parseFloat(document.getElementById('cr-spec-qty')?.value ?? matchingOrder?.qty ?? 0) || 0;
    const unitRate = parseFloat(matchingOrder?.saleValueEa ?? matchingOrder?.value ?? 0) || 0;
    const computedTotal = qtyVal * unitRate;

    const totalEl = document.getElementById('cr-spec-total-val');
    if (totalEl) {
        const formatted = `₹${computedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (totalEl.tagName === 'INPUT') totalEl.value = formatted;
        else totalEl.textContent = formatted;
    }

    if (matchingOrder && matchingOrder.id) {
        const updates = { [field]: value };
        if (field === 'qty') {
            updates.total = computedTotal.toFixed(2);
            matchingOrder.total = updates.total;
        }
        matchingOrder[field] = value;
        await DB.updateOrder(matchingOrder.id, updates);
    }

    // Mirror onto project as well
    project[field] = value;
    if (field === 'description') project.name = value;
    if (field === 'qty') project.orderQty = value;

    // Update top-right header pills immediately
    const headerStats = document.getElementById('dd-header-stats');
    if (headerStats && window.adminApp.viewProjectDetails) {
        const cust = (project.customerName || matchingOrder?.customer || '-').toUpperCase();
        const drg = (project.drawingNo || matchingOrder?.drawingNo || '-').toUpperCase();
        const po = project.poNo || matchingOrder?.poNo || '-';
        const inDc = matchingOrder?.customerDcNo || project.customerDcNo || '-';
        const q = matchingOrder?.qty || project.orderQty || '-';
        headerStats.innerHTML = `
            <div class="pm-meta-chip"><span class="pm-meta-lbl">CUSTOMER</span><span class="pm-meta-val">${cust}</span></div>
            <div class="pm-meta-chip"><span class="pm-meta-lbl">DRG NO</span><span class="pm-meta-val">${drg}</span></div>
            <div class="pm-meta-chip"><span class="pm-meta-lbl">PO NO</span><span class="pm-meta-val">${po}</span></div>
            <div class="pm-meta-chip"><span class="pm-meta-lbl">INWARD DC</span><span class="pm-meta-val">${inDc}</span></div>
            <div class="pm-meta-chip"><span class="pm-meta-lbl">QTY</span><span class="pm-meta-val">${q}</span></div>
        `;
    }
    const nameHeader = document.getElementById('detail-project-name');
    if (field === 'description' && nameHeader && value) {
        nameHeader.textContent = String(value).toUpperCase();
    }
};

window.adminApp.toggleCrOrderAvail = async (field) => {
    const currentId = window.adminApp.currentEditingProjectId;
    const project = (currentProjects || []).find(p => p.id === currentId);
    if (!project) return;

    const matchingOrder = window.adminApp.findMatchingInternalOrder(project);
    const currentRaw = matchingOrder ? matchingOrder[field] : project[field];
    const isCurrentlyYes = window.adminApp.isAvailYes(currentRaw);

    // Internal Orders use 'y' / 'n' in monitoring.js
    const nextVal = isCurrentlyYes ? 'n' : 'y';

    // Update in-memory objects immediately so UI toggles instantly
    project[field] = nextVal;
    if (matchingOrder) {
        matchingOrder[field] = nextVal;
    }

    // Re-render pills immediately
    window.adminApp.populateCrOrderSpec(currentId);

    // Persist to Firestore
    if (matchingOrder && matchingOrder.id) {
        await DB.updateOrder(matchingOrder.id, { [field]: nextVal });
    } else if (project.id) {
        await DB.updateProject(project.id, { [field]: nextVal });
    }
};

const _origLoadContractReview = window.adminApp.loadContractReview;
window.adminApp.loadContractReview = async (projectId) => {
    await _origLoadContractReview(projectId);

    // Re-bind all 6 member fields with enhanced click-to-open dropdowns
    const val = (id) => document.getElementById(id)?.value || '';
    window.adminApp.setupEnhancedMemberDropdown('cr-search-accountability', 'cr-accountability', val('cr-accountability'));
    window.adminApp.setupEnhancedMemberDropdown('cr-search-team-leader', 'cr-team-leader', val('cr-team-leader'));
    window.adminApp.setupEnhancedMemberDropdown('cr-search-members', 'cr-members', val('cr-members'));
    window.adminApp.setupEnhancedMemberDropdown('cr-search-prepared', 'cr-prepared-by', val('cr-prepared-by'));
    window.adminApp.setupEnhancedMemberDropdown('cr-search-reviewed', 'cr-reviewed-by', val('cr-reviewed-by'));
    window.adminApp.setupEnhancedMemberDropdown('cr-search-approved', 'cr-approved-by', val('cr-approved-by'));

    // Populate the Order Specification & Material Availability card
    window.adminApp.populateCrOrderSpec(projectId);
};
