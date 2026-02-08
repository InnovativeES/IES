import { addOrder } from "./db.js";

const entries = [
    // 02-02-2026
    { date: '2026-02-02', customer: 'baliga', itemCode: 'CANOPY GI SHEET', description: '', qty: 1, total: 2000, department: 'Fab', labourCost: 500, dcNo: '4870' },
    { date: '2026-02-02', customer: 'BIOJENIK', itemCode: '3.5LT TOP FLANGE', description: '', qty: 1, total: 4000, department: 'VMC', labourCost: 2500, dcNo: '4871' },
    { date: '2026-02-02', customer: 'baliga', itemCode: 'dinchannel DN250458 04', description: '', qty: 2, total: 300, department: 'Fab', dcNo: '4874' },
    { date: '2026-02-02', customer: 'baliga', itemCode: 'dinchannel DN250458 01', description: '', qty: 4, total: 900, department: 'Fab', dcNo: '4874' },
    { date: '2026-02-02', customer: 'baliga', itemCode: 'dinchannel DN250458 01', description: '', qty: 2, total: 264, department: 'Fab', dcNo: '4874', manpower: 16800 },

    // 03-02-2026
    { date: '2026-02-03', customer: 'INSAPLEX', itemCode: 'SS DUCT OD941mm*id800', description: '', qty: 1, total: 45000, department: 'Fab', labourCost: 15000, dcNo: '4875' },
    { date: '2026-02-03', customer: 'baliga', itemCode: 'caNOPY GI SHEET', description: '', qty: 3, total: 3000, department: 'Fab', labourCost: 1200, dcNo: '4876', manpower: 18000 },

    // 04-02-2026
    { date: '2026-02-04', customer: 'baliga', itemCode: 'pipe M20*1.5P', description: '', qty: 6, total: 3360, department: 'CNC', labourCost: 1650, dcNo: '4879' },
    { date: '2026-02-04', customer: 'baliga', itemCode: 'pipe M20*1.5P', description: '', qty: 4, total: 2240, department: 'CNC', labourCost: 1100, dcNo: '4880' },
    { date: '2026-02-04', customer: 'baliga', itemCode: 'pipe M20*1.5P', description: '', qty: 6, total: 3360, department: 'CNC', labourCost: 1650, dcNo: '4881' },
    { date: '2026-02-04', customer: 'baliga', itemCode: 'din channel', description: '', qty: 4, total: 680, department: 'Fab', labourCost: 240, dcNo: '4882' },
    { date: '2026-02-04', customer: 'baliga', itemCode: 'din channel', description: '', qty: 2, total: 340, department: 'Fab', labourCost: 120, dcNo: '4882', manpower: 18000 },

    // 05-02-2026
    { date: '2026-02-05', customer: 'baliga', itemCode: 'fixing strap FS250942 01', description: '', qty: 140, total: 48378, department: 'Fab', labourCost: 25984, dcNo: '4883' },
    { date: '2026-02-05', customer: 'm-fac', itemCode: 'brick conveyer', description: '', qty: 1, total: 120000, department: 'Fab', labourCost: 120000, dcNo: '4884', manpower: 18000 },

    // 06-02-2026
    { date: '2026-02-06', customer: 'raja hardwars', itemCode: 'crane arrangement', description: '', qty: 1, total: 32000, department: 'Fab', labourCost: 32000, dcNo: '' },
    { date: '2026-02-06', customer: 'baliga', itemCode: 'fixing strap FS250942 01', description: '', qty: 35, total: 12127, department: 'Fab', labourCost: 2975, dcNo: '4886' },
    { date: '2026-02-06', customer: 'baliga', itemCode: 'fixing strap FS251232 01', description: '', qty: 8, total: 2772, department: 'Fab', labourCost: 680, dcNo: '4886', manpower: 18000 },

    // 06-02-2026 (Part 2)
    { date: '2026-02-06', customer: 'baliga', itemCode: 'fixing strap FS251001 22', description: '', qty: 4, total: 1155, department: 'VMC', labourCost: 400, dcNo: '4887' },
    { date: '2026-02-06', customer: 'baliga', itemCode: 'fixing strap FS250992 03', description: '', qty: 4, total: 1155, department: 'VMC', labourCost: 400, dcNo: '4887', manpower: 16800 }
];

async function bulkAdd() {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = "Starting bulk addition...<br>";

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const orderData = {
            ...entry,
            deliveryDateActual: entry.date,
            deliveryQty: entry.qty,
            status: 'Delivered',
            entryType: 'delivery_report',
            saleValueEa: 0,
            prodValueEa: 0,
            priority: 'Medium',
            drgAvail: 'n',
            rawAvail: 'n',
            finishAvail: 'n'
        };

        statusDiv.innerHTML += `Adding ${i + 1}/${entries.length}: ${entry.customer} - ${entry.itemCode}... `;
        const result = await addOrder(orderData);
        if (result.error) {
            statusDiv.innerHTML += `<span style="color: red;">Error: ${result.error}</span><br>`;
        } else {
            statusDiv.innerHTML += `<span style="color: green;">Success</span><br>`;
        }
    }
    statusDiv.innerHTML += "<br><strong>Done!</strong>";
}

window.runBulkAdd = bulkAdd;
