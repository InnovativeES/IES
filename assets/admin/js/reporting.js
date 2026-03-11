import * as DB from './db.js';
export const initDailySummaryReport = () => {
    console.log("Initializing Daily Summary Report...");
    const startDateInput = document.getElementById('summary-report-start-date');
    const endDateInput = document.getElementById('summary-report-end-date');
    const exportBtn = document.getElementById('summary-export-btn');
    const printBtn = document.getElementById('summary-print-btn');

    if (!startDateInput || !endDateInput) {
        console.error("Report inputs not found!");
        return;
    }

    // 1. Use session-persistent values if they exist
    const sessionStart = sessionStorage.getItem('reportStartDate');
    const sessionEnd = sessionStorage.getItem('reportEndDate');

    if (sessionStart) startDateInput.value = sessionStart;
    if (sessionEnd) endDateInput.value = sessionEnd;

    // 2. Default to current month: 1st to Today (if no session value)
    if (!startDateInput.value) {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput.value = firstDay.toISOString().split('T')[0];
        sessionStorage.setItem('reportStartDate', startDateInput.value);
    }
    if (!endDateInput.value) {
        endDateInput.value = new Date().toISOString().split('T')[0];
        sessionStorage.setItem('reportEndDate', endDateInput.value);
    }

    // Listeners
    startDateInput.onchange = () => {
        console.log("Start date changed:", startDateInput.value);
        sessionStorage.setItem('reportStartDate', startDateInput.value);
        renderDailySummaryReport();
    };
    endDateInput.onchange = () => {
        console.log("End date changed:", endDateInput.value);
        sessionStorage.setItem('reportEndDate', endDateInput.value);
        renderDailySummaryReport();
    };
    if (exportBtn) exportBtn.onclick = () => exportToExcel();
    if (printBtn) printBtn.onclick = () => printDailySummaryReport();

    // Mapping for UI logic
    window.adminApp = window.adminApp || {};
    window.adminApp.renderDailySummaryReport = renderDailySummaryReport;
    window.adminApp.exportSummaryCSV = exportToExcel;
    window.adminApp.printSummaryReport = printDailySummaryReport;

    // Initial render
    renderDailySummaryReport();
};

