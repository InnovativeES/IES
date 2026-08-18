// DC Register Module - Focused Delivery Challan Tracking & Missing DC Gap Detection
import * as DB from './db.js';

let filterMonthFrom = '';
let filterMonthTo = '';
let searchTerm = '';
let showMissingGaps = true;
let sortConfig = {
    key: 'dcNo',
    direction: 'desc' // Default sorted from Highest DC to Lowest as requested
};

const formatDate = (dateStr) => {
    if (!dateStr || dateStr === '-') return '-';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`; // Convert YYYY-MM-DD to DD/MM/YYYY
};

/**
 * Builds a unified list of DC entries from both Delivery Reports and Internal Orders.
 * Resolves drawing numbers, descriptions, quantities, units, and delivery dates.
 */
export const buildDCDataset = (orders = []) => {
    const rawDeliveries = orders.filter(o => o.entryType === 'delivery_report' && !o.isDeleted && !o.deleted);
    const baseOrders = orders.filter(o => o.entryType !== 'delivery_report' && !o.isDeleted && !o.deleted);

    // Map base orders by internalOrderNo for quick detail lookup
    const baseOrdersByIo = new Map();
    baseOrders.forEach(bo => {
        if (bo.internalOrderNo) {
            const key = bo.internalOrderNo.trim().toUpperCase();
            if (!baseOrdersByIo.has(key)) {
                baseOrdersByIo.set(key, bo);
            }
        }
    });

    // Map delivery reports by DC No and by IO No for delivery date lookup
    const deliveryReportsByDc = new Map();
    const deliveryReportsByIo = new Map();

    rawDeliveries.forEach(d => {
        const dc = (d.dcNo || '').toString().trim();
        const date = d.deliveryDateActual || d.date || '';
        if (dc && date && !deliveryReportsByDc.has(dc)) {
            deliveryReportsByDc.set(dc, date);
        }
        if (d.internalOrderNo && date) {
            const ioKey = d.internalOrderNo.trim().toUpperCase();
            if (!deliveryReportsByIo.has(ioKey)) {
                deliveryReportsByIo.set(ioKey, date);
            }
        }
    });

    const dcEntries = [];
    const processedKeys = new Set(); // Prevent duplicate delivery report + base order records

    // 1. Process all explicit Delivery Report entries
    rawDeliveries.forEach(d => {
        const dc = (d.dcNo || '').toString().trim();
        const ioNo = (d.internalOrderNo || '').toString().trim();
        const matchedBase = ioNo ? baseOrdersByIo.get(ioNo.toUpperCase()) : null;

        const delDate = d.deliveryDateActual || d.date || (matchedBase ? (matchedBase.deliveryDateActual || matchedBase.date) : '');
        const entryId = d.id || `${dc}_${ioNo}_${delDate}`;
        processedKeys.add(entryId);

        const orderedQty = d.orderedQty || (matchedBase ? (parseFloat(matchedBase.qty) || 0) : (parseFloat(d.qty) || 0));
        const deliveredQty = parseFloat(d.deliveryQty) || parseFloat(d.qty) || 0;
        const qtyUnit = d.qtyUnit || (matchedBase ? matchedBase.qtyUnit : '') || 'Nos';
        const customer = d.customer || (matchedBase ? matchedBase.customer : '-') || '-';
        const drgNo = d.drawingNo || d.itemCode || (matchedBase ? (matchedBase.drawingNo || matchedBase.itemCode) : '') || '-';
        const description = d.description || (matchedBase ? matchedBase.description : '') || '-';

        let status = 'Delivered';
        if (orderedQty > 0 && deliveredQty < orderedQty) {
            status = 'Partially Delivered';
        }

        dcEntries.push({
            id: d.id,
            sourceType: 'delivery_report',
            dcNo: dc || '-',
            rawDcNo: dc,
            deliveryDate: delDate,
            internalOrderNo: ioNo || '-',
            customer: customer,
            drawingNo: drgNo,
            description: description,
            orderedQty: orderedQty || '-',
            qtyUnit: qtyUnit,
            deliveredQty: deliveredQty,
            total: d.total || (matchedBase ? matchedBase.total : 0),
            status: status,
            isLaborJob: d.isLaborJob || (matchedBase ? matchedBase.isLaborJob : false),
            originalDoc: d
        });
    });

    // 2. Process Base Orders that have a DC No not already processed
    baseOrders.forEach(bo => {
        const dc = (bo.dcNo || '').toString().trim();
        if (!dc) return;

        // Check if already captured in delivery reports with same DC & IO
        const alreadyExists = dcEntries.some(e => e.rawDcNo === dc && e.internalOrderNo === (bo.internalOrderNo || '-'));
        if (alreadyExists) return;

        // Resolve delivery date from delivery reports if empty
        let delDate = bo.deliveryDateActual || '';
        if (!delDate && deliveryReportsByDc.has(dc)) {
            delDate = deliveryReportsByDc.get(dc);
        }
        if (!delDate && bo.internalOrderNo && deliveryReportsByIo.has(bo.internalOrderNo.trim().toUpperCase())) {
            delDate = deliveryReportsByIo.get(bo.internalOrderNo.trim().toUpperCase());
        }
        if (!delDate) {
            delDate = bo.date || '';
        }

        const orderedQty = parseFloat(bo.qty) || 0;
        const deliveredQty = parseFloat(bo.deliveryQty) || orderedQty;
        const qtyUnit = bo.qtyUnit || 'Nos';

        let status = bo.status || 'Delivered';
        if (status !== 'Delivered' && deliveredQty >= orderedQty && orderedQty > 0) {
            status = 'Delivered';
        } else if (deliveredQty > 0 && deliveredQty < orderedQty) {
            status = 'Partially Delivered';
        }

        dcEntries.push({
            id: bo.id,
            sourceType: 'internal_order',
            dcNo: dc,
            rawDcNo: dc,
            deliveryDate: delDate,
            internalOrderNo: bo.internalOrderNo || '-',
            customer: bo.customer || '-',
            drawingNo: bo.drawingNo || bo.itemCode || '-',
            description: bo.description || '-',
            orderedQty: orderedQty || '-',
            qtyUnit: qtyUnit,
            deliveredQty: deliveredQty,
            total: bo.total || 0,
            status: status,
            isLaborJob: bo.isLaborJob || false,
            originalDoc: bo
        });
    });

    return { dcEntries, deliveryReportsByDc, deliveryReportsByIo };
};

/**
 * Parses numeric DC number for sequence gap detection.
 */
const parseNumericDC = (dcStr) => {
    if (!dcStr) return null;
    const clean = dcStr.toString().trim();
    if (clean === '-' || clean === '') return null;
    const match = clean.match(/\d+/);
    if (!match) return null;
    return parseInt(match[0], 10);
};

export const setFilters = (monthFrom, monthTo, search) => {
    if (monthFrom !== undefined) filterMonthFrom = monthFrom;
    if (monthTo !== undefined) filterMonthTo = monthTo;
    if (search !== undefined) searchTerm = search.toLowerCase();
};

export const getFilters = () => ({
    monthFrom: filterMonthFrom,
    monthTo: filterMonthTo,
    search: searchTerm,
    showMissingGaps: showMissingGaps
});

export const toggleShowMissingGaps = () => {
    showMissingGaps = !showMissingGaps;
    renderDCTable();
    return showMissingGaps;
};

export const sortDC = (key) => {
    if (sortConfig.key === key) {
        sortConfig.direction = sortConfig.direction === 'desc' ? 'asc' : 'desc';
    } else {
        sortConfig.key = key;
        sortConfig.direction = key === 'dcNo' ? 'desc' : 'asc';
    }
    renderDCTable();
};

/**
 * Renders the DC Register Table with In-Table Missing DC Gap Rows & Premium UI.
 */
export const renderDCTable = (orders = null) => {
    const tbody = document.getElementById('dc-register-table-body');
    if (!tbody) return;

    if (!orders) {
        orders = window.adminApp?.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    }

    const { dcEntries } = buildDCDataset(orders);

    // 1. Filter Logic
    let processed = dcEntries.filter(entry => {
        let matchesMonth = true;
        const entryDate = entry.deliveryDate;
        if (entryDate && entryDate.includes('-')) {
            const entryMonth = entryDate.slice(0, 7);
            if (filterMonthFrom && filterMonthTo) {
                matchesMonth = entryMonth >= filterMonthFrom && entryMonth <= filterMonthTo;
            } else if (filterMonthFrom) {
                matchesMonth = entryMonth >= filterMonthFrom;
            } else if (filterMonthTo) {
                matchesMonth = entryMonth <= filterMonthTo;
            }
        }

        let matchesSearch = true;
        if (searchTerm) {
            const searchStr = `${entry.dcNo} ${entry.internalOrderNo} ${entry.customer} ${entry.drawingNo} ${entry.description}`.toLowerCase();
            matchesSearch = searchStr.includes(searchTerm);
        }

        return matchesMonth && matchesSearch;
    });

    // 2. Sorting Logic (Default Highest DC to Lowest)
    if (sortConfig.key) {
        processed.sort((a, b) => {
            if (sortConfig.key === 'dcNo') {
                const numA = parseNumericDC(a.dcNo);
                const numB = parseNumericDC(b.dcNo);

                // Both have numeric DC
                if (numA !== null && numB !== null) {
                    if (numA !== numB) {
                        return sortConfig.direction === 'desc' ? numB - numA : numA - numB;
                    }
                }
                // Handle non-numeric / empty DC: always put at bottom regardless of sort
                if (numA === null && numB !== null) return 1;
                if (numA !== null && numB === null) return -1;

                const strA = (a.dcNo || '').toString().toLowerCase();
                const strB = (b.dcNo || '').toString().toLowerCase();
                if (strA < strB) return sortConfig.direction === 'desc' ? 1 : -1;
                if (strA > strB) return sortConfig.direction === 'desc' ? -1 : 1;
                return 0;
            }

            let valA = a[sortConfig.key] || '';
            let valB = b[sortConfig.key] || '';

            if (sortConfig.key === 'deliveredQty' || sortConfig.key === 'orderedQty' || sortConfig.key === 'total') {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            } else if (sortConfig.key === 'deliveryDate') {
                valA = new Date(valA || '1970-01-01').getTime();
                valB = new Date(valB || '1970-01-01').getTime();
            } else {
                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
            }

            if (valA < valB) return sortConfig.direction === 'desc' ? 1 : -1;
            if (valA > valB) return sortConfig.direction === 'desc' ? -1 : 1;
            return 0;
        });

        // Update sort indicator classes on table headers
        document.querySelectorAll('#dc-register-table th.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            const onclick = th.getAttribute('onclick') || '';
            if (onclick.includes(`'${sortConfig.key}'`)) {
                th.classList.add(sortConfig.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    // 3. Update Summary Stats & Gap Analysis
    const totalCount = processed.length;
    const totalDeliveredQty = processed.reduce((sum, e) => sum + (parseFloat(e.deliveredQty) || 0), 0);
    const totalValue = processed.reduce((sum, e) => sum + (parseFloat(e.total) || 0), 0);

    const totalDcsEl = document.getElementById('dc-total-count');
    const totalQtyEl = document.getElementById('dc-total-qty');
    const totalValEl = document.getElementById('dc-total-value');
    const gapsBadgeEl = document.getElementById('dc-gaps-badge');

    if (totalDcsEl) totalDcsEl.textContent = totalCount;
    if (totalQtyEl) totalQtyEl.textContent = totalDeliveredQty.toLocaleString('en-IN');
    if (totalValEl) totalValEl.textContent = '₹' + totalValue.toLocaleString('en-IN');

    // Detect missing sequence gaps within continuous series (ignoring massive series jumps > 20)
    const numericDCs = processed
        .map(e => parseNumericDC(e.dcNo))
        .filter(n => n !== null)
        .sort((a, b) => a - b);
    
    const uniqueNumericDCs = [...new Set(numericDCs)];
    const missingSequenceNumbers = [];

    if (uniqueNumericDCs.length > 1) {
        for (let i = 0; i < uniqueNumericDCs.length - 1; i++) {
            const curr = uniqueNumericDCs[i];
            const next = uniqueNumericDCs[i + 1];
            const gap = next - curr;
            // Only consider realistic book gaps between 1 and 20 numbers
            if (gap > 1 && gap <= 20) {
                for (let missing = curr + 1; missing < next; missing++) {
                    missingSequenceNumbers.push(missing);
                }
            }
        }
    }

    if (gapsBadgeEl) {
        if (missingSequenceNumbers.length > 0) {
            gapsBadgeEl.innerHTML = `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 shadow-sm">
                    <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                    ${missingSequenceNumbers.length} Missing Challan Gap${missingSequenceNumbers.length > 1 ? 's' : ''}
                </span>
            `;
            gapsBadgeEl.classList.remove('hidden');
        } else {
            gapsBadgeEl.innerHTML = `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-sm">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Continuous Sequence
                </span>
            `;
            gapsBadgeEl.classList.remove('hidden');
        }
    }

    // 4. Render Table Rows with In-Table Gap Highlights
    tbody.innerHTML = '';

    if (processed.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" style="padding: 4rem 1rem; text-align: center; color: #64748b;">
                    <div class="flex flex-col items-center justify-center">
                        <div class="w-16 h-16 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <span class="text-base font-semibold text-slate-700">No DC entries found for the selected period</span>
                        <span class="text-xs text-slate-400 mt-1">Try adjusting the filter period or add a new Delivery entry.</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    let serialNo = 1;
    const isSortedByDC = sortConfig.key === 'dcNo';

    for (let i = 0; i < processed.length; i++) {
        const entry = processed[i];
        const prevEntry = i > 0 ? processed[i - 1] : null;

        // IN-TABLE MISSING DC GAP HIGHLIGHT
        if (showMissingGaps && isSortedByDC && prevEntry) {
            const prevNum = parseNumericDC(prevEntry.dcNo);
            const currNum = parseNumericDC(entry.dcNo);

            if (prevNum !== null && currNum !== null) {
                // Support both DESC and ASC order gap calculation
                const diff = sortConfig.direction === 'desc' ? prevNum - currNum : currNum - prevNum;
                // Only render realistic book gaps (1 to 20 numbers)
                if (diff > 1 && diff <= 20) {
                    const missingList = [];
                    if (sortConfig.direction === 'desc') {
                        for (let m = prevNum - 1; m > currNum; m--) missingList.push(m);
                    } else {
                        for (let m = prevNum + 1; m < currNum; m++) missingList.push(m);
                    }

                    // Render compact gap row
                    const gapTr = document.createElement('tr');
                    gapTr.className = 'dc-gap-row';
                    gapTr.innerHTML = `
                        <td class="text-center font-bold text-amber-600">⚠️</td>
                        <td colspan="5">
                            <span class="text-xs font-bold text-amber-900">MISSING DC${missingList.length > 1 ? 'S' : ''}: ${missingList.map(n => `#${n}`).join(', ')}</span>
                            <span class="text-xs text-amber-700 ml-1">(${missingList.length} skipped between #${prevNum} & #${currNum})</span>
                        </td>
                        <td colspan="5"></td>
                        <td class="text-center">
                            <button class="px-2 py-0.5 text-xs font-semibold text-amber-900 bg-amber-200 hover:bg-amber-300 rounded border border-amber-400 transition"
                                onclick="window.adminApp.openAddDeliveryWithDC('${missingList[0]}')">+ DC #${missingList[0]}</button>
                        </td>
                    `;
                    tbody.appendChild(gapTr);
                }
            }
        }

        // Standard DC Row
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';

        let statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Delivered</span>';
        if (entry.status === 'Partially Delivered') {
            statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">Partial</span>';
        }

        const t = (val) => (val !== undefined && val !== null && val !== '') ? val : '-';

        const hasDC = entry.dcNo && entry.dcNo !== '-';
        const dcDisplay = hasDC
            ? `<span class="dc-badge">#${entry.dcNo}</span>`
            : `<span class="dc-badge-missing">—</span>`;

        tr.innerHTML = `
            <td class="text-center text-slate-500 font-medium">${serialNo++}</td>
            <td class="whitespace-nowrap font-mono font-bold text-teal-700">${dcDisplay}</td>
            <td class="text-center text-slate-700 whitespace-nowrap">${formatDate(entry.deliveryDate)}</td>
            <td class="text-center whitespace-nowrap">
                ${entry.internalOrderNo && entry.internalOrderNo !== '-' ? 
                    `<a href="#" onclick="event.preventDefault(); window.adminApp.wfOpenProject('${entry.internalOrderNo}')" style="color:#0f766e; font-weight:600;" title="Open Project">${entry.internalOrderNo}</a>` : 
                    '<span class="text-slate-400">-</span>'}
            </td>
            <td class="text-center text-slate-800 font-medium truncate" title="${t(entry.customer)}">${t(entry.customer)}</td>
            <td class="text-slate-600 text-center truncate" title="${t(entry.drawingNo)}">${t(entry.drawingNo)}</td>
            <td class="text-center text-slate-600 truncate" title="${t(entry.description)}">${t(entry.description)}</td>
            <td class="text-right text-slate-600">${t(entry.orderedQty)}</td>
            <td class="text-center text-slate-400 text-xs">${t(entry.qtyUnit)}</td>
            <td class="text-right font-bold text-slate-900">${t(entry.deliveredQty)}</td>
            <td class="text-center">${statusBadge}</td>
            <td class="text-center no-print">
                <button class="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 transition"
                    onclick="window.adminApp.editOrder('${entry.id}')" title="Edit">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                </button>
            </td>
        `;

        tr.addEventListener('dblclick', () => {
            if (entry.id) window.adminApp.editOrder(entry.id);
        });

        tbody.appendChild(tr);
    }
};

/**
 * Export DC Register to CSV file.
 */
export const exportDCCSV = () => {
    const orders = window.adminApp?.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    const { dcEntries } = buildDCDataset(orders);

    const headers = [
        "S.No",
        "DC No",
        "Delivery Date",
        "Internal Order No",
        "Customer",
        "Drawing No",
        "Description",
        "Ordered Qty",
        "Unit",
        "Delivered Qty",
        "Total Value",
        "Status"
    ];

    const rows = dcEntries.map((e, idx) => [
        idx + 1,
        `"${e.dcNo || '-'}"`,
        `"${formatDate(e.deliveryDate)}"`,
        `"${e.internalOrderNo || '-'}"`,
        `"${(e.customer || '-').replace(/"/g, '""')}"`,
        `"${(e.drawingNo || '-').replace(/"/g, '""')}"`,
        `"${(e.description || '-').replace(/"/g, '""')}"`,
        e.orderedQty || 0,
        `"${e.qtyUnit || 'Nos'}"`,
        e.deliveredQty || 0,
        e.total || 0,
        `"${e.status || 'Delivered'}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `DC_Register_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
