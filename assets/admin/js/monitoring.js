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
            const searchStr = `${order.internalOrderNo} ${order.customer} ${order.description} ${order.poNo} ${order.drawingNo || ''}`.toLowerCase();
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

    // Map delivery reports by IO No and by DC No for resolving delivery date, DC & Bill
    const deliveryReportsByIo = new Map();
    const deliveryReportsByDc = new Map();
    orders.filter(o => o.entryType === 'delivery_report' && !o.isDeleted).forEach(d => {
        const date = d.deliveryDateActual || d.date || '';
        const io = (d.internalOrderNo || '').trim().toUpperCase();
        const dc = (d.dcNo || '').trim();
        const bill = (d.billNo || '').trim();
        if (io) {
            if (!deliveryReportsByIo.has(io)) {
                deliveryReportsByIo.set(io, { dates: [], dcs: [], bills: [] });
            }
            const entry = deliveryReportsByIo.get(io);
            if (date && !entry.dates.includes(date)) entry.dates.push(date);
            if (dc && !entry.dcs.includes(dc)) entry.dcs.push(dc);
            if (bill && !entry.bills.includes(bill)) entry.bills.push(bill);
        }
        if (dc && date && !deliveryReportsByDc.has(dc)) deliveryReportsByDc.set(dc, date);
    });

    // Render Rows
    paginatedOrders.forEach((order, index) => {
        const tr = document.createElement('tr');
        let status = order.status ? order.status.toUpperCase() : '';

        // Resolve delivery date, DC, and Bill from delivery reports if missing or pooled
        let effectiveDelDate = order.deliveryDateActual;
        let effectiveDcNo = order.dcNo;
        let effectiveBillNo = order.billNo;

        if (!effectiveDelDate && effectiveDcNo && deliveryReportsByDc.has(effectiveDcNo.trim())) {
            effectiveDelDate = deliveryReportsByDc.get(effectiveDcNo.trim());
        }
        if (order.internalOrderNo && deliveryReportsByIo.has(order.internalOrderNo.trim().toUpperCase())) {
            const match = deliveryReportsByIo.get(order.internalOrderNo.trim().toUpperCase());
            if (!effectiveDelDate && match.dates.length > 0) effectiveDelDate = match.dates[match.dates.length - 1];
            if (!effectiveDcNo && match.dcs.length > 0) effectiveDcNo = match.dcs.join(', ');
            if (!effectiveBillNo && match.bills.length > 0) effectiveBillNo = match.bills.join(', ');
        }

        if (!isTrashMode) {
            if (status === 'DELIVERED') tr.className = 'row-delivered';
            else if (status === 'PARTIALLY DELIVERED' || status === 'PORTION DELIVERED') tr.className = 'row-portion';
            else if (status === 'PENDING') tr.className = 'row-pending';
            else if (status === 'CLOSED BY ADMIN') tr.className = 'row-closed';
        } else {
            tr.className = 'row-deleted';
        }

        const t = (val) => val || '-';

        let statusHtml = '';
        const isFC = order.forceClosed === true;
        const fcText = isFC ? ' (FC)' : '';
        const forceCloseNote = order.forceCloseComment ? `\nComment: ${order.forceCloseComment.replace(/"/g, '&quot;')}` : (isFC ? '\nClick to add FC comment' : '');
        const onClickHtml = isFC ? `onclick="window.adminApp.editFCComment('${order.id}')" style="cursor: pointer;"` : '';

        if (isTrashMode) {
            let badgeClass = 'badge-default';
            if (status === 'DELIVERED') badgeClass = 'badge-success';
            else if (status === 'PENDING') badgeClass = 'badge-warning';
            statusHtml = `<span class="badge ${badgeClass}" ${onClickHtml} title="Status: ${status || '-'}${forceCloseNote}">${status || '-'}${fcText}</span>`;
        } else {
            const statusVal = order.status || 'Pending';
            let badgeClass = 'status-pending';
            if (statusVal === 'Delivered') badgeClass = 'status-delivered';
            else if (statusVal === 'Partially Delivered' || statusVal === 'Portion Delivered') badgeClass = 'status-portion';
            else if (statusVal === 'Closed by Admin') badgeClass = 'status-closed';
            statusHtml = `<span class="status-badge ${badgeClass}" ${onClickHtml} title="Status: ${statusVal}${forceCloseNote}">${statusVal}${fcText}</span>`;
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
                    <button class="action-btn force-close" onclick="window.adminApp.forceCloseOrder('${order.id}')" title="Force Close">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    </button>
                    <button class="action-btn delete" onclick="window.adminApp.softDeleteOrder('${order.id}')" title="Move to Trash">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>`;
        }

        const avail = (val) => val === 'y' ? '<span class="text-brand-600 font-bold">Y</span>' : '-';

        tr.innerHTML = `
            <td>${startIdx + index + 1}</td>
            <td class="font-medium" style="white-space: nowrap;">
                ${order.internalOrderNo ? `<a href="#" onclick="event.preventDefault(); window.adminApp.wfOpenProject('${order.internalOrderNo}')" style="color: #0d9488; text-decoration: underline;" title="Open Project">${order.internalOrderNo}</a>` : '-'}
            </td>
            <td>${formatDate(order.date)}</td>
            <td>${t(order.drawingNo)}</td>
            <td class="truncate" style="max-width: 150px;" title="${t(order.description)}">${t(order.description)}</td>
            <td class="text-right">${t(order.qty)}</td>
            <td>${t(order.qtyUnit)}</td>
            <td class="text-right">${t(order.saleValueEa || order.value)}</td>
            <td class="text-right">${t(order.prodValueEa)}</td>
            <td class="text-right">${t(order.outsourceValue)}</td>
            <td class="text-center">${avail(order.isLaborJob)}</td>
            <td class="text-right font-bold">${t(order.total)}</td>
            
            <td>${t(order.customer)}</td>
            <td>${t(order.poNo)}</td>
            <td>${formatDate(order.poDate)}</td>
            <td class="text-center">${avail(order.drgAvail)}</td>
            <td class="text-center">${avail(order.rawAvail)}</td>
            <td class="text-center">${avail(order.finishAvail)}</td>

            <td>${formatDate(effectiveDelDate)}</td>
            <td class="col-dc-no" title="${t(effectiveDcNo)}">${t(effectiveDcNo)}</td>
            <td class="text-right">${t(order.deliveryQty)}</td>
            <td class="col-bill-no" title="${t(effectiveBillNo)}">${t(effectiveBillNo)}</td>
            <td class="text-center">${statusHtml}</td>
            <td>${actionsHtml}</td>
        `;

        // Add Double-Click to Edit
        tr.style.cursor = 'pointer';
        tr.addEventListener('dblclick', () => {
            if (!isTrashMode) {
                window.adminApp.editOrder(order.id);
            }
        });

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

export const handleAddOrder = async () => {
    const form = document.getElementById('add-order-form');
    if (!form) return;

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Auto-calculate Total based on Sale Value
    if (data.qty) {
        const qty = parseFloat(data.qty) || 0;
        if (data.saleValueEa) data.total = (qty * parseFloat(data.saleValueEa)).toFixed(2);
        if (data.prodValueEa) data.prodValueTotal = (qty * parseFloat(data.prodValueEa)).toFixed(2);
        if (data.outsourceValue) data.outsourceValueTotal = (qty * parseFloat(data.outsourceValue)).toFixed(2);
    }

    // Auto-determine status from DC No and Qty
    // If updating an existing order, we must calculate the TOTAL delivered across all DCs.
    const orderedQty = parseFloat(data.qty) || 0;

    const orderId = data.orderId;
    delete data.orderId;

    if (orderId) {
        // Find existing delivery records for this IO
        const allOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
        const existingDeliveries = allOrders.filter(o =>
            o.entryType === 'delivery_report' &&
            o.internalOrderNo === data.internalOrderNo &&
            !o.deleted
        );

        const totalDelivered = existingDeliveries.reduce((sum, d) => sum + (parseFloat(d.deliveryQty) || 0), 0);

        if (totalDelivered >= orderedQty && orderedQty > 0) {
            data.status = 'Delivered';
        } else if (totalDelivered > 0) {
            data.status = 'Partially Delivered';
        } else {
            data.status = 'Pending';
        }
        
        // Ensure delivery quantity is ALWAYS recalculated from DC reports
        data.deliveryQty = totalDelivered;

        // If single linked delivery exists and billNo was updated on IO, sync to delivery
        if (existingDeliveries.length === 1 && data.billNo !== undefined) {
            const d = existingDeliveries[0];
            if (d.id && d.billNo !== data.billNo) {
                await DB.updateOrder(d.id, { billNo: data.billNo });
            }
        }
    } else {
        // For entirely new orders created here, they won't have deliveries yet.
        const dcNo = data.dcNo ? data.dcNo.trim() : '';
        if (dcNo) {
            const deliveredQty = parseFloat(data.deliveryQty) || 0;
            if (deliveredQty >= orderedQty && orderedQty > 0) {
                data.status = 'Delivered';
            } else if (deliveredQty > 0) {
                data.status = 'Partially Delivered';
            } else {
                data.status = 'Delivered';
            }
        } else {
            data.status = 'Pending';
        }
    }



    const isNewOrder = !orderId;
    const createProject = isNewOrder && document.getElementById('io-create-project')?.checked;

    try {
        const res = orderId ? await DB.updateOrder(orderId, data) : await DB.addOrder(data);

        if (res.error) {
            alert("Error: " + res.error);
            return;
        }

        // Auto-create project if checkbox is ticked (new orders only)
        if (createProject && data.description) {
            try {
                const projectData = {
                    projectId: data.internalOrderNo || '',
                    name: data.description,
                    customerName: data.customer || '',
                    jobType: data.department || 'CNC',
                    drawingSource: 'Customer Supplied',
                    expectedCompletion: data.deliveryDateActual || null,
                    internalNotes: `Auto-created from Internal Order ${data.internalOrderNo || ''}`,
                    internalOrderNo: data.internalOrderNo || '',
                    poNo: data.poNo || '',
                };

                const projRes = await DB.addProject(projectData);
                if (projRes.error) {
                    console.error('Auto-create project failed:', projRes.error);
                } else {
                    console.log(`Project auto-created: ${projRes.projectId} from IO ${data.internalOrderNo}`);
                }
            } catch (projErr) {
                console.error('Error auto-creating project:', projErr);
            }
        }

        window.adminApp.closeModal('add-order-modal');
        form.reset();
        const hiddenId = document.getElementById('orderId-input');
        if (hiddenId) hiddenId.value = '';
    } catch (err) {
        alert("Error: " + err.message);
    }
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

    // Update the visible status display based on DC No and Qty
    const statusDisplay = document.getElementById('order-status-display');
    const statusHidden = form.querySelector('[name="status"]');
    const hasDC = order.dcNo && order.dcNo.trim() !== '';
    let autoStatus = 'Pending';
    let displayHtml = '🟡 Pending';

    if (hasDC) {
        const orderedQty = parseFloat(order.qty) || 0;
        const deliveredQty = parseFloat(order.deliveryQty) || 0;
        if (deliveredQty >= orderedQty && orderedQty > 0) {
            autoStatus = 'Delivered';
            displayHtml = '🟢 Delivered';
        } else if (deliveredQty > 0) {
            autoStatus = 'Partially Delivered';
            displayHtml = '🔵 Partially Delivered';
        } else {
            autoStatus = 'Delivered';
            displayHtml = '🟢 Delivered';
        }
    }

    if (statusDisplay) statusDisplay.value = displayHtml;
    if (statusHidden) statusHidden.value = autoStatus;

    // NEW: Handle DC Breakdown for Internal Order Modal
    const breakdownBody = document.getElementById('io-delivery-breakdown-body');
    if (breakdownBody) {
        const ioNo = order.internalOrderNo;
        const allOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
        const deliveries = allOrders.filter(o =>
            o.entryType === 'delivery_report' &&
            o.internalOrderNo === ioNo &&
            !o.deleted
        );

        if (deliveries.length > 0) {
            // Sort by date descending
            deliveries.sort((a, b) => new Date(b.deliveryDateActual || b.date) - new Date(a.deliveryDateActual || a.date));

            breakdownBody.innerHTML = deliveries.map(d => `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#fbfcfd'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 10px 8px; color: #313d4f; font-weight: 500;">${d.dcNo || '-'}</td>
                    <td style="padding: 10px 8px; color: #313d4f; font-weight: 500;">${d.billNo || '-'}</td>
                    <td style="padding: 10px 8px; color: #64748b;">${formatDate(d.deliveryDateActual || d.date)}</td>
                    <td style="padding: 10px 8px; text-align: right; color: #0f172a; font-weight: 700;">${d.deliveryQty || 0}</td>
                    <td style="padding: 10px 8px; text-align: right; color: #0d9488; font-weight: 700;">₹${(parseFloat(d.total) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
            `).join('');

        } else {
            breakdownBody.innerHTML = '<tr><td colspan="5" style="padding: 1.5rem 1rem; text-align: center; color: #94a3b8; font-style: italic; font-size: 0.75rem; background: #f8fafc;">No deliveries recorded.</td></tr>';
        }

        // --- NEW: Populate Summary Stats ---
        const totalDelivered = deliveries.reduce((sum, d) => sum + (parseFloat(d.deliveryQty) || 0), 0);
        const orderedQty = parseFloat(order.qty) || 0;
        const pendingQty = Math.max(0, orderedQty - totalDelivered);

        const totalDelEl = document.getElementById('io-total-delivered');
        const pendingQtyEl = document.getElementById('io-pending-qty');
        const derivedStatusEl = document.getElementById('io-derived-status');

        if (totalDelEl) totalDelEl.textContent = totalDelivered;
        if (pendingQtyEl) pendingQtyEl.textContent = pendingQty;
        
        // Ensure hidden fields match the DC and Bill calculation
        const deliveryQtyInput = form.querySelector('[name="deliveryQty"]');
        if (deliveryQtyInput) deliveryQtyInput.value = totalDelivered;

        const dcNoInput = form.querySelector('[name="dcNo"]');
        if (dcNoInput) {
            const allDCs = [...new Set(deliveries.map(d => d.dcNo?.trim()).filter(Boolean))];
            dcNoInput.value = allDCs.join(', ') || order.dcNo || '';
        }

        const billInput = form.querySelector('[name="billNo"]');
        if (billInput) {
            const allBills = [...new Set(deliveries.map(d => d.billNo?.trim()).filter(Boolean))];
            billInput.value = allBills.join(', ') || order.billNo || '';
        }

        if (derivedStatusEl) {
            let sText = 'Pending';
            let sClass = 'status-pending';

            if (pendingQty <= 0 && orderedQty > 0) {
                sText = 'Delivered';
                sClass = 'status-delivered';
            } else if (totalDelivered > 0) {
                sText = 'Partially Delivered';
                sClass = 'status-portion';
            }

            derivedStatusEl.textContent = sText;
            derivedStatusEl.className = `status-badge ${sClass}`;
            
            const statusHiddenInput = form.querySelector('[name="status"]');
            if (statusHiddenInput) statusHiddenInput.value = sText;
        }
    }

    // Trigger calculation for all cost fields
    calculateOrderCosts();

    window.adminApp.openAddOrderModal();
};

export const setupCostCalculation = () => {
    const qtyInput = document.getElementById('order-qty');
    const saleInput = document.getElementById('order-value');
    const prodInput = document.getElementById('order-prod-unit');
    const outsourceInput = document.getElementById('order-outsource-unit');

    if (!qtyInput) return;

    const inputs = [qtyInput, saleInput, prodInput, outsourceInput];
    inputs.forEach(input => {
        if (input) {
            input.addEventListener('input', calculateOrderCosts);
        }
    });
};

const calculateOrderCosts = () => {
    const qty = parseFloat(document.getElementById('order-qty')?.value) || 0;
    const saleUnit = parseFloat(document.getElementById('order-value')?.value) || 0;
    const prodUnit = parseFloat(document.getElementById('order-prod-unit')?.value) || 0;
    const outsourceUnit = parseFloat(document.getElementById('order-outsource-unit')?.value) || 0;

    const totalSale = (qty * saleUnit).toFixed(2);
    const totalProd = (qty * prodUnit).toFixed(2);
    const totalOutsource = (qty * outsourceUnit).toFixed(2);

    const totalSaleEl = document.getElementById('order-total');
    const totalProdEl = document.getElementById('order-prod-total');
    const totalOutsourceEl = document.getElementById('order-outsource-total');

    if (totalSaleEl) totalSaleEl.value = totalSale;
    if (totalProdEl) totalProdEl.value = totalProd;
    if (totalOutsourceEl) totalOutsourceEl.value = totalOutsource;
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
export const exportToCSV = () => {
    // 1. Get currently filtered orders (State Awareness)
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
            const searchStr = `${order.internalOrderNo} ${order.customer} ${order.description} ${order.poNo}`.toLowerCase();
            matchesSearch = searchStr.includes(searchTerm);
        }
        return matchesMonth && matchesSearch && order.entryType !== 'delivery_report';
    });

    if (!exportOrders || exportOrders.length === 0) {
        alert('No orders found in current view to export.');
        return;
    }

    try {
        // Sort by Date (Descending default)
        exportOrders.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Define Headers
        const headers = [
            'S.No', 'Internal Order No', 'Date', 'Drg No', 'Description', 'Qty', 'Unit',
            'Sale Value Ea', 'In-House Value', 'Outsource Value', 'Total Value',
            'Customer', 'PO No', 'PO Date', 'Drg Available', 'Raw Available', 'Finish Available',
            'Del Date Actual', 'DC No', 'Del Qty', 'Bill No', 'Status'
        ];

        // Map delivery reports for resolving delivery date, DC & Bill in export
        const deliveryReportsByIo = new Map();
        const deliveryReportsByDc = new Map();
        orders.filter(o => o.entryType === 'delivery_report' && !o.isDeleted).forEach(d => {
            const date = d.deliveryDateActual || d.date || '';
            const io = (d.internalOrderNo || '').trim().toUpperCase();
            const dc = (d.dcNo || '').trim();
            const bill = (d.billNo || '').trim();
            if (io) {
                if (!deliveryReportsByIo.has(io)) {
                    deliveryReportsByIo.set(io, { dates: [], dcs: [], bills: [] });
                }
                const entry = deliveryReportsByIo.get(io);
                if (date && !entry.dates.includes(date)) entry.dates.push(date);
                if (dc && !entry.dcs.includes(dc)) entry.dcs.push(dc);
                if (bill && !entry.bills.includes(bill)) entry.bills.push(bill);
            }
            if (dc && date && !deliveryReportsByDc.has(dc)) deliveryReportsByDc.set(dc, date);
        });

        // Map Rows
        const rows = exportOrders.map((o, index) => {
            let effectiveDelDate = o.deliveryDateActual;
            let effectiveDcNo = o.dcNo;
            let effectiveBillNo = o.billNo;
            if (!effectiveDelDate && effectiveDcNo && deliveryReportsByDc.has(effectiveDcNo.trim())) {
                effectiveDelDate = deliveryReportsByDc.get(effectiveDcNo.trim());
            }
            if (o.internalOrderNo && deliveryReportsByIo.has(o.internalOrderNo.trim().toUpperCase())) {
                const match = deliveryReportsByIo.get(o.internalOrderNo.trim().toUpperCase());
                if (!effectiveDelDate && match.dates.length > 0) effectiveDelDate = match.dates[match.dates.length - 1];
                if (!effectiveDcNo && match.dcs.length > 0) effectiveDcNo = match.dcs.join(', ');
                if (!effectiveBillNo && match.bills.length > 0) effectiveBillNo = match.bills.join(', ');
            }

            return [
                index + 1,
                `"${o.internalOrderNo || '-'}"`, // Quote to prevent CSV issues with leading zeros
                formatDate(o.date),
                `"${o.drawingNo || '-'}"`,
                `"${(o.description || '-').replace(/"/g, '""')}"`, // Escape quotes
                o.qty || 0,
                o.qtyUnit || '-',
                o.saleValueEa || o.value || 0,
                o.prodValueEa || 0,
                o.outsourceValue || 0,
                o.total || 0,
                `"${(o.customer || '-').replace(/"/g, '""')}"`,
                `"${o.poNo || '-'}"`,
                formatDate(o.poDate),
                o.drgAvail === 'y' ? 'Y' : '-',
                o.rawAvail === 'y' ? 'Y' : '-',
                o.finishAvail === 'y' ? 'Y' : '-',
                formatDate(effectiveDelDate),
                `"${effectiveDcNo || '-'}"`,
                o.deliveryQty || 0,
                `"${effectiveBillNo || '-'}"`,
                o.status || 'Pending'
            ];
        });

        // Combine into CSV string
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        // Create download link
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const filename = `Internal_Orders_${new Date().toISOString().slice(0, 10)}.csv`;
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (error) {
        console.error('CSV Export failed:', error);
        alert('Failed to generate CSV. See console.');
    }
};