export const renderDailySummaryReport = async () => {
    const startDateInput = document.getElementById('summary-report-start-date');
    const endDateInput = document.getElementById('summary-report-end-date');
    const tbody = document.getElementById('daily-summary-report-body');
    const container = document.getElementById('view-daily_summary_report');
    
    if (!tbody || container.classList.contains('hidden')) return;

    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!startDate || !endDate) return;

    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8"><div class="spinner mx-auto mb-2"></div>Gathering data from ' + startDate + ' to ' + endDate + '...</td></tr>';

    try {
        // 1. Fetch Data
        const [workflows, orders, allMembers] = await Promise.all([
            DB.getWorkflowsForDateRange(startDate, endDate),
            DB.getOrdersForDateRange(startDate, endDate),
            DB.getMembers()
        ]);

        const memberIds = new Set(allMembers.map(m => m.id));
        const deliveries = orders.filter(o => o.entryType === 'delivery_report' && !o.deleted);

        // 2. Prepare Stats Object for every date in range
        const stats = {};
        let current = new Date(startDate);
        const end = new Date(endDate);
        while (current <= end) {
            const dateStr = current.toISOString().split('T')[0];
            stats[dateStr] = { attendance: 0, overheads: 0, production: 0, sales: 0 };
            current.setDate(current.getDate() + 1);
        }

        // 3. Process Workflows (Attendance & Task Overheads)
        const processedTasks = new Set();
        const dailyAttendanceMaps = {}; // date -> { empId: { present, shiftType } }

        workflows.forEach(wf => {
            const d = wf.id.split('_')[0];
            if (!stats[d]) return;

            if (!dailyAttendanceMaps[d]) dailyAttendanceMaps[d] = {};
            Object.assign(dailyAttendanceMaps[d], wf.attendance || {});

            (wf.assignments || []).forEach(a => {
                (a.tasks || []).forEach(task => {
                    const taskKey = task.taskId ? `${d}_${task.taskId}` : `${d}_${task.orderNo}_${task.drawingNo}_${task.description}_${task.qty}`;
                    if (!processedTasks.has(taskKey)) {
                        stats[d].overheads += (parseFloat(task.totalOverheads) || 0);
                        stats[d].production += (parseFloat(task.prodValueEa) || 0) * (parseFloat(task.qty) || 0);
                        processedTasks.add(taskKey);
                    }
                });
            });
        });

        // 4. Calculate Attendance Totals
        Object.entries(dailyAttendanceMaps).forEach(([d, dayAtt]) => {
            allMembers.forEach(m => {
                const entry = dayAtt[m.id];
                if (entry && entry.present) {
                    const factor = entry.shiftType === 'Half' ? 0.5 : 1;
                    const baseOh = parseFloat(m.overheads) || 0;
                    stats[d].attendance += baseOh * factor;
                }
            });
        });

        // 5. Aggregate Sales
        deliveries.forEach(o => {
            const d = o.deliveryDateActual || o.date;
            if (stats[d]) stats[d].sales += parseFloat(o.total) || 0;
        });

        // 6. Render Table
        let cumAtt = 0, cumOh = 0, cumProd = 0, cumSales = 0;
        const html = Object.keys(stats).sort().map(d => {
            const row = stats[d];
            cumAtt += row.attendance; cumOh += row.overheads; cumProd += row.production; cumSales += row.sales;

            return `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="p-3 border-b border-slate-100 font-mono text-xs">${formatReportDate(d)}</td>
                    <td class="p-3 border-b border-slate-100 text-right font-medium text-amber-700">₹${row.attendance.toLocaleString('en-IN')}</td>
                    <td class="p-3 border-b border-slate-100 text-right text-amber-300 text-[11px] border-r border-slate-100">₹${cumAtt.toLocaleString('en-IN')}</td>
                    <td class="p-3 border-b border-slate-100 text-right font-medium text-slate-700">₹${row.overheads.toLocaleString('en-IN')}</td>
                    <td class="p-3 border-b border-slate-100 text-right text-slate-400 text-[11px] border-r border-slate-100">₹${cumOh.toLocaleString('en-IN')}</td>
                    <td class="p-3 border-b border-slate-100 text-right font-medium text-blue-600">₹${row.production.toLocaleString('en-IN')}</td>
                    <td class="p-3 border-b border-slate-100 text-right text-blue-300 text-[11px] border-r border-slate-100">₹${cumProd.toLocaleString('en-IN')}</td>
                    <td class="p-3 border-b border-slate-100 text-right font-medium text-emerald-600">₹${row.sales.toLocaleString('en-IN')}</td>
                    <td class="p-3 border-b border-slate-100 text-right text-emerald-300 text-[11px]">₹${cumSales.toLocaleString('en-IN')}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = html || '<tr><td colspan="9" class="text-center py-8 text-slate-400 italic">No data found for this range.</td></tr>';

    } catch (err) {
        console.error("Summary Report Error:", err);
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-red-500">Failed to load report data. ' + err.message + '</td></tr>';
    }
};

export const printDailySummaryReport = () => {
    const table = document.getElementById('daily-summary-report-table');
    const start = document.getElementById('summary-report-start-date')?.value;
    const end = document.getElementById('summary-report-end-date')?.value;
    if (!table) return;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Daily Summary Report: ${start} to ${end}</title>
            <style>
                @page { size: landscape; margin: 10mm; }
                body { font-family: 'Inter', system-ui, sans-serif; color: #1e293b; padding: 20px; }
                .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #0d9488; padding-bottom: 15px; }
                .header h1 { margin: 0; color: #0d9488; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
                .header p { margin: 5px 0 0; color: #64748b; font-size: 14px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; table-layout: fixed; }
                th { background: #f8fafc; color: #475569; font-weight: 700; border: 1px solid #e2e8f0; padding: 8px 4px; text-transform: uppercase; letter-spacing: 0.5px; }
                td { border: 1px solid #e2e8f0; padding: 6px 4px; }
                .text-right { text-align: right; font-variant-numeric: tabular-nums; }
                .text-center { text-align: center; }
                .date-col { width: 85px; font-family: monospace; }
                .alt-bg { background-color: #f8fafc; }
                .cumulative { color: #94a3b8; font-size: 10px; font-style: italic; }
                .today { font-weight: 600; }
                .attendance-color { color: #b45309; }
                .overheads-color { color: #334155; }
                .production-color { color: #2563eb; }
                .sales-color { color: #059669; }
                .footer { margin-top: 30px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Innovative Engineering Solutions</h1>
                <p>Daily Summary Report: ${formatReportDate(start)} - ${formatReportDate(end)}</p>
            </div>
            <table>
                <thead>
                    <tr>
                        <th rowspan="2" class="date-col">Date</th>
                        <th colspan="2">Attendance</th>
                        <th colspan="2">Overheads</th>
                        <th colspan="2">Production</th>
                        <th colspan="2">Sales</th>
                    </tr>
                    <tr>
                        <th>Today</th>
                        <th>Cum.</th>
                        <th>Today</th>
                        <th>Cum.</th>
                        <th>Today</th>
                        <th>Cum.</th>
                        <th>Today</th>
                        <th>Cum.</th>
                    </tr>
                </thead>
                <tbody>
                    ${Array.from(table.querySelectorAll('tbody tr')).map((tr, i) => {
                        const cols = Array.from(tr.querySelectorAll('td')).map(td => td.textContent);
                        if (cols.length < 9) return '';
                        return `
                            <tr class="${i % 2 === 1 ? 'alt-bg' : ''}">
                                <td class="text-center font-mono">${cols[0]}</td>
                                <td class="text-right today attendance-color">${cols[1]}</td>
                                <td class="text-right cumulative">${cols[2]}</td>
                                <td class="text-right today overheads-color">${cols[3]}</td>
                                <td class="text-right cumulative">${cols[4]}</td>
                                <td class="text-right today production-color">${cols[5]}</td>
                                <td class="text-right cumulative">${cols[6]}</td>
                                <td class="text-right today sales-color">${cols[7]}</td>
                                <td class="text-right cumulative">${cols[8]}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            <div class="footer">
                <span>Generated on: ${new Date().toLocaleString('en-IN')}</span>
                <span>Signature: __________________________</span>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
};

const formatReportDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' });
};

export const exportToExcel = () => {
    const table = document.getElementById('daily-summary-report-table');
    const start = document.getElementById('summary-report-start-date')?.value;
    const end = document.getElementById('summary-report-end-date')?.value;
    if (!table) return;
    
    let csv = "Date,Attendance (Today),Attendance (Cumulative),Overheads (Today),Overheads (Cumulative),Production (Today),Production (Cumulative),Sales (Today),Sales (Cumulative)\n";
    table.querySelectorAll('tbody tr').forEach(tr => {
        const cols = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.replace(/₹|,/g, '').trim());
        if (cols.length > 1) csv += cols.join(',') + "\n";
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Daily_Summary_Report_${start}_to_${end}.csv`;
    a.click();
};
