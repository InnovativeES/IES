import * as DB from './db.js';
import * as UI from './ui.js';

/* ==========================================================================
   IES PAYSLIP GENERATOR MODULE
   ========================================================================== */

// State
let selectedMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
let currentPayslips = [];
let payslipsUnsubscribe = null;
let currentEditingPayslip = null;
let savedFormats = [];
let currentMembersList = [];

const PASSWORD_KEY = 'payrollUnlocked';
const PAYROLL_PIN = 'IES_PAYROLL';

/**
 * Check if the payroll module is unlocked in the current session
 */
export function isPayrollUnlocked() {
    return sessionStorage.getItem(PASSWORD_KEY) === 'true';
}

/**
 * Unlock session with entered PIN
 */
export function unlockPayroll(password) {
    if (password === PAYROLL_PIN) {
        sessionStorage.setItem(PASSWORD_KEY, 'true');
        return { success: true };
    }
    return { success: false, error: 'Incorrect Password. Please try again.' };
}

/**
 * Lock session
 */
export function lockPayroll() {
    sessionStorage.removeItem(PASSWORD_KEY);
    if (payslipsUnsubscribe) {
        payslipsUnsubscribe();
        payslipsUnsubscribe = null;
    }
    if (window.adminApp?.switchView) {
        window.adminApp.switchView('overview');
    }
}

/**
 * Calculate Indian Financial Year from "YYYY-MM" (April 1 to March 31)
 */
export function getFinancialYear(payPeriod) {
    if (!payPeriod || !payPeriod.includes('-')) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        return m >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
    }
    const [yearStr, monthStr] = payPeriod.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (month >= 4) {
        return `${year}-${year + 1}`;
    } else {
        return `${year - 1}-${year}`;
    }
}

/**
 * Convert number to words in Indian numbering system
 */
export function numberToWordsIndian(num) {
    if (isNaN(num) || num === null || num === undefined) return '';
    const rounded = Math.round(num);
    if (rounded === 0) return 'Indian Rupee Zero Only';

    const a = [
        '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
    ];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function convertLessThanOneThousand(n) {
        let str = '';
        if (n >= 100) {
            str += a[Math.floor(n / 100)] + ' Hundred ';
            n %= 100;
        }
        if (n >= 20) {
            str += b[Math.floor(n / 10)] + ' ';
            n %= 10;
        }
        if (n > 0) {
            str += a[n] + ' ';
        }
        return str.trim();
    }

    let n = rounded;
    let words = '';

    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    const remainder = n;

    if (crore > 0) {
        words += convertLessThanOneThousand(crore) + ' Crore ';
    }
    if (lakh > 0) {
        words += convertLessThanOneThousand(lakh) + ' Lakh ';
    }
    if (thousand > 0) {
        words += convertLessThanOneThousand(thousand) + ' Thousand ';
    }
    if (remainder > 0) {
        words += convertLessThanOneThousand(remainder) + ' ';
    }

    return `Indian Rupee ${words.trim()} Only`;
}

/**
 * Format currency with Indian grouping: ₹ 1,31,250.00
 */
export function formatCurrency(amount) {
    const val = Number(amount) || 0;
    return '₹' + val.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/**
 * Format Month for display: "2026-10" -> "October 2026"
 */
export function formatMonthDisplay(payPeriod) {
    if (!payPeriod) return '';
    try {
        const [y, m] = payPeriod.split('-');
        const date = new Date(parseInt(y), parseInt(m) - 1, 1);
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch {
        return payPeriod;
    }
}

/**
 * Format Date as DD-MM-YYYY (Date-Month-Year)
 */
export function formatDateDMY(dateStr) {
    if (!dateStr) return '-';
    // If already in DD-MM-YYYY or DD/MM/YYYY
    if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(dateStr)) {
        return dateStr.replace(/\//g, '-');
    }
    // If in YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-');
        return `${d}-${m}-${y}`;
    }
    // Try Date parsing
    try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}-${month}-${year}`;
        }
    } catch {}
    return dateStr;
}

/**
 * Calculate total days in a month string "YYYY-MM"
 */
export function getDaysInMonth(payPeriod) {
    if (!payPeriod) return 31;
    const [y, m] = payPeriod.split('-');
    return new Date(parseInt(y), parseInt(m), 0).getDate();
}

/* ==========================================================================
   DASHBOARD / LIST VIEW
   ========================================================================== */

/**
 * Initialize / Render the Payslip Dashboard View
 */
export async function renderPayslipDashboard(members = []) {
    if (members && members.length) {
        currentMembersList = members;
    } else if (!currentMembersList.length) {
        try {
            currentMembersList = await DB.getMembers();
        } catch (e) {
            console.error("Error fetching members:", e);
        }
    }

    const container = document.getElementById('view-payslip');
    if (!container) return;

    // Check Password Gate
    if (!isPayrollUnlocked()) {
        openPayrollPasswordModal();
        if (window.adminApp?.switchView) {
            window.adminApp.switchView('overview');
        } else {
            UI.switchView('overview');
        }
        return;
    }

    // Set default month in UI picker if not set
    const monthPicker = document.getElementById('payslip-month-filter');
    if (monthPicker) {
        if (!monthPicker.value) monthPicker.value = selectedMonth;
        selectedMonth = monthPicker.value;
    }

    // Listen to real-time payslips for the selected month
    subscribeToMonthPayslips(selectedMonth);
}

/**
 * Subscribe to payslips by month
 */
function subscribeToMonthPayslips(month) {
    if (payslipsUnsubscribe) {
        payslipsUnsubscribe();
    }

    const tbody = document.getElementById('payslip-table-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400">Loading payslips for ${formatMonthDisplay(month)}...</td></tr>`;
    }

    payslipsUnsubscribe = DB.subscribeToPayslipsByMonth(month, (payslips) => {
        currentPayslips = payslips;
        updateDashboardMetrics(payslips);
        renderPayslipsTable(payslips);
    });
}

/**
 * Change selected month from picker
 */
