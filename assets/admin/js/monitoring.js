import * as DB from './db.js';


// Persistent Date Logic
const today = new Date();
const currentMonthStr = today.toISOString().slice(0, 7);

let isTrashMode = false;
// Default to EMPTY (Show All) instead of current month to ensure historical data is visible
let filterMonthFrom = localStorage.getItem('filterMonthFrom') || '';
let filterMonthTo = localStorage.getItem('filterMonthTo') || '';
let searchTerm = '';
let currentPage = 1;
let itemsPerPage = 5000; // Very high default for infinite scroll feel
let sortConfig = { key: 'internalOrderNo', direction: 'desc' };

export const setTrashMode = (startTrash) => {
    isTrashMode = startTrash;
    currentPage = 1; // Reset to first page

    // Toggle Empty Trash button visibility
    const emptyBtn = document.getElementById('empty-trash-btn');
    if (emptyBtn) {
        if (isTrashMode) emptyBtn.classList.remove('hidden');
        else emptyBtn.classList.add('hidden');
    }

    updateTitle();
};

export const setFilters = (monthFrom, monthTo, search) => {
    if (monthFrom !== undefined) {
        filterMonthFrom = monthFrom;
        localStorage.setItem('filterMonthFrom', monthFrom);
    }
    if (monthTo !== undefined) {
        filterMonthTo = monthTo;
        localStorage.setItem('filterMonthTo', monthTo);
    }
    if (search !== undefined) searchTerm = search.toLowerCase();
    currentPage = 1; // Reset to first page
    updateTitle();
};

export const getFilters = () => {
    return {
        monthFrom: filterMonthFrom,
        monthTo: filterMonthTo,
        search: searchTerm
    };
};

export const setPageSize = (size) => {
    itemsPerPage = parseInt(size) || 10;
    currentPage = 1; // Reset to first page when size changes
    window.adminApp.renderMonitoring();
};

export const sort = (key) => {
    if (sortConfig.key === key) {
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortConfig.key = key;
        sortConfig.direction = 'asc';
    }
    window.adminApp.renderMonitoring(); // Fixed: Use direct call to render current data
};

const updateTitle = () => {
    const title = document.getElementById('page-title');
    if (title) title.textContent = isTrashMode ? 'Trash (Deleted Orders)' : 'Internal Orders';
};

