import * as DB from './db.js';

let currentFilterCustomer = '';
let sortConfig = { key: 'internalOrderNo', direction: 'desc' };

export const setFilterCustomer = (customer) => {
    currentFilterCustomer = customer;
    renderTracker();
};

export const setSortTracker = (key) => {
    if (sortConfig.key === key) {
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortConfig.key = key;
        sortConfig.direction = 'asc';
    }
    renderTracker();
};

export const renderTracker = () => {
    const tbody = document.getElementById('progress-tracker-body');
    const customerSelect = document.getElementById('tracker-customer-filter');
    if (!tbody) return;

    const allOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    
    let activeOrders = allOrders.filter(o => 
        !o.deleted && 
        o.entryType !== 'delivery_report' && 
        o.status !== 'Delivered'
    );

    if (customerSelect) {
        const uniqueCustomers = [...new Set(activeOrders.map(o => o.customer).filter(Boolean))].sort();
        const currentVal = customerSelect.value;
        customerSelect.innerHTML = '<option value="">All Customers</option>' + 
            uniqueCustomers.map(c => `<option value="${c}">${c}</option>`).join('');
        customerSelect.value = uniqueCustomers.includes(currentVal) ? currentVal : '';
    }

    if (currentFilterCustomer) {
        activeOrders = activeOrders.filter(o => o.customer === currentFilterCustomer);
    }

    if (sortConfig.key) {
        activeOrders.sort((a, b) => {
            let valA = a[sortConfig.key] || '';
            let valB = b[sortConfig.key] || '';
            if (sortConfig.key === 'deliveryDate') {
                valA = a.deliveryDateActual || a.estimatedCompletion || '';
                valB = b.deliveryDateActual || b.estimatedCompletion || '';
            }
            return (valA < valB ? -1 : 1) * (sortConfig.direction === 'asc' ? 1 : -1);
        });
        document.querySelectorAll('#progress-tracker-table th.sortable').forEach(th => {
            th.classList.toggle('sort-asc', th.dataset.sort === sortConfig.key && sortConfig.direction === 'asc');
            th.classList.toggle('sort-desc', th.dataset.sort === sortConfig.key && sortConfig.direction === 'desc');
        });
    }

    if (activeOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="p-8 text-center text-slate-400 italic">No pending items found.</td></tr>';
        return;
    }

    const helpers = {
        t: (v) => v || '',
        autoResize: (el) => {
            el.style.height = 'auto';
            el.style.height = (el.scrollHeight) + 'px';
        }
    };

    let sNo = 1;
    let rowsHtml = '';

    activeOrders.forEach(o => {
        rowsHtml += `
            <tr class="hover:bg-indigo-50/30 transition-colors group">
                <td class="p-3 text-center text-slate-400 font-mono text-xs border-r border-slate-100">${sNo++}</td>
                
                <td class="p-3 font-bold text-indigo-700 border-r border-slate-100 bg-slate-50/50">
                    ${helpers.t(o.internalOrderNo)}
                </td>
                
                <td class="p-3 text-slate-600 border-r border-slate-100 italic text-xs">
                    <div class="max-w-[150px] truncate" title="${helpers.t(o.description)}">${helpers.t(o.description)}</div>
                </td>

                <td class="p-1 border-r border-slate-100 min-w-[150px]">
                    <textarea class="auto-grow text-xs font-semibold text-slate-800" rows="1"
                        oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px'"
                        onchange="window.adminApp.trackerInlineEdit('${o.id}', 'moduleActivity', this.value)"
                        placeholder="Module Name...">${helpers.t(o.moduleActivity)}</textarea>
                </td>

                <td class="p-3 border-r border-slate-100 text-slate-700 font-medium">
                    ${helpers.t(o.customer)}
                </td>

                <td class="p-1 border-r border-slate-100">
                    <textarea class="auto-grow text-xs" rows="1" oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px'" onchange="window.adminApp.trackerInlineEdit('${o.id}', 'contactPerson', this.value)" placeholder="Contact...">${helpers.t(o.contactPerson)}</textarea>
                </td>

                <td class="p-3 border-r border-slate-100 text-slate-400 text-[10px]">
                    ${helpers.t(o.poNo)}
                </td>

                <td class="p-1 border-r border-slate-200 tracker-section-sep">
                    <input type="date" class="text-[10px]" value="${helpers.t(o.plannedDeliveryDate || o.deliveryDateActual || o.estimatedCompletion)}"
                        onchange="window.adminApp.trackerInlineEdit('${o.id}', 'plannedDeliveryDate', this.value)">
                </td>

                <td class="p-1 border-r border-slate-100 text-center">
                    <div class="flex items-center justify-center gap-1">
                        <input type="number" class="w-12 text-center text-xs font-bold text-emerald-600"
                            value="${helpers.t(o.pctCompleted)}" min="0" max="100"
                            onchange="window.adminApp.trackerInlineEdit('${o.id}', 'pctCompleted', this.value)">
                        <span class="text-[10px] text-slate-300">%</span>
                    </div>
                </td>

                <td class="p-1 border-r border-slate-100 min-w-[180px]">
                    <textarea class="auto-grow text-[11px]" rows="1"
                        oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px'"
                        onchange="window.adminApp.trackerInlineEdit('${o.id}', 'progressThisWeek', this.value)"
                        placeholder="Current status...">${helpers.t(o.progressThisWeek)}</textarea>
                </td>

                <td class="p-1 border-r border-slate-100 min-w-[180px]">
                    <textarea class="auto-grow text-[11px]" rows="1"
                        oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px'"
                        onchange="window.adminApp.trackerInlineEdit('${o.id}', 'plannedNextWeek', this.value)"
                        placeholder="Next steps...">${helpers.t(o.plannedNextWeek)}</textarea>
                </td>

                <td class="p-1 border-r border-slate-200 tracker-section-sep">
                    <input type="date" class="text-[10px]" value="${helpers.t(o.expectedDeliveryDate)}"
                        onchange="window.adminApp.trackerInlineEdit('${o.id}', 'expectedDeliveryDate', this.value)">
                </td>

                <td class="p-1 min-w-[200px]">
                    <textarea class="auto-grow text-[11px]" rows="1"
                        oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px'"
                        onchange="window.adminApp.trackerInlineEdit('${o.id}', 'remarks', this.value)"
                        placeholder="Notes...">${helpers.t(o.remarks)}</textarea>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;

    // Trigger initial height adjustment for textareas
    setTimeout(() => {
        tbody.querySelectorAll('textarea').forEach(ta => {
            ta.style.height = 'auto';
            ta.style.height = (ta.scrollHeight) + 'px';
        });
    }, 100);
};

export const handleInlineEdit = async (orderId, field, value) => {
    try {
        const updateData = { [field]: value };
        const res = await DB.updateOrder(orderId, updateData);
        if (res.error) {
            console.error('Failed update:', res.error);
            renderTracker();
        }
    } catch (err) {
        console.error('Error during inline edit:', err);
    }
};

export const exportTrackerCSV = () => {
    const allOrders = window.adminApp.getCurrentOrders ? window.adminApp.getCurrentOrders() : [];
    
    let activeOrders = allOrders.filter(o => 
        !o.deleted && 
        o.entryType !== 'delivery_report' && 
        o.status !== 'Delivered'
    );

    if (currentFilterCustomer) {
        activeOrders = activeOrders.filter(o => o.customer === currentFilterCustomer);
    }

    if (sortConfig.key) {
        activeOrders.sort((a, b) => {
            let valA = a[sortConfig.key] || '';
            let valB = b[sortConfig.key] || '';
            if (sortConfig.key === 'deliveryDate') {
                valA = a.deliveryDateActual || a.estimatedCompletion || '';
                valB = b.deliveryDateActual || b.estimatedCompletion || '';
            }
            return (valA < valB ? -1 : 1) * (sortConfig.direction === 'asc' ? 1 : -1);
        });
    }

    const headers = [
        "S.No", "Internal Order No", "Description", "Module/Activity", "Customer", 
        "Contact Person", "PO Number", "Planned Delivery Date", "% Completed", 
        "Status as of Today", "Planned for Next Week", "Expected Delivery Date", "Remarks"
    ];

    const escapeCSV = (str) => {
        if (!str) return "";
        str = String(str).replace(/"/g, '""');
        return `"${str}"`;
    };

    const rows = activeOrders.map((o, index) => [
        index + 1,
        escapeCSV(o.internalOrderNo),
        escapeCSV(o.description),
        escapeCSV(o.moduleActivity),
        escapeCSV(o.customer),
        escapeCSV(o.contactPerson),
        escapeCSV(o.poNo),
        escapeCSV(o.plannedDeliveryDate || o.deliveryDateActual || o.estimatedCompletion),
        o.pctCompleted || 0,
        escapeCSV(o.progressThisWeek),
        escapeCSV(o.plannedNextWeek),
        escapeCSV(o.expectedDeliveryDate),
        escapeCSV(o.remarks)
    ]);

    let csvContent = "\uFEFF" // UTF-8 BOM
        + headers.join(",") + "\n"
        + rows.map(e => e.join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const fileName = `Project_Progress_Tracker_${new Date().toISOString().slice(0, 10)}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
