import * as DB from './db.js';

// State
let allExpenses = [];
let allExpensesUnsubscribe = null;
let currentOrderId = null;
let currentOrder = null;
let currentExpenses = [];
let expensesUnsubscribe = null;
let searchTerm = '';
let statusFilter = 'all'; // 'all', 'Pending', 'Delivered', 'filled', 'empty'
let monthFilter = ''; // 'YYYY-MM' or empty for All Months
let defaultMonthApplied = false;
let editingExpenseId = null;

// Expense Categories defined in the business format
export const EXPENSE_CATEGORIES = [
    'Raw Material',
    'Direct Labour',
    'Machine Cost',
    'Subcontract',
    'Logistics',
    'Overhead'
];

export const COMMON_UOMS = [
    'HOUR',
    'Kg',
    'Nos',
    'Mtr',
    'Set',
    'Day',
    'Trip',
    'Lot',
    'Pcs'
];

/**
 * Format currency in Indian Rupees style
 */
export function formatINR(val) {
    const num = parseFloat(val) || 0;
    return '₹ ' + num.toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

/**
 * Format date nicely (DD-MM-YYYY)
 */
export function formatDate(dateStr) {
    if (!dateStr || dateStr === '-') return '-';
    try {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            // YYYY-MM-DD
            if (parts[0].length === 4) {
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
        }
        return dateStr;
    } catch (e) {
        return dateStr;
    }
}

/**
 * Show a brief subtle toast on the costing sheet
 */
export function showCostingToast(message = 'Saved ✓') {
    let toast = document.getElementById('costing-toast-indicator');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'costing-toast-indicator';
        toast.className = 'fixed bottom-6 right-6 bg-slate-900 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-lg z-50 transition-opacity duration-300 pointer-events-none flex items-center gap-2 border border-slate-700';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="text-teal-400 font-bold">✓</span> ${message}`;
    toast.style.opacity = '1';
    toast.style.display = 'flex';
    clearTimeout(toast.hideTimeout);
    toast.hideTimeout = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 1500);
}

/**
 * Get PO/Sale Value for an order
 */
export function getOrderSaleValue(order) {
    if (!order) return 0;
    if (order.total !== undefined && order.total !== null && order.total !== '') {
        const t = parseFloat(order.total);
        if (!isNaN(t) && t > 0) return t;
    }
    const saleEa = parseFloat(order.saleValueEa) || 0;
    const qty = parseFloat(order.qty) || 1;
    return saleEa * qty;
}

/**
 * Initialize all costing expenses listener to keep list view in sync
 */
export function initCosting() {
    if (!allExpensesUnsubscribe) {
        allExpensesUnsubscribe = DB.subscribeToAllCostingExpenses((expenses) => {
            allExpenses = expenses;
            const listView = document.getElementById('view-costing_report');
            if (listView && !listView.classList.contains('hidden')) {
                renderCostingOrderList();
            }
        });
    }
}

/**
 * Set Search Query
 */
export function setCostingSearch(query) {
    searchTerm = (query || '').toLowerCase().trim();
    renderCostingOrderList();
}

/**
 * Set Status Filter
 */
export function setCostingStatusFilter(status) {
    statusFilter = status;
    renderCostingOrderList();
}

/**
 * Extract YYYY-MM from order date or startDate (handles both YYYY-MM-DD and DD-MM-YYYY)
 */
export function getOrderMonth(order) {
    if (!order) return '';
    const rawDate = String(order.date || order.startDate || '').trim();
    if (!rawDate) return '';
    // YYYY-MM or YYYY-MM-DD
    if (/^\d{4}-\d{2}/.test(rawDate)) {
        return rawDate.slice(0, 7);
    }
    // DD-MM-YYYY
    const parts = rawDate.split('-');
    if (parts.length === 3 && parts[2].length === 4 && parts[1].length === 2) {
        return `${parts[2]}-${parts[1]}`;
    }
    return '';
}

/**
 * Detect latest order month from orders list (defaults to current month if no orders)
 */
export function detectLatestOrderMonth(orders) {
    let latest = '';
    if (Array.isArray(orders)) {
        orders.forEach(o => {
            const m = getOrderMonth(o);
            if (m && (!latest || m > latest)) {
                latest = m;
            }
        });
    }
    if (!latest) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        latest = `${y}-${m}`;
    }
    return latest;
}

/**
 * Set Month Filter (YYYY-MM or empty for All Months)
 */
export function setCostingMonthFilter(month) {
    monthFilter = (month || '').trim();
    defaultMonthApplied = true;
    const monthInput = document.getElementById('costing-month-filter');
    if (monthInput && monthInput.value !== monthFilter) {
        monthInput.value = monthFilter;
    }
    renderCostingOrderList();
}

/**
 * Sanitize orders for Costing:
 * 1. Filter out direct delivery reports (entryType === 'delivery_report') to prevent duplicate clones
 * 2. Deduplicate orders by internalOrderNo, merging delivery details (DC No, delivery date, bill No)
 * 3. Include stand-alone delivery records only if no base internal order exists
 */
export function getSanitizedInternalOrders(allOrders) {
    if (!Array.isArray(allOrders)) return [];

    const rawActive = allOrders.filter(o => !o.isDeleted && !o.deleted);

    // 1. Separate base production orders from delivery reports
    const baseOrders = rawActive.filter(o => o.entryType !== 'delivery_report');
    const deliveryReports = rawActive.filter(o => o.entryType === 'delivery_report');

    // 2. Map delivery reports by IO number for quick lookup
    const deliveriesByIo = new Map();
    deliveryReports.forEach(d => {
        const ioKey = (d.internalOrderNo || '').trim().toUpperCase();
        if (!ioKey) return;
        if (!deliveriesByIo.has(ioKey)) {
            deliveriesByIo.set(ioKey, []);
        }
        deliveriesByIo.get(ioKey).push(d);
    });

    // 3. Deduplicate base orders by internalOrderNo
    const uniqueOrdersMap = new Map();

    baseOrders.forEach(order => {
        const ioKey = (order.internalOrderNo || order.id || '').trim().toUpperCase();
        if (!ioKey) {
            uniqueOrdersMap.set(order.id, { ...order });
            return;
        }

        if (!uniqueOrdersMap.has(ioKey)) {
            uniqueOrdersMap.set(ioKey, { ...order });
        } else {
            // Merge duplicate base orders (pick the one with valid PO value or newer data)
            const existing = uniqueOrdersMap.get(ioKey);
            const existingVal = getOrderSaleValue(existing);
            const currentVal = getOrderSaleValue(order);

            if (currentVal > existingVal || (!existing.poNo && order.poNo) || (!existing.drawingNo && order.drawingNo)) {
                uniqueOrdersMap.set(ioKey, { ...existing, ...order });
            }
        }
    });

    // 4. If any delivery reports exist for an IO that has NO base internal order at all, include them
    deliveryReports.forEach(d => {
        const ioKey = (d.internalOrderNo || '').trim().toUpperCase();
        if (ioKey && !uniqueOrdersMap.has(ioKey)) {
            uniqueOrdersMap.set(ioKey, { ...d });
        }
    });

    // 5. Merge delivery metadata (delivery date, DC No, Bill No) into the base orders
    const result = Array.from(uniqueOrdersMap.values()).map(order => {
        const ioKey = (order.internalOrderNo || '').trim().toUpperCase();
        const linkedDeliveries = deliveriesByIo.get(ioKey) || [];

        if (linkedDeliveries.length > 0) {
            const merged = { ...order };
            const latestDel = linkedDeliveries[linkedDeliveries.length - 1];
            if (!merged.deliveryDateActual && (latestDel.deliveryDateActual || latestDel.date)) {
                merged.deliveryDateActual = latestDel.deliveryDateActual || latestDel.date;
            }
            if (!merged.dcNo) {
                const dcs = linkedDeliveries.map(d => d.dcNo).filter(Boolean);
                if (dcs.length) merged.dcNo = [...new Set(dcs)].join(', ');
            }
            if (!merged.billNo) {
                const bills = linkedDeliveries.map(d => d.billNo).filter(Boolean);
                if (bills.length) merged.billNo = [...new Set(bills)].join(', ');
            }
            return merged;
        }
        return order;
    });

    return result;
}

/**
 * Render the Order List View with Green Highlight & Tick on Filled Sheets
 */
export function renderCostingOrderList() {
    const tableBody = document.getElementById('costing-orders-table-body');
    const emptyState = document.getElementById('costing-orders-empty');
    if (!tableBody) return;

    // Get orders from app state and sanitize/deduplicate
    const allOrders = window.adminApp?.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    const sanitized = getSanitizedInternalOrders(allOrders);

    // Apply default month filter to latest month on initial load to avoid rendering lag
    if (!defaultMonthApplied && sanitized.length > 0) {
        monthFilter = detectLatestOrderMonth(sanitized);
        defaultMonthApplied = true;
        const monthInput = document.getElementById('costing-month-filter');
        if (monthInput) {
            monthInput.value = monthFilter;
        }
    } else if (monthFilter) {
        const monthInput = document.getElementById('costing-month-filter');
        if (monthInput && monthInput.value !== monthFilter) {
            monthInput.value = monthFilter;
        }
    }

    let filtered = sanitized;

    // Filter by month (WO Date, Start Date, or Date)
    if (monthFilter) {
        filtered = filtered.filter(o => getOrderMonth(o) === monthFilter);
    }

    // Filter by status / filled status
    if (statusFilter === 'filled') {
        filtered = filtered.filter(o => {
            const exp = allExpenses.filter(e => e.orderId === o.id || e.internalOrderNo === o.internalOrderNo);
            return exp.length > 0;
        });
    } else if (statusFilter === 'empty') {
        filtered = filtered.filter(o => {
            const exp = allExpenses.filter(e => e.orderId === o.id || e.internalOrderNo === o.internalOrderNo);
            return exp.length === 0;
        });
    } else if (statusFilter !== 'all') {
        filtered = filtered.filter(o => {
            const st = (o.status || 'Pending').toLowerCase();
            return st === statusFilter.toLowerCase();
        });
    }

    // Filter by search query
    if (searchTerm) {
        filtered = filtered.filter(o => {
            const orderNo = (o.internalOrderNo || '').toLowerCase();
            const customer = (o.customer || '').toLowerCase();
            const desc = (o.description || '').toLowerCase();
            const poNo = (o.poNo || '').toLowerCase();
            const drawing = (o.drawingNo || o.itemCode || '').toLowerCase();
            return orderNo.includes(searchTerm) ||
                   customer.includes(searchTerm) ||
                   desc.includes(searchTerm) ||
                   poNo.includes(searchTerm) ||
                   drawing.includes(searchTerm);
        });
    }

    // Sort: newest internal order first
    filtered.sort((a, b) => {
        const noA = (a.internalOrderNo || '');
        const noB = (b.internalOrderNo || '');
        return noB.localeCompare(noA, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Compute aggregate metrics
    let totalOrdersCount = filtered.length;
    let filledOrdersCount = 0;
    let totalPOValueSum = 0;
    let totalExpenseSum = 0;

    const rowsHTML = filtered.map(order => {
        const poVal = getOrderSaleValue(order);
        
        // Sum expenses for this order
        const expenses = allExpenses.filter(e => e.orderId === order.id || e.internalOrderNo === order.internalOrderNo);
        const isFilled = expenses.length > 0;
        if (isFilled) filledOrdersCount++;

        const totalExp = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        
        const profit = poVal - totalExp;
        const marginPct = poVal > 0 ? ((profit / poVal) * 100).toFixed(1) : 0;
        const isProfitable = profit >= 0;

        totalPOValueSum += poVal;
        totalExpenseSum += totalExp;

        const statusClass = (order.status === 'Delivered') 
            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
            : 'bg-amber-100 text-amber-700 border-amber-200';

        // Row highlighting: Soft green background and green left border if filled
        const rowClass = isFilled ? 'costing-row-filled' : 'hover:bg-slate-50';

        // Costing status badge with tick
        const costingBadge = isFilled 
            ? `<span class="costing-badge-filled" style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; background-color: #d1fae5; color: #065f46; border: 1px solid #6ee7b7;">
                 <svg style="width: 14px; height: 14px; stroke: #059669;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                 </svg>
                 Filled (${expenses.length})
               </span>`
            : `<span class="costing-badge-empty" style="display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 9999px; font-size: 0.72rem; font-weight: 500; background-color: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0;">
                 Empty
               </span>`;

        return `
            <tr class="transition-colors border-b border-slate-100 cursor-pointer ${rowClass}" 
                style="${isFilled ? 'background-color: #ecfdf5 !important; border-left: 4px solid #10b981 !important;' : ''}"
                onclick="window.adminApp.openCostingDetail('${order.id}')">
                <td class="px-4 py-3 text-center whitespace-nowrap">
                    ${costingBadge}
                </td>
                <td class="px-4 py-3 font-semibold text-slate-900 flex items-center gap-2">
                    ${isFilled ? `
                        <span style="display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 9999px; background-color: #059669; color: #ffffff; font-size: 11px; font-weight: bold; box-shadow: 0 1px 2px rgba(0,0,0,0.15);" title="Costing Sheet Filled">
                            ✓
                        </span>
                    ` : `
                        <span style="display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 9999px; background-color: #e2e8f0; color: #94a3b8; font-size: 10px;">
                            •
                        </span>
                    `}
                    ${order.internalOrderNo || '-'}
                </td>
                <td class="px-4 py-3 text-slate-600 text-sm whitespace-nowrap">${formatDate(order.date)}</td>
                <td class="px-4 py-3 font-medium text-slate-800">${order.customer || '-'}</td>
                <td class="px-4 py-3 text-slate-600 text-sm max-w-xs truncate" title="${order.description || ''}">${order.description || '-'}</td>
                <td class="px-4 py-3 text-center text-sm font-semibold text-slate-700">${order.qty || 1}</td>
                <td class="px-4 py-3 text-center whitespace-nowrap">
                    <span class="inline-block px-2.5 py-0.5 text-xs font-semibold rounded-full border ${statusClass}">
                        ${order.status || 'Pending'}
                    </span>
                </td>
                <td class="px-4 py-3 text-right font-medium text-slate-800 whitespace-nowrap">${formatINR(poVal)}</td>
                <td class="px-4 py-3 text-right font-medium text-slate-700 whitespace-nowrap">${formatINR(totalExp)}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                    <div class="font-bold ${isProfitable ? 'text-emerald-600' : 'text-rose-600'}">
                        ${formatINR(profit)}
                    </div>
                    <div class="text-xs ${isProfitable ? 'text-emerald-500' : 'text-rose-500'}">
                        ${marginPct}% margin
                    </div>
                </td>
                <td class="px-4 py-3 text-center whitespace-nowrap">
                    <button type="button" class="costing-btn-action ${isFilled ? 'action-edit' : 'action-fill'}"
                            style="background: ${isFilled ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)'}; color: #ffffff !important; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 0.75rem; border: none; cursor: pointer; box-shadow: 0 2px 6px ${isFilled ? 'rgba(5, 150, 105, 0.35)' : 'rgba(13, 148, 136, 0.35)'};"
                            onclick="event.stopPropagation(); window.adminApp.openCostingDetail('${order.id}')">
                        <svg style="width: 14px; height: 14px; stroke: #ffffff; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        <span style="color: #ffffff !important; font-weight: 700;">${isFilled ? 'View / Edit' : 'Fill Costing'}</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tableBody.innerHTML = rowsHTML;

    if (emptyState) {
        if (filtered.length === 0) {
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
        }
    }

    // Update KPI counters
    const kpiCount = document.getElementById('costing-kpi-count');
    const kpiPO = document.getElementById('costing-kpi-po');
    const kpiExp = document.getElementById('costing-kpi-exp');
    const kpiProfit = document.getElementById('costing-kpi-profit');

    if (kpiCount) {
        kpiCount.innerHTML = `${totalOrdersCount} <span class="text-xs font-semibold text-emerald-600 ml-1">(${filledOrdersCount} Filled ✓)</span>`;
    }
    if (kpiPO) kpiPO.textContent = formatINR(totalPOValueSum);
    if (kpiExp) kpiExp.textContent = formatINR(totalExpenseSum);
    if (kpiProfit) {
        const netProfit = totalPOValueSum - totalExpenseSum;
        kpiProfit.textContent = formatINR(netProfit);
        kpiProfit.className = `text-2xl font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }
}

/**
 * Open Costing Detail View for a specific Order
 */
export function openCostingDetail(orderId) {
    const allOrders = window.adminApp?.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    const sanitizedOrders = getSanitizedInternalOrders(allOrders);
    const lookupKey = String(orderId || '').trim().toUpperCase();
    currentOrder = sanitizedOrders.find(o => o.id === orderId || (o.internalOrderNo && o.internalOrderNo.trim().toUpperCase() === lookupKey));
    
    if (!currentOrder) {
        alert('Internal order not found.');
        return;
    }

    currentOrderId = currentOrder.id;

    // Switch view to costing_detail
    window.adminApp.switchView('costing_detail');

    // Subscribe to expenses for this specific order
    if (expensesUnsubscribe) {
        expensesUnsubscribe();
        expensesUnsubscribe = null;
    }

    expensesUnsubscribe = DB.subscribeToCostingExpenses(currentOrderId, (expenses) => {
        currentExpenses = expenses;
        renderCostingDetailContent();
    });
}

/**
 * Return from Detail View to Order List View
 */
export function backToOrderList() {
    if (expensesUnsubscribe) {
        expensesUnsubscribe();
        expensesUnsubscribe = null;
    }
    window.adminApp.switchView('costing_report');
}

/**
 * Handle direct edit of Order Info fields (WO Date, Customer, Drawing, PO Value, etc.)
 */
export async function updateOrderField(field, value) {
    if (!currentOrder || !currentOrder.id) return;

    let parsedVal = value;
    if (['qty', 'budget', 'total', 'saleValueEa'].includes(field)) {
        parsedVal = parseFloat(value) || 0;
    }

    const updates = { [field]: parsedVal };

    // If total (PO value) is edited, save it
    if (field === 'total') {
        updates.total = parsedVal;
    }

    try {
        await DB.updateOrder(currentOrder.id, updates);
        currentOrder[field] = parsedVal;
        
        // Re-calculate totals and PL in UI
        calculateAndRenderSummaries();
        showCostingToast('Order updated ✓');
    } catch (err) {
        console.error('Error updating order field:', err);
        alert('Failed to save update: ' + err.message);
    }
}

/**
 * Handle direct inline edit of an expense field in the table
 */
export async function updateExpenseField(expenseId, field, value) {
    const exp = currentExpenses.find(e => e.id === expenseId);
    if (!exp) return;

    let parsedVal = value;
    if (['qty', 'rate', 'amount'].includes(field)) {
        parsedVal = parseFloat(value) || 0;
    }

    const updates = { [field]: parsedVal };

    // Auto-compute amount if qty or rate changed
    if (field === 'qty' || field === 'rate') {
        const newQty = (field === 'qty') ? parsedVal : (parseFloat(exp.qty) || 0);
        const newRate = (field === 'rate') ? parsedVal : (parseFloat(exp.rate) || 0);
        updates.amount = parseFloat((newQty * newRate).toFixed(2));
        
        // Update input element for amount in the DOM immediately
        const amtInput = document.querySelector(`input[data-exp-id="${expenseId}"][data-field="amount"]`);
        if (amtInput) amtInput.value = updates.amount;
    }

    try {
        await DB.updateCostingExpense(expenseId, updates);
        Object.assign(exp, updates);
        calculateAndRenderSummaries();
        showCostingToast('Expense saved ✓');
    } catch (err) {
        console.error('Error updating expense field:', err);
        alert('Failed to save expense edit: ' + err.message);
    }
}

/**
 * Add a quick blank expense row immediately into the table
 */
export async function addQuickExpenseRow() {
    if (!currentOrder) return;
    const payload = {
        orderId: currentOrder.id,
        internalOrderNo: currentOrder.internalOrderNo || '',
        date: new Date().toISOString().slice(0, 10),
        category: 'Direct Labour',
        description: '',
        supplierEmployee: '',
        qty: 1,
        uom: 'HOUR',
        rate: 0,
        amount: 0,
        remarks: ''
    };

    try {
        await DB.addCostingExpense(payload);
        showCostingToast('Row added ✓');
    } catch (err) {
        console.error('Error adding quick expense:', err);
        alert('Failed to add expense: ' + err.message);
    }
}

/**
 * Render the entire Costing Detail page content
 */
export function renderCostingDetailContent() {
    if (!currentOrder) return;

    // 1. Render Header Info
    const bannerTitle = document.getElementById('costing-detail-banner-title');
    if (bannerTitle) {
        const isFilled = currentExpenses.length > 0;
        bannerTitle.innerHTML = `CR -${currentOrder.internalOrderNo || ''} ${isFilled ? `<span style="background-color: #10b981; color: #ffffff; font-size: 0.75rem; padding: 2px 10px; border-radius: 9999px; margin-left: 12px; font-weight: 700; letter-spacing: 0.5px; vertical-align: middle;">✓ FILLED (${currentExpenses.length} EXPENSES)</span>` : `<span style="background-color: #64748b; color: #ffffff; font-size: 0.72rem; padding: 2px 8px; border-radius: 9999px; margin-left: 12px; font-weight: 600; vertical-align: middle;">EMPTY</span>`}`;
    }

    // Populate editable Order Info inputs
    const setInputValue = (id, val) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el) {
            el.value = (val !== undefined && val !== null) ? val : '';
        }
    };

    setInputValue('cr-edit-date', currentOrder.date || '');
    setInputValue('cr-edit-drawing', currentOrder.drawingNo || currentOrder.itemCode || '');
    setInputValue('cr-edit-status', currentOrder.status || 'Pending');
    setInputValue('cr-edit-customer', currentOrder.customer || '');
    setInputValue('cr-edit-description', currentOrder.description || '');
    setInputValue('cr-edit-budget', currentOrder.budget || '');
    setInputValue('cr-edit-qty', currentOrder.qty !== undefined ? currentOrder.qty : 1);
    setInputValue('cr-edit-pono', currentOrder.poNo || '');
    setInputValue('cr-edit-povalue', getOrderSaleValue(currentOrder));
    setInputValue('cr-edit-startdate', currentOrder.startDate || currentOrder.date || '');
    setInputValue('cr-edit-deliverydate', currentOrder.deliveryDateActual || currentOrder.delDate || '');
    setInputValue('cr-edit-dcno', currentOrder.dcNo || '');

    // 2. Render Expense List Table (with inline editable inputs)
    const expenseBody = document.getElementById('costing-expense-list-body');

    if (expenseBody) {
        if (currentExpenses.length === 0) {
            expenseBody.innerHTML = `
                <tr id="costing-expense-empty">
                    <td colspan="10" class="text-center py-8 text-slate-400 font-medium">
                        No expenses logged yet. Click <button type="button" class="font-bold text-teal-600 underline" onclick="window.adminApp.openAddCostingExpense()">+ Add Expense</button> or <button type="button" class="font-bold text-teal-600 underline" onclick="window.adminApp.addQuickCostingExpenseRow()">+ Add Quick Row</button> to record costs.
                    </td>
                </tr>
            `;
        } else {
            const rowsHTML = currentExpenses.map((exp) => {
                const qty = parseFloat(exp.qty) !== undefined && !isNaN(parseFloat(exp.qty)) ? parseFloat(exp.qty) : 1;
                const rate = parseFloat(exp.rate) || 0;
                const amt = parseFloat(exp.amount) !== undefined && !isNaN(parseFloat(exp.amount)) ? parseFloat(exp.amount) : (qty * rate);

                const categoryOptions = EXPENSE_CATEGORIES.map(cat => 
                    `<option value="${cat}" ${cat === exp.category ? 'selected' : ''}>${cat}</option>`
                ).join('');

                return `
                    <tr class="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                        <td class="p-1 border border-slate-300 text-center w-28">
                            <input type="date" class="cr-field-input text-center text-xs" 
                                   value="${exp.date || ''}" 
                                   data-exp-id="${exp.id}" data-field="date"
                                   onchange="window.adminApp.handleInlineExpenseEdit('${exp.id}', 'date', this.value)">
                        </td>
                        <td class="p-1 border border-slate-300 w-36">
                            <select class="cr-field-select text-xs font-semibold"
                                    data-exp-id="${exp.id}" data-field="category"
                                    onchange="window.adminApp.handleInlineExpenseEdit('${exp.id}', 'category', this.value)">
                                ${categoryOptions}
                            </select>
                        </td>
                        <td class="p-1 border border-slate-300 min-w-[140px]">
                            <input type="text" class="cr-field-input text-xs" 
                                   value="${exp.description || ''}" placeholder="Description"
                                   data-exp-id="${exp.id}" data-field="description"
                                   onchange="window.adminApp.handleInlineExpenseEdit('${exp.id}', 'description', this.value)">
                        </td>
                        <td class="p-1 border border-slate-300 w-40">
                            <input type="text" class="cr-field-input text-xs" 
                                   value="${exp.supplierEmployee || ''}" placeholder="Supplier / Employee"
                                   data-exp-id="${exp.id}" data-field="supplierEmployee"
                                   onchange="window.adminApp.handleInlineExpenseEdit('${exp.id}', 'supplierEmployee', this.value)">
                        </td>
                        <td class="p-1 border border-slate-300 text-center w-20">
                            <input type="number" step="0.001" class="cr-field-input text-center text-xs font-mono" 
                                   value="${qty}" 
                                   data-exp-id="${exp.id}" data-field="qty"
                                   onchange="window.adminApp.handleInlineExpenseEdit('${exp.id}', 'qty', this.value)">
                        </td>
                        <td class="p-1 border border-slate-300 text-center w-16">
                            <input type="text" class="cr-field-input text-center text-xs" 
                                   value="${exp.uom || ''}" placeholder="UOM"
                                   data-exp-id="${exp.id}" data-field="uom"
                                   onchange="window.adminApp.handleInlineExpenseEdit('${exp.id}', 'uom', this.value)">
                        </td>
                        <td class="p-1 border border-slate-300 text-right w-24">
                            <input type="number" step="0.01" class="cr-field-input text-right text-xs font-mono" 
                                   value="${rate}" placeholder="0.00"
                                   data-exp-id="${exp.id}" data-field="rate"
                                   onchange="window.adminApp.handleInlineExpenseEdit('${exp.id}', 'rate', this.value)">
                        </td>
                        <td class="p-1 border border-slate-300 text-right w-28">
                            <input type="number" step="0.01" class="cr-field-input text-right text-xs font-mono font-bold text-slate-900" 
                                   value="${amt}" placeholder="0.00"
                                   data-exp-id="${exp.id}" data-field="amount"
                                   onchange="window.adminApp.handleInlineExpenseEdit('${exp.id}', 'amount', this.value)">
                        </td>
                        <td class="p-1 border border-slate-300 min-w-[120px]">
                            <input type="text" class="cr-field-input text-xs text-rose-600 font-medium" 
                                   value="${exp.remarks || ''}" placeholder="Remarks"
                                   data-exp-id="${exp.id}" data-field="remarks"
                                   onchange="window.adminApp.handleInlineExpenseEdit('${exp.id}', 'remarks', this.value)">
                        </td>
                        <td class="p-1 border border-slate-300 text-center w-16 no-print">
                            <div class="flex items-center justify-center gap-1">
                                <button type="button" class="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-teal-700 transition-colors"
                                        title="Edit Modal" onclick="window.adminApp.openEditCostingExpense('${exp.id}')">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                </button>
                                <button type="button" class="p-1 hover:bg-rose-100 rounded text-slate-400 hover:text-rose-600 transition-colors"
                                        title="Delete Expense" onclick="window.adminApp.deleteCostingExpense('${exp.id}')">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
            expenseBody.innerHTML = rowsHTML;
        }
    }

    calculateAndRenderSummaries();
}