// === DELVIERY REPORT LOGIC ===


// Local Delivery Trash State
let isDeliveryTrashMode = false;

export const setDeliveryTrashMode = (mode) => {
    isDeliveryTrashMode = mode;
};

export const renderDeliveryReport = async (weekValue, monthValue) => {
    let startDate, endDate, rangeText;

    if (weekValue) {
        const [year, week] = weekValue.split('-W');
        const simpleWeek = parseInt(week, 10);
        const jan1 = new Date(year, 0, 1);
        const dayOffset = jan1.getDay() <= 4 ? jan1.getDay() - 1 : jan1.getDay() - 8;
        startDate = new Date(year, 0, 1 + (simpleWeek - 1) * 7 - dayOffset);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);

        const options = { month: 'short', day: '2-digit' };
        rangeText = `${startDate.toLocaleDateString('en-IN', options)} - ${endDate.toLocaleDateString('en-IN', options)}`;
    } else if (monthValue) {
        const [year, month] = monthValue.split('-').map(Number);
        startDate = new Date(year, month - 1, 1);
        endDate = new Date(year, month, 0);

        rangeText = startDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    } else {
        return;
    }

    // Update range display
    const rangeEl = document.getElementById('delivery-week-range');
    if (rangeEl) {
        rangeEl.textContent = rangeText;
        rangeEl.classList.remove('hidden');
    }

    const tbody = document.getElementById('delivery-report-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="16" class="text-center py-8">Loading report data...</td></tr>';

    // Fetch Daily Stats
    const startDateStr = startDate.toISOString().slice(0, 10);
    const endDateStr = endDate.toISOString().slice(0, 10);

    let dailyStats = {};
    try {
        dailyStats = await DB.getDailyStats(startDateStr, endDateStr);
    } catch (e) {
        console.error("Failed to load daily stats", e);
    }

    // Normalize start/end times
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

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

    console.log("Render Delivery Report:", { weekValue, monthValue, mode: isDeliveryTrashMode ? 'Trash' : 'Active', totalOrders: orders.length });
    console.log("Range:", { start: startDate.toString(), end: endDate.toString() });

    let dateFilteredOrders = orders.filter(o => {
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

        const inRange = localOrderDate >= startDate && localOrderDate <= endDate;

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

    // Populate Company Filter Dropdown
    const companyFilterEl = document.getElementById('delivery-company-filter');
    if (companyFilterEl) {
        const currentTargetCompany = companyFilterEl.value;
        const uniqueCustomers = [...new Set(dateFilteredOrders.map(o => o.customer).filter(Boolean))].sort();
        
        companyFilterEl.innerHTML = '<option value="all">All Customers</option>' + 
            uniqueCustomers.map(c => `<option value="${c}">${c}</option>`).join('');
            
        // Restore value if it still exists in the options, otherwise reset to 'all'
        if (currentTargetCompany && currentTargetCompany !== 'all' && uniqueCustomers.includes(currentTargetCompany)) {
            companyFilterEl.value = currentTargetCompany;
        } else {
            companyFilterEl.value = 'all';
        }
    }

    const selectedCompany = companyFilterEl ? companyFilterEl.value : 'all';

    const reportOrders = dateFilteredOrders.filter(o => {
        if (selectedCompany !== 'all' && o.customer !== selectedCompany) return false;
        return true;
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
    let totalManpower = reportOrders.reduce((sum, o) => sum + (parseFloat(o.manpower) || 0), 0);

    // Update Stats UI
    const totalItemsEl = document.getElementById('report-total-items');
    if (totalItemsEl) totalItemsEl.textContent = totalItems;

    const totalValueEl = document.getElementById('report-total-value');
    if (totalValueEl) totalValueEl.textContent = '₹' + totalValue.toLocaleString('en-IN');


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
                <td class="px-4 py-2 font-medium" style="color: var(--brand-600); white-space: nowrap;">${order.internalOrderNo || '-'}</td>
                <td class="px-4 py-2">${order.customer || '-'}</td>
                <td class="px-4 py-2">${order.description || '-'}</td>
                <td class="px-4 py-2 text-center" style="white-space: nowrap; text-align: center !important;">${order.drawingNo || '-'}</td>
                <td class="px-4 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs font-semibold bg-slate-100 text-slate-600">${order.department || '-'}</span>
                </td>
                <td class="px-4 py-2 text-center">${order.dcNo || '-'}</td> 
                <td class="px-4 py-2 text-center font-mono text-xs">${order.billNo || '-'}</td>
                <td class="px-4 py-2 text-right font-bold">${order.deliveryQty || order.qty || 0}</td>
                <td class="px-4 py-2">${order.qtyUnit || '-'}</td>
                <td class="px-4 py-2 text-right">₹${(parseFloat(order.total) || 0).toLocaleString('en-IN')}</td>
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