export function setPayslipMonth(month) {
    if (!month) return;
    selectedMonth = month;
    subscribeToMonthPayslips(month);
}

/**
 * Filter payslips by search query
 */
export function filterPayslips(query = '') {
    const q = query.trim().toLowerCase();
    if (!q) {
        renderPayslipsTable(currentPayslips);
        return;
    }
    const filtered = currentPayslips.filter(p => {
        return (p.employeeName || '').toLowerCase().includes(q) ||
               (p.employeeCode || '').toLowerCase().includes(q) ||
               (p.designation || '').toLowerCase().includes(q) ||
               (p.auditRefNo || '').toLowerCase().includes(q);
    });
    renderPayslipsTable(filtered);
}

/**
 * Update top KPI metric cards
 */
function updateDashboardMetrics(payslips) {
    const totalHeadcount = payslips.length;
    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    payslips.forEach(p => {
        totalGross += Number(p.grossEarnings) || 0;
        totalDeductions += Number(p.totalDeductions) || 0;
        totalNet += Number(p.netPayable) || 0;
    });

    const elHeadcount = document.getElementById('ps-metric-headcount');
    const elGross = document.getElementById('ps-metric-gross');
    const elDeductions = document.getElementById('ps-metric-deductions');
    const elNet = document.getElementById('ps-metric-net');

    if (elHeadcount) elHeadcount.textContent = totalHeadcount.toString();
    if (elGross) elGross.textContent = formatCurrency(totalGross);
    if (elDeductions) elDeductions.textContent = formatCurrency(totalDeductions);
    if (elNet) elNet.textContent = formatCurrency(totalNet);
}

/**
 * Render the payslips table
 */