/**
 * Re-calculate category totals, profit/loss, and update summary tables
 */
export function calculateAndRenderSummaries() {
    if (!currentOrder) return;
    const poVal = getOrderSaleValue(currentOrder);

    const catTotals = {
        'Raw Material': 0,
        'Direct Labour': 0,
        'Machine Cost': 0,
        'Subcontract': 0,
        'Logistics': 0,
        'Overhead': 0
    };

    let totalExpensesSum = 0;
    currentExpenses.forEach(exp => {
        const cat = exp.category || 'Overhead';
        const amt = parseFloat(exp.amount) || ((parseFloat(exp.qty) || 0) * (parseFloat(exp.rate) || 0));
        if (catTotals[cat] !== undefined) {
            catTotals[cat] += amt;
        } else {
            catTotals['Overhead'] += amt;
        }
        totalExpensesSum += amt;
    });

    // Populate Category Totals
    const setSummaryRow = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    };

    setSummaryRow('cr-sum-raw-material', catTotals['Raw Material']);
    setSummaryRow('cr-sum-direct-labour', catTotals['Direct Labour']);
    setSummaryRow('cr-sum-machine-cost', catTotals['Machine Cost']);
    setSummaryRow('cr-sum-subcontract', catTotals['Subcontract']);
    setSummaryRow('cr-sum-logistics', catTotals['Logistics']);
    setSummaryRow('cr-sum-overhead', catTotals['Overhead']);
    setSummaryRow('cr-sum-total-expense', totalExpensesSum);

    // Compute Profit / Loss
    const profit = poVal - totalExpensesSum;
    const profitMargin = poVal > 0 ? (profit / poVal) : 0;
    const profitMarginPct = (profitMargin * 100).toFixed(2);

    const setPLRow = (id, val, isColored = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = val;
        if (isColored) {
            if (profit >= 0) {
                el.style.color = '#15803d'; // Green
                el.style.fontWeight = 'bold';
            } else {
                el.style.color = '#dc2626'; // Red
                el.style.fontWeight = 'bold';
            }
        }
    };

    setPLRow('cr-pl-sales-val', `₹ ${poVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setPLRow('cr-pl-total-exp', `₹ ${totalExpensesSum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setPLRow('cr-pl-profit-loss', `₹ ${profit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, true);
    setPLRow('cr-pl-margin', `${profitMarginPct}% (${profitMargin.toFixed(4)})`, true);
}

/**
 * Open Modal to Add or Edit an Expense
 */
export function openExpenseModal(expenseId = null) {
    editingExpenseId = expenseId;
    const form = document.getElementById('costing-expense-form');
    const modalTitle = document.getElementById('costing-expense-modal-title');
    if (!form) return;

    form.reset();

    // Default Date to today
    const dateInput = form.querySelector('[name="date"]');
    if (dateInput) {
        dateInput.value = new Date().toISOString().slice(0, 10);
    }

    // Default Qty to 1
    const qtyInput = form.querySelector('[name="qty"]');
    if (qtyInput) qtyInput.value = '1';

    if (expenseId) {
        // Edit Mode
        if (modalTitle) modalTitle.textContent = 'Edit Expense Item';
        const exp = currentExpenses.find(e => e.id === expenseId);
        if (exp) {
            if (dateInput && exp.date) dateInput.value = exp.date;
            const catInput = form.querySelector('[name="category"]');
            if (catInput && exp.category) catInput.value = exp.category;
            const descInput = form.querySelector('[name="description"]');
            if (descInput) descInput.value = exp.description || '';
            const suppInput = form.querySelector('[name="supplierEmployee"]');
            if (suppInput) suppInput.value = exp.supplierEmployee || '';
            if (qtyInput) qtyInput.value = exp.qty !== undefined ? exp.qty : '1';
            const uomInput = form.querySelector('[name="uom"]');
            if (uomInput) uomInput.value = exp.uom || '';
            const rateInput = form.querySelector('[name="rate"]');
            if (rateInput) rateInput.value = exp.rate !== undefined ? exp.rate : '';
            const amtInput = form.querySelector('[name="amount"]');
            if (amtInput) amtInput.value = exp.amount !== undefined ? exp.amount : '';
            const remInput = form.querySelector('[name="remarks"]');
            if (remInput) remInput.value = exp.remarks || '';
        }
    } else {
        // Add Mode
        if (modalTitle) modalTitle.textContent = 'Add Expense Item';
    }

    // Trigger standardized openModal which sets active and handles transitions
    if (window.adminApp?.openModal) {
        window.adminApp.openModal('costing-expense-modal');
    } else {
        const modal = document.getElementById('costing-expense-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('active');
        }
    }
}

/**
 * Auto compute amount when Qty or Rate change in Modal
 */
export function setupExpenseModalCalculations() {
    const form = document.getElementById('costing-expense-form');
    if (!form) return;

    const qtyInput = form.querySelector('[name="qty"]');
    const rateInput = form.querySelector('[name="rate"]');
    const amtInput = form.querySelector('[name="amount"]');

    const recalculate = () => {
        const q = parseFloat(qtyInput?.value) || 0;
        const r = parseFloat(rateInput?.value) || 0;
        if (amtInput && (q > 0 || r > 0)) {
            amtInput.value = (q * r).toFixed(2);
        }
    };

    if (qtyInput) qtyInput.addEventListener('input', recalculate);
    if (rateInput) rateInput.addEventListener('input', recalculate);
}

/**
 * Handle Expense Form Submit (Add or Update)
 */
export async function handleSaveExpense(e) {
    if (e) e.preventDefault();
    if (!currentOrder) return;

    const form = document.getElementById('costing-expense-form');
    if (!form) return;

    const date = form.querySelector('[name="date"]')?.value || new Date().toISOString().slice(0, 10);
    const category = form.querySelector('[name="category"]')?.value || 'Direct Labour';
    const description = form.querySelector('[name="description"]')?.value || '';
    const supplierEmployee = form.querySelector('[name="supplierEmployee"]')?.value || '';
    const qty = parseFloat(form.querySelector('[name="qty"]')?.value) || 1;
    const uom = form.querySelector('[name="uom"]')?.value || '';
    const rate = parseFloat(form.querySelector('[name="rate"]')?.value) || 0;
    
    let amount = parseFloat(form.querySelector('[name="amount"]')?.value);
    if (isNaN(amount)) {
        amount = qty * rate;
    }

    const remarks = form.querySelector('[name="remarks"]')?.value || '';

    const payload = {
        orderId: currentOrder.id,
        internalOrderNo: currentOrder.internalOrderNo || '',
        date,
        category,
        description,
        supplierEmployee,
        qty,
        uom,
        rate,
        amount,
        remarks
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
    }

    try {
        if (editingExpenseId) {
            await DB.updateCostingExpense(editingExpenseId, payload);
            showCostingToast('Expense updated ✓');
        } else {
            await DB.addCostingExpense(payload);
            showCostingToast('Expense added ✓');
        }
        closeExpenseModal();
    } catch (err) {
        console.error("Error saving expense:", err);
        alert("Failed to save expense: " + err.message);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Expense';
        }
    }
}

/**
 * Close Expense Modal
 */
export function closeExpenseModal() {
    if (window.adminApp?.closeModal) {
        window.adminApp.closeModal('costing-expense-modal');
    } else {
        const modal = document.getElementById('costing-expense-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.classList.add('hidden');
        }
    }
    editingExpenseId = null;
}

/**
 * Delete Expense with confirmation
 */
export async function handleDeleteExpense(expenseId) {
    if (!confirm('Are you sure you want to delete this expense entry?')) return;
    try {
        await DB.deleteCostingExpense(expenseId);
        showCostingToast('Expense deleted ✓');
    } catch (err) {
        console.error("Error deleting expense:", err);
        alert("Failed to delete expense: " + err.message);
    }
}

/**
 * Export Costing Report to PDF using jsPDF + autoTable
 */
export function exportCostingPDF() {
    if (!currentOrder) return;
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
        alert("PDF generator library not loaded.");
        return;
    }

    const doc = new jsPDF('landscape', 'pt', 'a4');
    const orderNo = currentOrder.internalOrderNo || 'Costing_Report';

    // Title Banner
    doc.setFillColor(27, 68, 117); // Dark Blue
    doc.rect(40, 30, 762, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`CR -${currentOrder.internalOrderNo || ''}`, 421, 50, { align: 'center' });

    // Order Info Grid
    const poVal = getOrderSaleValue(currentOrder);
    const infoData = [
        [
            { content: 'WO Date', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            formatDate(currentOrder.date),
            { content: 'Drawing:', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            currentOrder.drawingNo || currentOrder.itemCode || '-',
            { content: 'Status', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            currentOrder.status || 'Pending'
        ],
        [
            { content: 'Customer', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            currentOrder.customer || '-',
            { content: 'Part / Project', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            currentOrder.description || '-',
            { content: 'Budget:', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            currentOrder.budget ? `₹ ${currentOrder.budget}` : '-'
        ],
        [
            { content: 'Quantity', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            (currentOrder.qty || 1).toString(),
            { content: 'PO No.', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            currentOrder.poNo || '-',
            { content: 'PO Value', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            `₹ ${poVal.toLocaleString('en-IN')}`
        ],
        [
            { content: 'Start Date', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            formatDate(currentOrder.startDate || currentOrder.date),
            { content: 'Delivery Date', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            formatDate(currentOrder.deliveryDateActual || currentOrder.delDate || '-'),
            { content: 'DC NO', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
            currentOrder.dcNo || '-'
        ]
    ];

    doc.autoTable({
        body: infoData,
        startY: 65,
        margin: { left: 40, right: 40 },
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 4, textColor: [30, 41, 59] },
        columnStyles: {
            0: { cellWidth: 70 },
            1: { cellWidth: 140 },
            2: { cellWidth: 80 },
            3: { cellWidth: 200 },
            4: { cellWidth: 80 },
            5: { cellWidth: 192 }
        }
    });

    // Expense List Banner
    const startYAfterInfo = doc.lastAutoTable.finalY + 15;
    doc.setFillColor(27, 68, 117);
    doc.rect(40, startYAfterInfo, 762, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('EXPENSE LIST', 421, startYAfterInfo + 15, { align: 'center' });

    // Expenses Table
    const expenseRows = currentExpenses.map(exp => {
        const qty = parseFloat(exp.qty) || 0;
        const rate = parseFloat(exp.rate) || 0;
        const amt = parseFloat(exp.amount) || (qty * rate);
        return [
            formatDate(exp.date),
            exp.category || '',
            exp.description || '',
            exp.supplierEmployee || '',
            qty.toFixed(3),
            exp.uom || '',
            `₹ ${rate.toFixed(2)}`,
            `₹ ${amt.toLocaleString('en-IN')}`,
            exp.remarks || ''
        ];
    });

    if (expenseRows.length === 0) {
        expenseRows.push(['-', 'No expenses logged', '', '', '', '', '', '₹ 0', '']);
    }

    doc.autoTable({
        head: [['Date', 'Expense Category', 'Expense Description', 'Supplier / Employee', 'Qty/Day', 'UOM', 'Rate', 'Amount', 'Remarks']],
        body: expenseRows,
        startY: startYAfterInfo + 25,
        margin: { left: 40, right: 40 },
        theme: 'grid',
        headStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9 },
        styles: { fontSize: 8.5, cellPadding: 3.5, textColor: [30, 41, 59] },
        columnStyles: {
            0: { cellWidth: 65, halign: 'center' },
            1: { cellWidth: 95 },
            2: { cellWidth: 150 },
            3: { cellWidth: 110 },
            4: { cellWidth: 50, halign: 'center' },
            5: { cellWidth: 45, halign: 'center' },
            6: { cellWidth: 60, halign: 'right' },
            7: { cellWidth: 70, halign: 'right', fontStyle: 'bold' },
            8: { cellWidth: 117, textColor: [220, 38, 38] }
        }
    });

    // Summary & Profit/Loss (Side by Side)
    const summaryStartY = doc.lastAutoTable.finalY + 15;

    // Check if new page needed
    if (summaryStartY > 430) {
        doc.addPage('a4', 'landscape');
    }

    const currentY = (summaryStartY > 430) ? 40 : summaryStartY;

    // Left Banner: EXPENSE SUMMARY
    doc.setFillColor(27, 68, 117);
    doc.rect(40, currentY, 370, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('EXPENSE SUMMARY', 225, currentY + 14, { align: 'center' });

    // Right Banner: PROFIT / LOSS
    doc.setFillColor(27, 68, 117);
    doc.rect(430, currentY, 372, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text('PROFIT / LOSS', 616, currentY + 14, { align: 'center' });

    // Compute Summaries
    const catTotals = {
        'Raw Material': 0,
        'Direct Labour': 0,
        'Machine Cost': 0,
        'Subcontract': 0,
        'Logistics': 0,
        'Overhead': 0
    };
    let totalExpensesSum = 0;
    currentExpenses.forEach(exp => {
        const cat = exp.category || 'Overhead';
        const amt = parseFloat(exp.amount) || ((parseFloat(exp.qty) || 0) * (parseFloat(exp.rate) || 0));
        if (catTotals[cat] !== undefined) catTotals[cat] += amt;
        else catTotals['Overhead'] += amt;
        totalExpensesSum += amt;
    });

    const summaryData = [
        ['Raw Material', `₹ ${catTotals['Raw Material'].toLocaleString('en-IN')}`],
        ['Direct Labour', `₹ ${catTotals['Direct Labour'].toLocaleString('en-IN')}`],
        ['Machine Cost', `₹ ${catTotals['Machine Cost'].toLocaleString('en-IN')}`],
        ['Subcontract', `₹ ${catTotals['Subcontract'].toLocaleString('en-IN')}`],
        ['Logistics', `₹ ${catTotals['Logistics'].toLocaleString('en-IN')}`],
        ['Overhead', `₹ ${catTotals['Overhead'].toLocaleString('en-IN')}`],
        [{ content: 'TOTAL EXPENSE', styles: { fontStyle: 'bold' } }, { content: `₹ ${totalExpensesSum.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold' } }]
    ];

    const profit = poVal - totalExpensesSum;
    const profitMarginPct = poVal > 0 ? ((profit / poVal) * 100).toFixed(2) + '%' : '0%';

    const plData = [
        ['Sales / PO Value', `₹ ${poVal.toLocaleString('en-IN')}`],
        ['Total Expenses', `₹ ${totalExpensesSum.toLocaleString('en-IN')}`],
        [{ content: 'Profit / Loss', styles: { fontStyle: 'bold', textColor: profit >= 0 ? [21, 128, 61] : [220, 38, 38] } },
         { content: `₹ ${profit.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold', textColor: profit >= 0 ? [21, 128, 61] : [220, 38, 38] } }],
        [{ content: 'Profit Margin %', styles: { fontStyle: 'bold' } }, profitMarginPct],
        ['', ''],
        ['', ''],
        ['', '']
    ];

    // Left Table
    doc.autoTable({
        head: [['Category', 'Total']],
        body: summaryData,
        startY: currentY + 22,
        margin: { left: 40 },
        tableWidth: 370,
        theme: 'grid',
        headStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontStyle: 'bold' },
        styles: { fontSize: 8.5, cellPadding: 3 }
    });

    // Right Table
    doc.autoTable({
        head: [['Particular', 'Amount']],
        body: plData,
        startY: currentY + 22,
        margin: { left: 430 },
        tableWidth: 372,
        theme: 'grid',
        headStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontStyle: 'bold' },
        styles: { fontSize: 8.5, cellPadding: 3 }
    });

    doc.save(`Costing_Report_${orderNo}.pdf`);
}

/**
 * Export Single Order Costing Report to CSV (proper formatted with full results and summaries)
 */
export function exportCostingCSV() {
    if (!currentOrder) {
        alert("No order selected to export.");
        return;
    }

    // Dynamic extraction: read from DOM first (ensuring un-blurred/live inputs are captured), then fallback to currentOrder
    const ioNo = currentOrder.internalOrderNo || '';
    const dateVal = document.getElementById('cr-edit-date')?.value || currentOrder.date || '';
    const drawingVal = document.getElementById('cr-edit-drawing')?.value || currentOrder.drawingNo || currentOrder.itemCode || '-';
    const statusVal = document.getElementById('cr-edit-status')?.value || currentOrder.status || 'Pending';
    const customerVal = document.getElementById('cr-edit-customer')?.value || currentOrder.customer || '-';
    const descVal = document.getElementById('cr-edit-description')?.value || currentOrder.description || '-';
    const budgetVal = parseFloat(document.getElementById('cr-edit-budget')?.value) || parseFloat(currentOrder.budget) || 0;
    const qtyVal = parseFloat(document.getElementById('cr-edit-qty')?.value) || parseFloat(currentOrder.qty) || 1;
    const poNoVal = document.getElementById('cr-edit-pono')?.value || currentOrder.poNo || '-';
    const poValRaw = parseFloat(document.getElementById('cr-edit-povalue')?.value);
    const poVal = !isNaN(poValRaw) ? poValRaw : getOrderSaleValue(currentOrder);
    const startDateVal = document.getElementById('cr-edit-startdate')?.value || currentOrder.startDate || currentOrder.date || '-';
    const delDateVal = document.getElementById('cr-edit-deliverydate')?.value || currentOrder.deliveryDateActual || currentOrder.delDate || '-';
    const dcNoVal = document.getElementById('cr-edit-dcno')?.value || currentOrder.dcNo || '-';

    // Compute category totals
    const catTotals = {
        'Raw Material': 0,
        'Direct Labour': 0,
        'Machine Cost': 0,
        'Subcontract': 0,
        'Logistics': 0,
        'Overhead': 0
    };
    let totalExpensesSum = 0;
    currentExpenses.forEach(exp => {
        const cat = exp.category || 'Overhead';
        const amt = parseFloat(exp.amount) || ((parseFloat(exp.qty) || 0) * (parseFloat(exp.rate) || 0));
        if (catTotals[cat] !== undefined) catTotals[cat] += amt;
        else catTotals[cat] = (catTotals[cat] || 0) + amt;
        totalExpensesSum += amt;
    });

    const profit = poVal - totalExpensesSum;
    const profitMarginPct = poVal > 0 ? ((profit / poVal) * 100).toFixed(2) + '%' : '0.00%';
    const profitStatus = profit >= 0 ? 'PROFIT' : 'LOSS';

    const escapeCSV = (str) => {
        if (str === null || str === undefined) return '""';
        const s = String(str).replace(/"/g, '""');
        return `"${s}"`;
    };

    let csv = '';
    // Section 1: Title Header
    csv += `INNOVATIVE ENGINEERING SOLUTIONS\r\n`;
    csv += `COSTING REPORT - CR -${ioNo}\r\n`;
    csv += `Export Date,${new Date().toLocaleDateString('en-GB')}\r\n\r\n`;

    // Section 2: Order Information
    csv += `ORDER INFORMATION\r\n`;
    csv += `Field,Value\r\n`;
    csv += `Internal Order No,${escapeCSV(ioNo)}\r\n`;
    csv += `WO Date,${escapeCSV(formatDate(dateVal))}\r\n`;
    csv += `Customer,${escapeCSV(customerVal)}\r\n`;
    csv += `Part / Description,${escapeCSV(descVal)}\r\n`;
    csv += `Drawing No,${escapeCSV(drawingVal)}\r\n`;
    csv += `Quantity,${qtyVal}\r\n`;
    csv += `PO No,${escapeCSV(poNoVal)}\r\n`;
    csv += `PO / Sales Value (INR),${poVal.toFixed(2)}\r\n`;
    csv += `Budget (INR),${budgetVal.toFixed(2)}\r\n`;
    csv += `Status,${escapeCSV(statusVal)}\r\n`;
    csv += `Start Date,${escapeCSV(formatDate(startDateVal))}\r\n`;
    csv += `Delivery Date,${escapeCSV(formatDate(delDateVal))}\r\n`;
    csv += `DC No,${escapeCSV(dcNoVal)}\r\n\r\n`;

    // Section 3: Key Financial Results
    csv += `FINANCIAL RESULTS & PROFIT / LOSS SUMMARY\r\n`;
    csv += `Particular,Amount (INR),Notes\r\n`;
    csv += `Total Sales / PO Value,${poVal.toFixed(2)},Contracted / Invoiced Value\r\n`;
    csv += `Total Production Expenses,${totalExpensesSum.toFixed(2)},Sum of all recorded costs\r\n`;
    csv += `Net Profit / Loss,${profit.toFixed(2)},${profitStatus}\r\n`;
    csv += `Profit Margin (%),${profitMarginPct},Margin on Sales\r\n\r\n`;

    // Section 4: Expense Breakdown by Category
    csv += `EXPENSE BREAKDOWN BY CATEGORY\r\n`;
    csv += `Category,Total Amount (INR),Share of Expenses (%)\r\n`;
    Object.keys(catTotals).forEach(cat => {
        const amt = catTotals[cat];
        const share = totalExpensesSum > 0 ? ((amt / totalExpensesSum) * 100).toFixed(1) + '%' : '0.0%';
        csv += `${escapeCSV(cat)},${amt.toFixed(2)},${share}\r\n`;
    });
    csv += `TOTAL EXPENSES,${totalExpensesSum.toFixed(2)},100.0%\r\n\r\n`;

    // Section 5: Detailed Expense List
    csv += `DETAILED EXPENSE LINE ITEMS\r\n`;
    csv += `S.No,Date,Category,Description,Supplier / Employee,Qty / Day,UOM,Rate (INR),Amount (INR),Remarks\r\n`;
    if (currentExpenses.length === 0) {
        csv += `-,No expenses logged yet,-,-,-,-,0.00,0.00,-\r\n`;
    } else {
        currentExpenses.forEach((exp, idx) => {
            const qty = parseFloat(exp.qty) || 0;
            const rate = parseFloat(exp.rate) || 0;
            const amt = parseFloat(exp.amount) !== undefined ? parseFloat(exp.amount) : (qty * rate);
            csv += `${idx + 1},${escapeCSV(formatDate(exp.date))},${escapeCSV(exp.category || '')},${escapeCSV(exp.description || '')},${escapeCSV(exp.supplierEmployee || '')},${qty},${escapeCSV(exp.uom || '')},${rate.toFixed(2)},${amt.toFixed(2)},${escapeCSV(exp.remarks || '')}\r\n`;
        });
    }
    csv += `TOTAL,,,,,,,,${totalExpensesSum.toFixed(2)},\r\n`;

    // Create Blob with UTF-8 BOM so Excel opens it with full formatting & correct characters
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Costing_Report_${currentOrder.internalOrderNo || 'IO'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showCostingToast('CSV Downloaded ✓');
}

/**
 * Export All Orders Costing Summary to CSV
 */
export function exportAllOrdersCostingCSV() {
    const allOrders = window.adminApp?.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    let activeOrders = getSanitizedInternalOrders(allOrders);
    if (monthFilter) {
        activeOrders = activeOrders.filter(o => getOrderMonth(o) === monthFilter);
    }
    
    let csv = 'INNOVATIVE ENGINEERING SOLUTIONS\r\n';
    csv += `COSTING SUMMARY - ALL INTERNAL ORDERS${monthFilter ? ` (${monthFilter})` : ''}\r\n`;
    csv += `Export Date,${new Date().toLocaleDateString('en-GB')}\r\n\r\n`;
    csv += 'S.No,Internal Order No,WO Date,Customer,Part / Project,Quantity,Status,PO Value (INR),Total Expenses (INR),Net Profit / Loss (INR),Margin %,Costing Status\r\n';

    let totalPOSum = 0;
    let totalExpSum = 0;

    activeOrders.forEach((order, idx) => {
        const poVal = getOrderSaleValue(order);
        const expenses = allExpenses.filter(e => e.orderId === order.id || e.internalOrderNo === order.internalOrderNo);
        const totalExp = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const profit = poVal - totalExp;
        const marginPct = poVal > 0 ? ((profit / poVal) * 100).toFixed(1) + '%' : '0.0%';
        const status = expenses.length > 0 ? `Filled (${expenses.length} items)` : 'Empty';

        totalPOSum += poVal;
        totalExpSum += totalExp;

        const escapeCSV = (str) => `"${String(str || '').replace(/"/g, '""')}"`;

        csv += `${idx + 1},${escapeCSV(order.internalOrderNo)},${escapeCSV(formatDate(order.date))},${escapeCSV(order.customer)},${escapeCSV(order.description)},${order.qty || 1},${escapeCSV(order.status || 'Pending')},${poVal.toFixed(2)},${totalExp.toFixed(2)},${profit.toFixed(2)},${escapeCSV(marginPct)},${escapeCSV(status)}\r\n`;
    });

    const netProfitSum = totalPOSum - totalExpSum;
    const overallMargin = totalPOSum > 0 ? ((netProfitSum / totalPOSum) * 100).toFixed(1) + '%' : '0.0%';
    csv += `TOTALS,,,,,,${totalPOSum.toFixed(2)},${totalExpSum.toFixed(2)},${netProfitSum.toFixed(2)},"${overallMargin}",\r\n`;

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Costing_Summary_All_Orders.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showCostingToast('Summary CSV Downloaded ✓');
}