const formatDate = (dateStr) => {
    if (!dateStr || dateStr === '-') return '-';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`; // Convert YYYY-MM-DD to DD/MM/YYYY
};

export const renderTable = (orders) => {
    const tbody = document.getElementById('monitoring-table-body');
    const paginationControls = document.getElementById('pagination-controls');
    const paginationInfo = document.getElementById('pagination-info');
    if (!tbody) return;

    tbody.innerHTML = '';
    updateTitle();

    // 1. Filter Logic
    let processedOrders = orders.filter(order => {
        let matchesMonth = true;
        if (order.date && !isTrashMode) {
            const orderMonth = order.date.slice(0, 7);
            // Default to matching single month if range invalid, or check range
            if (filterMonthFrom && filterMonthTo) {
                matchesMonth = orderMonth >= filterMonthFrom && orderMonth <= filterMonthTo;
            } else if (filterMonthFrom) {
                matchesMonth = orderMonth >= filterMonthFrom;
            } else if (filterMonthTo) {
                matchesMonth = orderMonth <= filterMonthTo;
            }
        }

        let matchesSearch = true;
        if (searchTerm) {
            const searchStr = `${order.internalOrderNo} ${order.customer} ${order.description} ${order.itemCode} ${order.poNo}`.toLowerCase();
            matchesSearch = searchStr.includes(searchTerm);
        }

        return matchesMonth && matchesSearch;
    });

    // Filter out Direct Delivery Report entries (keep production orders)
    processedOrders = processedOrders.filter(o => o.entryType !== 'delivery_report');


    // 2. Sorting Logic
    if (sortConfig.key) {
        processedOrders.sort((a, b) => {
            let valA = a[sortConfig.key] || '';
            let valB = b[sortConfig.key] || '';

            // Numeric comparison for total/value
            if (sortConfig.key === 'total' || sortConfig.key === 'value' || sortConfig.key === 'qty') {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            } else {
                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
            }

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

        // Update header classes for sort indicators
        document.querySelectorAll('th.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            // Support both direct key comparison and multi-line headers
            const onclick = th.getAttribute('onclick') || '';
            if (onclick.includes(`'${sortConfig.key}'`)) {
                th.classList.add(sortConfig.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    // 3. Pagination Logic
    const totalItems = processedOrders.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;

    const startIdx = (currentPage - 1) * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const paginatedOrders = processedOrders.slice(startIdx, endIdx);

    if (totalItems === 0) {
        tbody.innerHTML = '<tr><td colspan="23" style="padding: 3rem; text-align: center; color: #64748b;">No orders found matching filters.</td></tr>';
        if (paginationInfo) paginationInfo.textContent = 'Showing 0 to 0 of 0 entries';
        if (paginationControls) paginationControls.innerHTML = '';
        return;
    }

    // Render Rows
    paginatedOrders.forEach((order, index) => {
        const tr = document.createElement('tr');
        let status = order.status ? order.status.toUpperCase() : '';

        if (!isTrashMode) {
            if (status === 'DELIVERED') tr.className = 'row-delivered';
            else if (status === 'PENDING') tr.className = 'row-pending';
        } else {
            tr.className = 'row-deleted';
        }

        const t = (val) => val || '-';

        let statusHtml = '';
        if (isTrashMode) {
            let badgeClass = 'badge-default';
            if (status === 'DELIVERED') badgeClass = 'badge-success';
            else if (status === 'PENDING') badgeClass = 'badge-warning';
            statusHtml = `<span class="badge ${badgeClass}">${status || '-'}</span>`;
        } else {
            const statusVal = order.status || 'Pending';
            const badgeClass = statusVal === 'Delivered' ? 'status-delivered' : 'status-pending';
            statusHtml = `<span class="status-badge ${badgeClass}">${statusVal}</span>`;
        }

        let actionsHtml = '';
        if (isTrashMode) {
            actionsHtml = `
                <div class="action-btns">
                    <button class="action-btn restore" onclick="window.adminApp.restoreOrder('${order.id}')" title="Restore">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    </button>
                    <button class="action-btn delete" onclick="window.adminApp.permanentDeleteOrder('${order.id}')" title="Delete Permanently">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>`;
        } else {
            actionsHtml = `
                <div class="action-btns">
                    <button class="action-btn edit" onclick="window.adminApp.editOrder('${order.id}')" title="Edit">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </button>
                    <button class="action-btn delete" onclick="window.adminApp.softDeleteOrder('${order.id}')" title="Move to Trash">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>`;
        }

        const avail = (val) => val === 'y' ? '<span class="text-brand-600 font-bold">Y</span>' : '-';

        tr.innerHTML = `
            <td>${startIdx + index + 1}</td>
            <td class="font-medium">${t(order.internalOrderNo)}</td>
            <td>${formatDate(order.date)}</td>
            <td>${t(order.itemCode)}</td>
            <td>${t(order.drawingNo)}</td>
            <td class="truncate" style="max-width: 150px;" title="${t(order.description)}">${t(order.description)}</td>
            <td class="text-right">${t(order.qty)}</td>
            <td>${t(order.qtyUnit)}</td>
            <td class="text-right">${t(order.saleValueEa || order.value)}</td>
            <td class="text-right">${t(order.prodValueEa)}</td>
            <td class="text-right font-bold">${t(order.total)}</td>
            
            <td>${t(order.customer)}</td>
            <td>${t(order.poNo)}</td>
            <td>${formatDate(order.poDate)}</td>
            <td class="text-center">${avail(order.drgAvail)}</td>
            <td class="text-center">${avail(order.rawAvail)}</td>
            <td class="text-center">${avail(order.finishAvail)}</td>

            <td>${formatDate(order.deliveryDateActual)}</td>
            <td>${t(order.dcNo)}</td>
            <td class="text-right">${t(order.deliveryQty)}</td>
            <td>${t(order.billNo)}</td>
            <td class="text-center">${statusHtml}</td>
            <td>${actionsHtml}</td>
        `;

        tbody.appendChild(tr);
    });

    // Render Pagination Controls (HIDDEN/REMOVED as per user request for scrollable list)
    if (paginationInfo) {
        // Just show total count
        paginationInfo.textContent = `Total Entries: ${totalItems}`;
    }

    if (paginationControls) {
        paginationControls.innerHTML = ''; // Clear pagination buttons
    }
};

export const handleAddOrder = () => {
    const form = document.getElementById('add-order-form');
    if (!form) return;

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Auto-calculate Total based on Sale Value
    if (data.qty && data.saleValueEa) {
        data.total = (parseFloat(data.qty) * parseFloat(data.saleValueEa)).toFixed(2);
    }

    // Auto-determine status from DC No
    data.status = (data.dcNo && data.dcNo.trim() !== '') ? 'Delivered' : 'Pending';

    const orderId = data.orderId;
    delete data.orderId;

    const promise = orderId ? DB.updateOrder(orderId, data) : DB.addOrder(data);

    promise.then(res => {
        if (res.error) {
            alert("Error: " + res.error);
        } else {
            window.adminApp.closeModal('add-order-modal');
            form.reset();
            const hiddenId = document.getElementById('orderId-input');
            if (hiddenId) hiddenId.value = '';
        }
    });
};

export const populateForm = (order) => {
    const form = document.getElementById('add-order-form');
    if (!form) return;

    const hiddenId = document.getElementById('orderId-input');
    if (hiddenId) hiddenId.value = order.id;

    Array.from(form.elements).forEach(el => {
        if (!el.name) return;

        if (el.type === 'checkbox') {
            el.checked = order[el.name] === 'y';
        } else if (order[el.name] !== undefined) {
            el.value = order[el.name];
        }
    });

    // Update the visible status display based on DC No
    const statusDisplay = document.getElementById('order-status-display');
    const statusHidden = form.querySelector('[name="status"]');
    const hasDC = order.dcNo && order.dcNo.trim() !== '';
    if (statusDisplay) statusDisplay.value = hasDC ? '🟢 Delivered' : '🟡 Pending';
    if (statusHidden) statusHidden.value = hasDC ? 'Delivered' : 'Pending';

    window.adminApp.openAddOrderModal();
};

/**
 * Export orders for the current month to Excel (XLSX format)
 * Uses SheetJS library loaded via CDN
 * @param {Array} allOrders - All orders from app state
 * Export orders for the current month to PDF
 * Uses jsPDF and jspdf-autotable loaded via CDN
 */
/**
 * Export orders for the current VIEW to PDF
 * Uses jsPDF and jspdf-autotable
 */
export const exportToPDF = () => {
    // 1. Get currently filtered orders (State Awareness)
    // We need to re-apply the current filters to get the exact list user is seeing
    const allOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];

    // Re-run filter logic to match UI
    let exportOrders = allOrders.filter(order => {
        let matchesMonth = true;
        if (order.date && !isTrashMode) {
            const orderMonth = order.date.slice(0, 7);
            if (filterMonthFrom && filterMonthTo) {
                matchesMonth = orderMonth >= filterMonthFrom && orderMonth <= filterMonthTo;
            } else if (filterMonthFrom) {
                matchesMonth = orderMonth >= filterMonthFrom;
            } else if (filterMonthTo) {
                matchesMonth = orderMonth <= filterMonthTo;
            }
        }
        let matchesSearch = true;
        if (searchTerm) {
            const searchStr = `${order.internalOrderNo} ${order.customer} ${order.description} ${order.itemCode} ${order.poNo}`.toLowerCase();
            matchesSearch = searchStr.includes(searchTerm);
        }
        return matchesMonth && matchesSearch && order.entryType !== 'delivery_report';
    });

    if (!exportOrders || exportOrders.length === 0) {
        alert('No orders found in current view to export.');
        return;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l', 'mm', 'a4'); // Landscape

        // Sort by Date (Descending default)
        exportOrders.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Header
        doc.setFontSize(18);
        doc.setTextColor(20, 184, 166); // Teal
        doc.text('INTERNAL ORDERS REPORT', 14, 15);

        doc.setFontSize(10);
        doc.setTextColor(100);
        let periodStr = filterMonthFrom;
        if (filterMonthFrom !== filterMonthTo) periodStr += ` to ${filterMonthTo}`;
        doc.text(`Period: ${periodStr}`, 14, 22);
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 27);

        // 21-Column Mapping (Matching UI)
        const headers = [
            [
                { content: '#', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
                { content: 'Internal Order', colSpan: 2, styles: { halign: 'center' } },
                { content: 'Item Details', colSpan: 3, styles: { halign: 'center' } },
                { content: 'Pricing & Production', colSpan: 5, styles: { halign: 'center' } },
                { content: 'Customer Data', colSpan: 6, styles: { halign: 'center' } },
                { content: 'Delivery Actual', colSpan: 5, styles: { halign: 'center' } },
                { content: 'Status', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } }
            ],
            [
                'IO No', 'Date', 'Code', 'Drg No', 'Description',
                'Qty', 'Unit', 'Sale', 'Prod', 'Total',
                'Customer', 'PO No', 'PO Date', 'Drg', 'Raw', 'Fin',
                'Del Date', 'DC No', 'Del Qty', 'Bill No', 'Stat'
            ]
        ];

        const rows = exportOrders.map((o, index) => [
            index + 1,
            o.internalOrderNo || '-',
            formatDate(o.date),
            o.itemCode || '-',
            o.drawingNo || '-',
            o.description || '-',
            o.qty || 0,
            o.qtyUnit || '-',
            o.saleValueEa || o.value || 0,
            o.prodValueEa || 0,
            o.total || 0,
            o.customer || '-',
            o.poNo || '-',
            formatDate(o.poDate),
            o.drgAvail === 'y' ? 'Y' : '-',
            o.rawAvail === 'y' ? 'Y' : '-',
            o.finishAvail === 'y' ? 'Y' : '-',
            formatDate(o.deliveryDateActual),
            o.dcNo || '-',
            o.deliveryQty || 0,
            o.billNo || '-',
            o.status || 'Pending'
        ]);

        doc.autoTable({
            head: headers,
            body: rows,
            startY: 32,
            theme: 'grid',
            headStyles: { fillColor: [20, 184, 166], textColor: 255, fontSize: 7, valign: 'middle', halign: 'center' },
            bodyStyles: { fontSize: 6, cellPadding: 1, valign: 'middle' },
            columnStyles: {
                0: { cellWidth: 7 },  // #
                1: { cellWidth: 16 }, // IO No
                2: { cellWidth: 13 }, // Date
                3: { cellWidth: 12 }, // Code
                4: { cellWidth: 12 }, // Drg No
                5: { cellWidth: 22 }, // Desc
                6: { cellWidth: 7 },  // Qty
                7: { cellWidth: 8 },  // Unit
                8: { cellWidth: 10 }, // Sale
                9: { cellWidth: 10 }, // Prod
                10: { cellWidth: 12 }, // Total
                11: { cellWidth: 16 }, // Cust
                12: { cellWidth: 12 }, // PO
                13: { cellWidth: 13 }, // PO Date
                14: { cellWidth: 6 },  // Drg
                15: { cellWidth: 6 },  // Raw
                16: { cellWidth: 6 },  // Fin
                17: { cellWidth: 13 }, // Del Date
                18: { cellWidth: 9 },  // DC
                19: { cellWidth: 7 },  // Del Qty
                20: { cellWidth: 9 },  // Bill
                21: { cellWidth: 14 }  // Status
            },
            didParseCell: (data) => {
                // Color coding for status
                if (data.section === 'body' && data.column.index === 21) {
                    const status = data.cell.raw;
                    if (status === 'Delivered') data.cell.styles.textColor = [22, 163, 74];
                    else if (status === 'Pending') data.cell.styles.textColor = [202, 138, 4];
                }
            }
        });

        window.open(doc.output('bloburl'), '_blank');

    } catch (error) {
        console.error('PDF Export failed:', error);
        alert('Failed to generate PDF. See console.');
    }
};

// === DELVIERY REPORT LOGIC ===


// Local Delivery Trash State
let isDeliveryTrashMode = false;

export const setDeliveryTrashMode = (mode) => {
    isDeliveryTrashMode = mode;
};

export const renderDeliveryReport = async (weekValue) => {
    // weekValue format: "2024-W05"
    if (!weekValue) return;

    const [year, week] = weekValue.split('-W');
    const simpleWeek = parseInt(week, 10);

    // Calculate date range for the selected week
    const jan1 = new Date(year, 0, 1);
    const dayOffset = jan1.getDay() <= 4 ? jan1.getDay() - 1 : jan1.getDay() - 8;
    const startOfWeek = new Date(year, 0, 1 + (simpleWeek - 1) * 7 - dayOffset);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    // Update range display
    const rangeEl = document.getElementById('delivery-week-range');
    if (rangeEl) {
        const options = { month: 'short', day: '2-digit' };
        rangeEl.textContent = `${startOfWeek.toLocaleDateString('en-IN', options)} - ${endOfWeek.toLocaleDateString('en-IN', options)}`;
        rangeEl.classList.remove('hidden');
    }

    const tbody = document.getElementById('delivery-report-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="16" class="text-center py-8">Loading report data...</td></tr>';

    // Fetch Daily Stats
    const startDateStr = startOfWeek.toISOString().slice(0, 10);
    const endDateStr = endOfWeek.toISOString().slice(0, 10);

    let dailyStats = {};
    try {
        dailyStats = await DB.getDailyStats(startDateStr, endDateStr);
    } catch (e) {
        console.error("Failed to load daily stats", e);
    }

    // Normalize start/end times
    startOfWeek.setHours(0, 0, 0, 0);
    endOfWeek.setHours(23, 59, 59, 999);

    // Filter Delivered Orders
    let orders = [];

    if (isDeliveryTrashMode) {
        try {
            orders = await DB.getTrashOrders();
        } catch (e) {
            console.error("Error fetching trash", e);
            orders = [];
        }
    } else {
        orders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    }

    console.log("Render Delivery Report:", { weekValue, mode: isDeliveryTrashMode ? 'Trash' : 'Active', totalOrders: orders.length });
    console.log("Week Range:", { start: startOfWeek.toString(), end: endOfWeek.toString() });

    const reportOrders = orders.filter(o => {
        // Strict separation: ONLY show explicitly tagged delivery reports
        if (o.entryType !== 'delivery_report') return false;

        if (o.status !== 'Delivered') return false;

        if (!o.deliveryDateActual || typeof o.deliveryDateActual !== 'string' || !o.deliveryDateActual.includes('-')) {
            if (o.entryType === 'delivery_report') console.warn("Invalid Date for Entry:", o);
            return false;
        }

        // If necessary, we can just parse the string manually to be safe:
        const [y, m, d] = o.deliveryDateActual.split('-').map(Number);
        const localOrderDate = new Date(y, m - 1, d);
        localOrderDate.setHours(0, 0, 0, 0);

        const inRange = localOrderDate >= startOfWeek && localOrderDate <= endOfWeek;

        if (o.entryType === 'delivery_report') {
            console.log("Checking Entry:", {
                id: o.id,
                dateStr: o.deliveryDateActual,
                localDate: localOrderDate.toString(),
                inRange
            });
        }

        return inRange;
    });

    // Sort by Date
    reportOrders.sort((a, b) => new Date(a.deliveryDateActual) - new Date(b.deliveryDateActual));

    // Group by Date
    const grouped = {};
    reportOrders.forEach(o => {
        const d = o.deliveryDateActual;
        if (!grouped[d]) grouped[d] = [];
        grouped[d].push(o);
    });

    // Calculate Summary Stats
    let totalItems = reportOrders.length;
    let totalValue = reportOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
    let totalLabour = reportOrders.reduce((sum, o) => sum + (parseFloat(o.labourCost) || 0), 0);
    let totalManpower = reportOrders.reduce((sum, o) => sum + (parseFloat(o.manpower) || 0), 0);

    // Update Stats UI
    const totalItemsEl = document.getElementById('report-total-items');
    if (totalItemsEl) totalItemsEl.textContent = totalItems;

    const totalValueEl = document.getElementById('report-total-value');
    if (totalValueEl) totalValueEl.textContent = '₹' + totalValue.toLocaleString('en-IN');

    const totalLabourEl = document.getElementById('report-total-labour');
    if (totalLabourEl) totalLabourEl.textContent = '₹' + totalLabour.toLocaleString('en-IN');

    const totalManpowerEl = document.getElementById('report-total-manpower');
    if (totalManpowerEl) totalManpowerEl.textContent = '₹' + totalManpower.toLocaleString('en-IN');

    // Render Groups
    tbody.innerHTML = '';
    let groupSerialNo = 1;
    const sortedDates = Object.keys(grouped).sort();

    for (const date of sortedDates) {
        const groupOrders = grouped[date];
        const dailyValue = groupOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
        const dailyManpower = groupOrders.reduce((sum, o) => sum + (parseFloat(o.manpower) || 0), 0);

        groupOrders.forEach((order, index) => {
            const tr = document.createElement('tr');
            const isFirst = index === 0;
            const isLast = index === groupOrders.length - 1;

            const displayDailyValue = isLast ? '₹' + dailyValue.toLocaleString('en-IN') : '';
            const displayDailyManpower = isLast ? '₹' + dailyManpower.toLocaleString('en-IN') : '';
            const dailyClass = isLast ? "font-bold text-slate-800 bg-slate-50/50" : "";

            tr.innerHTML = `
                <td class="px-4 py-2 text-center text-slate-500">${isFirst ? groupSerialNo : ''}</td>
                <td class="px-4 py-2 font-medium">${isFirst ? formatDate(date) : ''}</td> 
                <td class="px-4 py-2 font-medium" style="color: var(--brand-600);">${order.internalOrderNo || '-'}</td>
                <td class="px-4 py-2">${order.customer || '-'}</td>
                <td class="px-4 py-2">${order.description || '-'}</td>
                <td class="px-4 py-2 font-medium">${order.itemCode || '-'}</td>
                <td class="px-4 py-2" style="white-space: nowrap;">${order.drawingNo || '-'}</td>
                <td class="px-4 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs font-semibold bg-slate-100 text-slate-600">${order.department || '-'}</span>
                </td>
                <td class="px-4 py-2 text-center">${order.dcNo || '-'}</td> 
                <td class="px-4 py-2 text-right font-bold">${order.deliveryQty || order.qty || 0}</td>
                <td class="px-4 py-2">${order.qtyUnit || '-'}</td>
                <td class="px-4 py-2 text-right">₹${(parseFloat(order.total) || 0).toLocaleString('en-IN')}</td>
                <td class="px-4 py-2 text-right text-slate-500">₹${(parseFloat(order.labourCost) || 0).toLocaleString('en-IN')}</td>
                <td class="px-4 py-2 text-right ${dailyClass}">${displayDailyValue}</td>
                <td class="px-4 py-2 text-right ${dailyClass}">${displayDailyManpower}</td>
                <td class="px-4 py-2 text-center no-print">
                    ${!isDeliveryTrashMode ? `
                    <button class="text-slate-400 hover:text-blue-500 transition-colors mr-2"
                        onclick="window.adminApp.editOrder('${order.id}')" title="Edit Item">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    <button class="text-slate-400 hover:text-red-500 transition-colors"
                        onclick="window.adminApp.softDeleteOrder('${order.id}')" title="Move to Trash">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                    ` : `
                    <button class="text-emerald-400 hover:text-emerald-600 transition-colors mr-2"
                        onclick="window.adminApp.restoreOrder('${order.id}')" title="Restore">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                        </svg>
                    </button>
                    <button class="text-red-400 hover:text-red-600 transition-colors"
                        onclick="window.adminApp.permanentDeleteOrder('${order.id}')" title="Delete Permanently">
                         <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                    `}
                </td>
            `;
            tbody.appendChild(tr);
        });
        groupSerialNo++;
    }

    if (reportOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="16" class="px-4 py-8 text-center text-slate-400">No delivered orders found for this week.</td></tr>`;
    }
};