function renderPayslipsTable(payslips) {
    const tbody = document.getElementById('payslip-table-body');
    if (!tbody) return;

    if (!payslips || payslips.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-12 text-slate-400 bg-white">
                    <div class="flex flex-col items-center justify-center gap-2">
                        <svg class="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                        <p class="font-semibold text-slate-600">No payslips generated for ${formatMonthDisplay(selectedMonth)}</p>
                        <p class="text-xs text-slate-400">Click "+ Generate Payslip" to create one for your staff</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = payslips.map((p, idx) => {
        return `
            <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
                <td class="px-4 py-3 text-xs font-semibold text-slate-500">${idx + 1}</td>
                <td class="px-4 py-3">
                    <div class="font-bold text-slate-800 text-sm">${p.employeeName || 'Unknown'}</div>
                    <div class="text-xs text-slate-400">ID: ${p.employeeCode || '-'} · Ref: ${p.auditRefNo || '-'}</div>
                </td>
                <td class="px-4 py-3 text-xs text-slate-600">${p.designation || '-'}</td>
                <td class="px-4 py-3 text-xs text-slate-600 font-medium">${formatMonthDisplay(p.payPeriod)}</td>
                <td class="px-4 py-3 text-xs text-center text-slate-700 font-medium">
                    <span class="inline-block px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">${p.paidDays ?? '-'}</span>
                    ${p.lopDays ? `<span class="inline-block px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] ml-1">LOP: ${p.lopDays}</span>` : ''}
                </td>
                <td class="px-4 py-3 text-xs font-semibold text-slate-800 text-right">${formatCurrency(p.grossEarnings)}</td>
                <td class="px-4 py-3 text-xs font-semibold text-rose-600 text-right">${formatCurrency(p.totalDeductions)}</td>
                <td class="px-4 py-3 text-xs font-bold text-emerald-600 text-right text-sm">${formatCurrency(p.netPayable)}</td>
                <td class="px-4 py-3 text-right">
                    <div class="inline-flex items-center gap-1">
                        <button onclick="window.adminApp.viewPrintPayslip('${p.id}')" title="Print Payslip"
                            class="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                        </button>
                        <button onclick="window.adminApp.downloadSinglePayslipPDF('${p.id}')" title="Save PDF"
                            class="p-1.5 rounded-lg text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        </button>
                        <button onclick="window.adminApp.openEditPayslip('${p.id}')" title="Edit Payslip"
                            class="p-1.5 rounded-lg text-slate-600 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        </button>
                        <button onclick="window.adminApp.deletePayslipConfirm('${p.id}')" title="Delete Payslip"
                            class="p-1.5 rounded-lg text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Export Monthly Payroll Summary CSV
 */
export function exportMonthlyPayrollCSV() {
    if (!currentPayslips.length) {
        alert("No payslips available for the selected month to export.");
        return;
    }

    const headers = [
        "Audit Ref No",
        "Employee Name",
        "Employee Code",
        "Designation",
        "Date of Joining",
        "Pay Period",
        "Pay Date",
        "Paid Days",
        "LOP Days",
        "UAN",
        "PAN",
        "Gross Earnings (INR)",
        "Total Deductions (INR)",
        "Net Payable (INR)"
    ];

    const rows = currentPayslips.map(p => [
        `"${p.auditRefNo || ''}"`,
        `"${p.employeeName || ''}"`,
        `"${p.employeeCode || ''}"`,
        `"${p.designation || ''}"`,
        `"${formatDateDMY(p.dateOfJoining)}"`,
        `"${formatMonthDisplay(p.payPeriod)}"`,
        `"${formatDateDMY(p.payDate)}"`,
        p.paidDays ?? '',
        p.lopDays ?? 0,
        `"${p.uan || ''}"`,
        `"${p.pan || ''}"`,
        p.grossEarnings ?? 0,
        p.totalDeductions ?? 0,
        p.netPayable ?? 0
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `IES_Payroll_Register_${selectedMonth}.csv`;
    link.click();
}

/* ==========================================================================
   PASSWORD MODAL HANDLING
   ========================================================================== */

export function openPayrollPasswordModal() {
    const modal = document.getElementById('modal-payroll-password');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('active');
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        modal.style.visibility = 'visible';
        const input = document.getElementById('payroll-password-input');
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 60);
        }
        const err = document.getElementById('payroll-password-error');
        if (err) err.classList.add('hidden');
    }
}

export function closePayrollPasswordModal() {
    const modal = document.getElementById('modal-payroll-password');
    if (modal) {
        modal.classList.remove('active');
        modal.style.opacity = '0';
        modal.style.visibility = 'hidden';
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }, 200);
    }
}

export function submitPayrollPassword() {
    const input = document.getElementById('payroll-password-input');
    const err = document.getElementById('payroll-password-error');
    if (!input) return;

    const res = unlockPayroll(input.value.trim());
    if (res.success) {
        closePayrollPasswordModal();
        if (window.adminApp?.switchView) {
            window.adminApp.switchView('payslip');
        } else {
            UI.switchView('payslip');
        }
    } else {
        if (err) {
            err.textContent = res.error;
            err.classList.remove('hidden');
        }
        input.classList.add('border-red-500');
        setTimeout(() => input.classList.remove('border-red-500'), 1500);
    }
}

/* ==========================================================================
   FORM & EDITOR HANDLING (view-payslip_detail)
   ========================================================================== */

/**
 * Open form to create a new payslip or edit existing
 */
export async function openPayslipForm(payslipId = null) {
    if (!isPayrollUnlocked()) {
        openPayrollPasswordModal();
        return;
    }

    if (window.adminApp?.switchView) {
        window.adminApp.switchView('payslip_detail');
    } else {
        UI.switchView('payslip_detail');
    }

    // Load available saved formats
    loadAvailableFormats();

    // Populate employee dropdown
    await populateEmployeeDropdown();

    if (payslipId) {
        // Edit mode
        const p = await DB.getPayslip(payslipId);
        if (p) {
            currentEditingPayslip = p;
            populateFormWithData(p);
        }
    } else {
        // Create mode
        currentEditingPayslip = null;
        initNewPayslipForm();
    }
}

/**
 * Populate member dropdown in the form
 */
async function populateEmployeeDropdown() {
    const select = document.getElementById('ps-form-employee-select');
    if (!select) return;

    if (!currentMembersList.length) {
        try {
            currentMembersList = await DB.getMembers();
        } catch (e) {
            console.error("Error fetching members:", e);
        }
    }

    select.innerHTML = '<option value="">-- Select Team Member --</option>';
    currentMembersList.forEach(m => {
        select.innerHTML += `<option value="${m.id}">${m.name} (${m.employeeId || 'ID N/A'}) - ${m.roles ? m.roles.join(', ') : 'Staff'}</option>`;
    });
}

/**
 * Handle Employee selection change
 */
export function onEmployeeSelected(memberId) {
    if (!memberId) return;
    const member = currentMembersList.find(m => m.id === memberId);
    if (!member) return;

    // Fill basics from selected Team Member
    setInputValue('ps-field-employee-name', member.name || '');
    setInputValue('ps-field-employee-code', member.employeeId || '');
    
    // Designation: support orgRoles array, roles array, role string, designation string, department
    const desig = (member.orgRoles && member.orgRoles.length) 
        ? member.orgRoles.join(', ') 
        : ((member.roles && member.roles.length) 
            ? member.roles.join(', ') 
            : (member.role || member.designation || member.department || 'Staff'));
    setInputValue('ps-field-designation', desig);

    // Joining Date
    const doj = member.joiningDate || member.dateOfJoining || '';
    if (doj) {
        setInputValue('ps-field-doj', doj);
    }
    
    // Statutory IDs
    setInputValue('ps-field-uan', member.uan || '');
    setInputValue('ps-field-pan', member.pan || '');

    // Auto calculate YTD for existing rows
    triggerYTDRecalculation();
    updateLiveCalculations();
}

/**
 * Initialize a blank new payslip form
 */
function initNewPayslipForm() {
    const titleEl = document.getElementById('ps-form-title');
    if (titleEl) titleEl.textContent = 'Generate New Payslip';

    const payPeriod = selectedMonth || new Date().toISOString().slice(0, 7);
    const totalDays = getDaysInMonth(payPeriod);
    const nowStr = new Date().toISOString().slice(0, 10);

    // Form fields
    setInputValue('ps-form-id', '');
    setInputValue('ps-field-employee-name', '');
    setInputValue('ps-field-employee-code', '');
    setInputValue('ps-field-designation', '');
    setInputValue('ps-field-doj', '');
    setInputValue('ps-field-pay-period', payPeriod);
    setInputValue('ps-field-pay-date', nowStr);
    setInputValue('ps-field-paid-days', totalDays);
    setInputValue('ps-field-lop-days', 0);
    setInputValue('ps-field-uan', '');
    setInputValue('ps-field-pan', '');

    // Generate Audit Reference Number: IES/PAY/YYYYMM/RANDOM
    const refCode = `IES/PAY/${payPeriod.replace('-', '')}/${Math.floor(100 + Math.random() * 900)}`;
    setInputValue('ps-field-audit-ref', refCode);

    // Default Earnings & Deductions matching Zoho sample
    const defaultEarnings = [
        { label: 'Basic', amount: 0, ytd: 0 },
        { label: 'House Rent Allowance', amount: 0, ytd: 0 },
        { label: 'Conveyance Allowance', amount: 0, ytd: 0 },
        { label: 'Children Education Allowance', amount: 0, ytd: 0 },
        { label: 'Fixed Allowance', amount: 0, ytd: 0 }
    ];

    const defaultDeductions = [
        { label: 'EPF Contribution', amount: 0, ytd: 0 },
        { label: 'Professional Tax', amount: 0, ytd: 0 }
    ];

    renderDynamicEarningsRows(defaultEarnings);
    renderDynamicDeductionsRows(defaultDeductions);
    updateLiveCalculations();
}

/**
 * Populate form with existing payslip data
 */
function populateFormWithData(data) {
    const titleEl = document.getElementById('ps-form-title');
    if (titleEl) titleEl.textContent = `Edit Payslip — ${data.employeeName || ''}`;

    setInputValue('ps-form-id', data.id || '');
    setInputValue('ps-field-employee-name', data.employeeName || '');
    setInputValue('ps-field-employee-code', data.employeeCode || '');
    setInputValue('ps-field-designation', data.designation || '');
    setInputValue('ps-field-doj', data.dateOfJoining || '');
    setInputValue('ps-field-pay-period', data.payPeriod || selectedMonth);
    setInputValue('ps-field-pay-date', data.payDate || '');
    setInputValue('ps-field-paid-days', data.paidDays ?? 30);
    setInputValue('ps-field-lop-days', data.lopDays ?? 0);
    setInputValue('ps-field-uan', data.uan || '');
    setInputValue('ps-field-pan', data.pan || '');
    setInputValue('ps-field-audit-ref', data.auditRefNo || '');

    // Select employee in dropdown if matches
    const select = document.getElementById('ps-form-employee-select');
    if (select && data.employeeId) {
        select.value = data.employeeId;
    }

    renderDynamicEarningsRows(data.earnings || []);
    renderDynamicDeductionsRows(data.deductions || []);
    updateLiveCalculations();
}

/**
 * Helper to safely set input value
 */
function setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val !== undefined && val !== null ? val : '';
}

/**
 * Render dynamic earning rows in the table
 */
function renderDynamicEarningsRows(rows) {
    const container = document.getElementById('ps-earnings-rows-container');
    if (!container) return;

    container.innerHTML = '';
    rows.forEach(r => appendEarningRow(r.label, r.amount, r.ytd));
}

/**
 * Render dynamic deduction rows in the table
 */
function renderDynamicDeductionsRows(rows) {
    const container = document.getElementById('ps-deductions-rows-container');
    if (!container) return;

    container.innerHTML = '';
    rows.forEach(r => appendDeductionRow(r.label, r.amount, r.ytd));
}

/**
 * Add a new earning row
 */
export function addEarningRow(label = '', amount = 0, ytd = 0) {
    appendEarningRow(label, amount, ytd);
    updateLiveCalculations();
}

function appendEarningRow(label = '', amount = 0, ytd = 0) {
    const container = document.getElementById('ps-earnings-rows-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'ps-dynamic-row flex items-center gap-2 mb-2 p-1.5 bg-slate-50/70 rounded-lg border border-slate-200/60';
    row.innerHTML = `
        <div class="flex-1">
            <input type="text" class="ps-earning-label form-input text-xs w-full py-1.5 px-2 bg-white"
                placeholder="Earning Name (e.g. Basic)" value="${escapeHtml(label)}" oninput="window.adminApp.updateLiveCalculations()">
        </div>
        <div class="w-28">
            <input type="number" step="0.01" min="0" class="ps-earning-amount form-input text-xs w-full py-1.5 px-2 text-right bg-white font-semibold"
                placeholder="0.00" value="${amount || ''}" oninput="window.adminApp.onEarningAmountChange(this)">
        </div>
        <div class="w-28">
            <input type="number" step="0.01" min="0" class="ps-earning-ytd form-input text-xs w-full py-1.5 px-2 text-right bg-white text-slate-600"
                placeholder="YTD (₹)" value="${ytd || ''}" title="Cumulative YTD (auto-calculated / editable)" oninput="window.adminApp.updateLiveCalculations()">
        </div>
        <div>
            <button type="button" onclick="this.closest('.ps-dynamic-row').remove(); window.adminApp.updateLiveCalculations();"
                class="p-1 text-slate-400 hover:text-rose-500 rounded transition-colors" title="Remove row">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
        </div>
    `;
    container.appendChild(row);
}

/**
 * Add a new deduction row
 */
export function addDeductionRow(label = '', amount = 0, ytd = 0) {
    appendDeductionRow(label, amount, ytd);
    updateLiveCalculations();
}

function appendDeductionRow(label = '', amount = 0, ytd = 0) {
    const container = document.getElementById('ps-deductions-rows-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'ps-dynamic-row flex items-center gap-2 mb-2 p-1.5 bg-slate-50/70 rounded-lg border border-slate-200/60';
    row.innerHTML = `
        <div class="flex-1">
            <input type="text" class="ps-deduction-label form-input text-xs w-full py-1.5 px-2 bg-white"
                placeholder="Deduction Name (e.g. EPF)" value="${escapeHtml(label)}" oninput="window.adminApp.updateLiveCalculations()">
        </div>
        <div class="w-28">
            <input type="number" step="0.01" min="0" class="ps-deduction-amount form-input text-xs w-full py-1.5 px-2 text-right bg-white font-semibold text-rose-600"
                placeholder="0.00" value="${amount || ''}" oninput="window.adminApp.onDeductionAmountChange(this)">
        </div>
        <div class="w-28">
            <input type="number" step="0.01" min="0" class="ps-deduction-ytd form-input text-xs w-full py-1.5 px-2 text-right bg-white text-slate-600"
                placeholder="YTD (₹)" value="${ytd || ''}" title="Cumulative YTD (auto-calculated / editable)" oninput="window.adminApp.updateLiveCalculations()">
        </div>
        <div>
            <button type="button" onclick="this.closest('.ps-dynamic-row').remove(); window.adminApp.updateLiveCalculations();"
                class="p-1 text-slate-400 hover:text-rose-500 rounded transition-colors" title="Remove row">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
        </div>
    `;
    container.appendChild(row);
}

/**
 * When earning amount changes, if YTD is 0 or unedited, suggest initial YTD = amount
 */
export function onEarningAmountChange(input) {
    const row = input.closest('.ps-dynamic-row');
    if (row) {
        const ytdInput = row.querySelector('.ps-earning-ytd');
        if (ytdInput && (!ytdInput.value || Number(ytdInput.value) === 0)) {
            ytdInput.value = input.value;
        }
    }
    updateLiveCalculations();
}

export function onDeductionAmountChange(input) {
    const row = input.closest('.ps-dynamic-row');
    if (row) {
        const ytdInput = row.querySelector('.ps-deduction-ytd');
        if (ytdInput && (!ytdInput.value || Number(ytdInput.value) === 0)) {
            ytdInput.value = input.value;
        }
    }
    updateLiveCalculations();
}

/**
 * Real-time calculation of Gross, Deductions, Net Payable, and Amount in Words
 */
export function updateLiveCalculations() {
    const data = collectFormData();

    // Update Form Total Labels
    const grossEl = document.getElementById('ps-form-gross-total');
    const dedEl = document.getElementById('ps-form-ded-total');
    const netEl = document.getElementById('ps-form-net-total');
    const wordsEl = document.getElementById('ps-form-words-display');

    if (grossEl) grossEl.textContent = formatCurrency(data.grossEarnings);
    if (dedEl) dedEl.textContent = formatCurrency(data.totalDeductions);
    if (netEl) netEl.textContent = formatCurrency(data.netPayable);
    if (wordsEl) wordsEl.textContent = data.netPayableWords;

    // Update live preview block
    renderLivePreview(data);
}

/**
 * Collect all structured data from the form
 */
export function collectFormData() {
    const employeeId = document.getElementById('ps-form-employee-select')?.value || '';
    const employeeName = document.getElementById('ps-field-employee-name')?.value?.trim() || '';
    const employeeCode = document.getElementById('ps-field-employee-code')?.value?.trim() || '';
    const designation = document.getElementById('ps-field-designation')?.value?.trim() || '';
    const dateOfJoining = document.getElementById('ps-field-doj')?.value || '';
    const payPeriod = document.getElementById('ps-field-pay-period')?.value || selectedMonth;
    const payDate = document.getElementById('ps-field-pay-date')?.value || '';
    const paidDays = Number(document.getElementById('ps-field-paid-days')?.value) || 0;
    const lopDays = Number(document.getElementById('ps-field-lop-days')?.value) || 0;
    const uan = document.getElementById('ps-field-uan')?.value?.trim() || '';
    const pan = document.getElementById('ps-field-pan')?.value?.trim().toUpperCase() || '';
    const auditRefNo = document.getElementById('ps-field-audit-ref')?.value?.trim() || '';

    // Collect Earnings
    const earnings = [];
    let grossEarnings = 0;
    document.querySelectorAll('#ps-earnings-rows-container .ps-dynamic-row').forEach(row => {
        const label = row.querySelector('.ps-earning-label')?.value?.trim() || '';
        const amount = Number(row.querySelector('.ps-earning-amount')?.value) || 0;
        const ytd = Number(row.querySelector('.ps-earning-ytd')?.value) || 0;
        if (label || amount > 0) {
            earnings.push({ label, amount, ytd });
            grossEarnings += amount;
        }
    });

    // Collect Deductions
    const deductions = [];
    let totalDeductions = 0;
    document.querySelectorAll('#ps-deductions-rows-container .ps-dynamic-row').forEach(row => {
        const label = row.querySelector('.ps-deduction-label')?.value?.trim() || '';
        const amount = Number(row.querySelector('.ps-deduction-amount')?.value) || 0;
        const ytd = Number(row.querySelector('.ps-deduction-ytd')?.value) || 0;
        if (label || amount > 0) {
            deductions.push({ label, amount, ytd });
            totalDeductions += amount;
        }
    });

    const netPayable = Math.max(0, grossEarnings - totalDeductions);
    const netPayableWords = numberToWordsIndian(netPayable);
    const financialYear = getFinancialYear(payPeriod);

    return {
        id: document.getElementById('ps-form-id')?.value || null,
        employeeId,
        employeeName,
        employeeCode,
        designation,
        dateOfJoining,
        payPeriod,
        payPeriodDisplay: formatMonthDisplay(payPeriod),
        payDate,
        paidDays,
        lopDays,
        uan,
        pan,
        auditRefNo,
        earnings,
        deductions,
        grossEarnings,
        totalDeductions,
        netPayable,
        netPayableWords,
        financialYear
    };
}

/**
 * Suggestion 1: Trigger smart YTD auto-calculation
 * Sums past payslips in FY for the selected employee, but keeps manual overrides
 */
export async function triggerYTDRecalculation() {
    const employeeId = document.getElementById('ps-form-employee-select')?.value;
    const payPeriod = document.getElementById('ps-field-pay-period')?.value || selectedMonth;
    if (!employeeId || !payPeriod) return;

    const fy = getFinancialYear(payPeriod);
    const pastPayslips = await DB.getEmployeePayslipsInFY(employeeId, fy);

    // Filter past months (strictly before current payPeriod)
    const priorPayslips = pastPayslips.filter(p => (p.payPeriod || '') < payPeriod);

    // Sum past amounts by label
    const pastEarningsMap = {};
    const pastDeductionsMap = {};

    priorPayslips.forEach(p => {
        (p.earnings || []).forEach(e => {
            const k = (e.label || '').trim().toLowerCase();
            pastEarningsMap[k] = (pastEarningsMap[k] || 0) + (Number(e.amount) || 0);
        });
        (p.deductions || []).forEach(d => {
            const k = (d.label || '').trim().toLowerCase();
            pastDeductionsMap[k] = (pastDeductionsMap[k] || 0) + (Number(d.amount) || 0);
        });
    });

    // Update Earning YTD inputs if past records exist
    document.querySelectorAll('#ps-earnings-rows-container .ps-dynamic-row').forEach(row => {
        const label = row.querySelector('.ps-earning-label')?.value?.trim().toLowerCase();
        const amount = Number(row.querySelector('.ps-earning-amount')?.value) || 0;
        const ytdInput = row.querySelector('.ps-earning-ytd');
        if (label && pastEarningsMap[label] !== undefined && ytdInput) {
            ytdInput.value = (pastEarningsMap[label] + amount).toFixed(2);
        }
    });

    // Update Deduction YTD inputs if past records exist
    document.querySelectorAll('#ps-deductions-rows-container .ps-dynamic-row').forEach(row => {
        const label = row.querySelector('.ps-deduction-label')?.value?.trim().toLowerCase();
        const amount = Number(row.querySelector('.ps-deduction-amount')?.value) || 0;
        const ytdInput = row.querySelector('.ps-deduction-ytd');
        if (label && pastDeductionsMap[label] !== undefined && ytdInput) {
            ytdInput.value = (pastDeductionsMap[label] + amount).toFixed(2);
        }
    });

    updateLiveCalculations();
}

/**
 * Suggestion 2: "Clone from Last Month"
 * Copies the selected employee's previous payslip structure and figures
 */
export async function cloneFromLastMonth() {
    const employeeId = document.getElementById('ps-form-employee-select')?.value;
    if (!employeeId) {
        alert("Please select a team member first to clone from their last payslip.");
        return;
    }

    const last = await DB.getLastPayslipForEmployee(employeeId);
    if (!last) {
        alert("No previous payslips found for this employee to clone from.");
        return;
    }

    // Keep current pay period and date
    const currentPeriod = document.getElementById('ps-field-pay-period')?.value || selectedMonth;
    const currentPayDate = document.getElementById('ps-field-pay-date')?.value || new Date().toISOString().slice(0, 10);
    const totalDays = getDaysInMonth(currentPeriod);

    // Pre-fill fields
    setInputValue('ps-field-employee-name', last.employeeName || '');
    setInputValue('ps-field-employee-code', last.employeeCode || '');
    setInputValue('ps-field-designation', last.designation || '');
    setInputValue('ps-field-doj', last.dateOfJoining || '');
    setInputValue('ps-field-paid-days', totalDays);
    setInputValue('ps-field-lop-days', 0);
    setInputValue('ps-field-pf', last.pfAccountNo || '');
    setInputValue('ps-field-uan', last.uan || '');

    // Clone Earnings & Deductions
    renderDynamicEarningsRows(last.earnings || []);
    renderDynamicDeductionsRows(last.deductions || []);

    // Recompute YTD for the new period
    await triggerYTDRecalculation();
    updateLiveCalculations();

    alert(`Cloned salary structure from ${formatMonthDisplay(last.payPeriod)}! ✓`);
}

/**
 * Suggestion 3: Format Templates Management
 */
export async function loadAvailableFormats() {
    try {
        savedFormats = await DB.getPayslipFormats();
        const select = document.getElementById('ps-format-template-select');
        if (!select) return;

        select.innerHTML = '<option value="">-- Choose Format Template --</option>';
        savedFormats.forEach(fmt => {
            select.innerHTML += `<option value="${fmt.id}">${escapeHtml(fmt.name)} (${(fmt.earningLabels || []).length} earnings, ${(fmt.deductionLabels || []).length} deductions)</option>`;
        });
    } catch (e) {
        console.error("Error loading formats:", e);
    }
}

export function applySelectedFormat(formatId) {
    if (!formatId) return;
    const fmt = savedFormats.find(f => f.id === formatId);
    if (!fmt) return;

    if (!confirm(`Apply format template "${fmt.name}"? This will set earning and deduction fields.`)) return;

    const earnings = (fmt.earningLabels || []).map(lbl => ({ label: lbl, amount: 0, ytd: 0 }));
    const deductions = (fmt.deductionLabels || []).map(lbl => ({ label: lbl, amount: 0, ytd: 0 }));

    renderDynamicEarningsRows(earnings);
    renderDynamicDeductionsRows(deductions);
    updateLiveCalculations();
}

export async function saveCurrentFormatAsTemplate() {
    const name = prompt("Enter a name for this Format Template (e.g., 'Senior Engineering Staff', 'Factory Machinists'):");
    if (!name || !name.trim()) return;

    const data = collectFormData();
    const earningLabels = data.earnings.map(e => e.label).filter(Boolean);
    const deductionLabels = data.deductions.map(d => d.label).filter(Boolean);

    if (!earningLabels.length && !deductionLabels.length) {
        alert("Cannot save empty format. Please add at least one earning or deduction field.");
        return;
    }

    const res = await DB.savePayslipFormat({
        name: name.trim(),
        earningLabels,
        deductionLabels
    });

    if (res.id) {
        alert(`Format template "${name.trim()}" saved successfully! ✓`);
        loadAvailableFormats();
    } else {
        alert("Failed to save format template: " + (res.error || 'Unknown error'));
    }
}

/**
 * Save payslip to Firestore
 */
export async function savePayslip() {
    const data = collectFormData();

    if (!data.employeeName) {
        alert("Please enter the Employee Name.");
        document.getElementById('ps-field-employee-name')?.focus();
        return;
    }

    if (!data.payPeriod) {
        alert("Please select a Pay Period.");
        return;
    }

    try {
        if (data.id) {
            // Update
            const { id, ...updateData } = data;
            const res = await DB.updatePayslip(id, updateData);
            if (res.error) throw new Error(res.error);
            alert("Payslip updated successfully! ✓");
        } else {
            // Add new
            const { id, ...createData } = data;
            const res = await DB.addPayslip(createData);
            if (res.error) throw new Error(res.error);
            alert("Payslip generated and saved! ✓");
        }

        // Return to dashboard
        backToPayslipDashboard();
    } catch (e) {
        console.error("Error saving payslip:", e);
        alert("Failed to save payslip: " + e.message);
    }
}

/**
 * Delete confirmation
 */
export async function deletePayslipConfirm(id) {
    if (!confirm("Are you sure you want to permanently delete this payslip record?")) return;
    try {
        const res = await DB.deletePayslip(id);
        if (res.error) throw new Error(res.error);
    } catch (e) {
        console.error("Error deleting payslip:", e);
        alert("Failed to delete payslip: " + e.message);
    }
}

export function backToPayslipDashboard() {
    if (window.adminApp?.switchView) {
        window.adminApp.switchView('payslip');
    } else {
        UI.switchView('payslip');
    }
}

/* ==========================================================================
   PRINT & PDF ENGINE (Matching Zoho Sample Layout + New Logo)
   ========================================================================== */

/**
 * Generate standard HTML for printable payslip (OMITTING audit number per user request #5)
 */
export function buildPayslipPrintHTML(data) {
    const earningsRows = (data.earnings || []).map(e => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 7px 10px; font-size: 12px; color: #1e293b; font-weight: 500;">${escapeHtml(e.label || '-')}</td>
            <td style="padding: 7px 10px; font-size: 12px; color: #0f172a; font-weight: 700; text-align: right;">${formatCurrency(e.amount)}</td>
            <td style="padding: 7px 10px; font-size: 12px; color: #475569; font-weight: 600; text-align: right;">${formatCurrency(e.ytd)}</td>
        </tr>
    `).join('') || `<tr><td colspan="3" style="padding: 10px; text-align: center; color: #94a3b8; font-size: 12px;">No earnings</td></tr>`;

    const deductionsRows = (data.deductions || []).map(d => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 7px 10px; font-size: 12px; color: #1e293b; font-weight: 500;">${escapeHtml(d.label || '-')}</td>
            <td style="padding: 7px 10px; font-size: 12px; color: #0f172a; font-weight: 700; text-align: right;">${formatCurrency(d.amount)}</td>
            <td style="padding: 7px 10px; font-size: 12px; color: #475569; font-weight: 600; text-align: right;">${formatCurrency(d.ytd)}</td>
        </tr>
    `).join('') || `<tr><td colspan="3" style="padding: 10px; text-align: center; color: #94a3b8; font-size: 12px;">No deductions</td></tr>`;

    return `
        <div class="payslip-document-wrapper" style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; width: 100%; max-width: 760px; margin: 0 auto; background: #ffffff; padding: 18px 22px; box-sizing: border-box; color: #1e293b; line-height: 1.35;">
            <!-- Header Section -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0;">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <img src="assets/new logo.png" alt="IES Logo" style="height: 46px; object-fit: contain; max-width: 160px;">
                    <div>
                        <div style="font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; line-height: 1.2;">Innovative Engineering Solutions</div>
                        <div style="font-size: 11px; color: #64748b; font-weight: 500; margin-top: 2px;">Chennai, Tamil Nadu, India</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Payslip For the Month</div>
                    <div style="font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 2px;">${escapeHtml(formatMonthDisplay(data.payPeriod))}</div>
                </div>
            </div>

            <!-- Employee Summary Section -->
            <div style="display: flex; gap: 18px; margin-bottom: 12px;">
                <!-- Left Details Column -->
                <div style="flex: 1;">
                    <div style="font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;">Employee Summary</div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <tr>
                            <td style="padding: 2.5px 0; color: #64748b; width: 130px;">Employee Name</td>
                            <td style="padding: 2.5px 0; font-weight: 700; color: #0f172a;">: &nbsp;${escapeHtml(data.employeeName || '-')}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2.5px 0; color: #64748b;">Designation</td>
                            <td style="padding: 2.5px 0; font-weight: 600; color: #1e293b;">: &nbsp;${escapeHtml(data.designation || '-')}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2.5px 0; color: #64748b;">Employee ID</td>
                            <td style="padding: 2.5px 0; font-weight: 600; color: #1e293b;">: &nbsp;${escapeHtml(data.employeeCode || '-')}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2.5px 0; color: #64748b;">Date of Joining</td>
                            <td style="padding: 2.5px 0; font-weight: 600; color: #1e293b;">: &nbsp;${escapeHtml(formatDateDMY(data.dateOfJoining))}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2.5px 0; color: #64748b;">Pay Period</td>
                            <td style="padding: 2.5px 0; font-weight: 600; color: #1e293b;">: &nbsp;${escapeHtml(formatMonthDisplay(data.payPeriod))}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2.5px 0; color: #64748b;">Pay Date</td>
                            <td style="padding: 2.5px 0; font-weight: 600; color: #1e293b;">: &nbsp;${escapeHtml(formatDateDMY(data.payDate))}</td>
                        </tr>
                    </table>
                </div>

                <!-- Right Net Pay Card Box -->
                <div style="width: 220px; border: 1px solid #d1fae5; border-radius: 10px; overflow: hidden; background: #ffffff;">
                    <div style="background: #ecfdf5; padding: 12px 14px; border-bottom: 1px dashed #a7f3d0; text-align: left; border-left: 4px solid #10b981;">
                        <div style="font-size: 21px; font-weight: 800; color: #047857; letter-spacing: -0.02em; line-height: 1;">${formatCurrency(data.netPayable)}</div>
                        <div style="font-size: 10px; font-weight: 700; color: #059669; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px;">Employee Net Pay</div>
                    </div>
                    <div style="padding: 8px 14px; font-size: 12px; color: #334155;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                            <span style="color: #64748b;">Paid Days</span>
                            <span style="font-weight: 700; color: #0f172a;">${data.paidDays ?? 30}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: #64748b;">LOP Days</span>
                            <span style="font-weight: 700; color: #0f172a;">${data.lopDays ?? 0}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- UAN & PAN Bar -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 14px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 12px; font-size: 12px;">
                <div>
                    <span style="color: #64748b; font-weight: 600;">UAN:</span>
                    <span style="font-weight: 700; color: #0f172a; margin-left: 6px;">${escapeHtml(data.uan || '-')}</span>
                </div>
                <div>
                    <span style="color: #64748b; font-weight: 600;">PAN:</span>
                    <span style="font-weight: 700; color: #0f172a; margin-left: 6px;">${escapeHtml(data.pan || '-')}</span>
                </div>
            </div>

            <!-- Earnings & Deductions Tables Container -->
            <div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; margin-bottom: 12px;">
                <div style="display: flex;">
                    <!-- Earnings Column -->
                    <div style="flex: 1; border-right: 1px solid #e2e8f0;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                    <th style="padding: 7px 10px; font-size: 10px; font-weight: 800; text-align: left; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">EARNINGS</th>
                                    <th style="padding: 7px 10px; font-size: 10px; font-weight: 800; text-align: right; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; width: 85px;">AMOUNT</th>
                                    <th style="padding: 7px 10px; font-size: 10px; font-weight: 800; text-align: right; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; width: 85px;">YTD</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${earningsRows}
                            </tbody>
                            <tfoot>
                                <tr style="background: #f8fafc; border-top: 1px solid #cbd5e1;">
                                    <td style="padding: 7px 10px; font-size: 12px; font-weight: 800; color: #0f172a;">Gross Earnings</td>
                                    <td style="padding: 7px 10px; font-size: 12px; font-weight: 800; color: #0f172a; text-align: right;" colspan="2">${formatCurrency(data.grossEarnings)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <!-- Deductions Column -->
                    <div style="flex: 1;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                    <th style="padding: 7px 10px; font-size: 10px; font-weight: 800; text-align: left; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">DEDUCTIONS</th>
                                    <th style="padding: 7px 10px; font-size: 10px; font-weight: 800; text-align: right; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; width: 85px;">AMOUNT</th>
                                    <th style="padding: 7px 10px; font-size: 10px; font-weight: 800; text-align: right; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; width: 85px;">YTD</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${deductionsRows}
                            </tbody>
                            <tfoot>
                                <tr style="background: #f8fafc; border-top: 1px solid #cbd5e1;">
                                    <td style="padding: 7px 10px; font-size: 12px; font-weight: 800; color: #0f172a;">Total Deductions</td>
                                    <td style="padding: 7px 10px; font-size: 12px; font-weight: 800; color: #e11d48; text-align: right;" colspan="2">${formatCurrency(data.totalDeductions)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Total Net Payable Banner -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 9px 14px; background: #ffffff; border: 1px solid #d1fae5; border-radius: 6px; margin-bottom: 10px;">
                <div>
                    <div style="font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.04em;">TOTAL NET PAYABLE</div>
                    <div style="font-size: 10px; color: #64748b;">Gross Earnings - Total Deductions</div>
                </div>
                <div style="background: #ecfdf5; padding: 4px 12px; border-radius: 6px; font-size: 16px; font-weight: 800; color: #047857;">
                    ${formatCurrency(data.netPayable)}
                </div>
            </div>

            <!-- Amount in Words -->
            <div style="text-align: right; font-size: 11px; color: #475569; margin-bottom: 12px; padding-right: 2px;">
                <span style="color: #64748b;">Amount In Words :</span> <strong style="color: #0f172a;">${escapeHtml(data.netPayableWords || '')}</strong>
            </div>

            <!-- Footer Line -->
            <div style="border-top: 1px solid #e2e8f0; padding-top: 10px; text-align: center; font-size: 10px; color: #94a3b8; font-style: italic;">
                -- This document has been automatically generated by IES Payroll; therefore, a signature is not required. --
            </div>
        </div>
    `;
}

/**
 * Render live preview inside the form
 */
function renderLivePreview(data) {
    const previewContainer = document.getElementById('ps-live-preview-content');
    if (!previewContainer) return;
    previewContainer.innerHTML = buildPayslipPrintHTML(data);
}

/**
 * Print current form payslip
 */
export function printCurrentPayslip() {
    const data = collectFormData();
    triggerPrintDialog(data);
}

/**
 * Print payslip by Firestore ID
 */
export async function viewPrintPayslip(payslipId) {
    const p = currentPayslips.find(item => item.id === payslipId) || await DB.getPayslip(payslipId);
    if (!p) {
        alert("Payslip not found.");
        return;
    }
    triggerPrintDialog(p);
}

/**
 * Trigger browser print with exact styles in Portrait mode via clean isolated iframe
 */
function triggerPrintDialog(data) {
    let iframe = document.getElementById('payslip-print-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'payslip-print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.visibility = 'hidden';
        document.body.appendChild(iframe);
    }

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Payslip - ${escapeHtml(data.employeeName || 'Staff')}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        @page {
            size: A4 portrait !important;
            margin: 6mm 8mm !important;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        html, body {
            width: 100% !important;
            height: auto !important;
            background: #ffffff !important;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            color: #1e293b !important;
        }
        .payslip-document-wrapper {
            width: 100% !important;
            max-width: 100% !important;
            padding: 4px 8px !important;
            margin: 0 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }
    </style>
</head>
<body>
    ${buildPayslipPrintHTML(data)}
</body>
</html>`;

    // Also populate payslip-print-view for fallback
    const printArea = document.getElementById('payslip-print-view');
    if (printArea) {
        printArea.innerHTML = buildPayslipPrintHTML(data);
    }

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    const doPrint = () => {
        setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        }, 200);
    };

    const img = doc.querySelector('img');
    if (img && !img.complete) {
        img.onload = doPrint;
        img.onerror = doPrint;
    } else {
        doPrint();
    }
}

/**
 * Download single payslip as PDF (using html2pdf if available or fallback to print)
 */
export async function downloadSinglePayslipPDF(payslipId) {
    const p = currentPayslips.find(item => item.id === payslipId) || await DB.getPayslip(payslipId);
    if (!p) {
        alert("Payslip not found.");
        return;
    }
    downloadPayslipDataAsPDF(p);
}

export function downloadCurrentPayslipPDF() {
    const data = collectFormData();
    downloadPayslipDataAsPDF(data);
}

function downloadPayslipDataAsPDF(data) {
    const cleanName = (data.employeeName || 'Staff').replace(/[^a-zA-Z0-9]/g, '_');
    const month = (data.payPeriod || 'Month').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Payslip_${cleanName}_${month}.pdf`;

    const printArea = document.getElementById('payslip-print-view');
    if (!printArea) return;

    printArea.innerHTML = buildPayslipPrintHTML(data);
    printArea.classList.remove('hidden');

    if (window.html2pdf) {
        const opt = {
            margin: [5, 5, 5, 5],
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        window.html2pdf().set(opt).from(printArea.firstElementChild).save().then(() => {
            printArea.classList.add('hidden');
        }).catch(err => {
            console.error("html2pdf error:", err);
            printArea.classList.add('hidden');
            triggerPrintDialog(data);
        });
    } else {
        triggerPrintDialog(data);
    }
}

/**
 * Helper to escape HTML characters
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
