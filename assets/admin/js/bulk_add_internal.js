import { addOrder } from "./db.js";

// Full data from spreadsheet including delivery columns
// These will be added as 'internal_order' type, so they won't show in Delivery Report (filtered out)
const internalOrders = [
    // --- DECEMBER 2025 ---
    { internalOrderNo: '202526-442', date: '2025-12-20', description: 'Temp controller bracket', itemCode: 'NO.MHS234EP014', qty: 6, saleValueEa: 350, total: 2100, customer: 'baliga', poNo: 'BLE/00254671', poDate: '2025-12-18', deliveryDateActual: '2026-02-02', dcNo: '4872', deliveryQty: 6, status: 'Delivered' },
    { internalOrderNo: '202526-444', date: '2025-12-20', description: 'Sensor fixing bracket', itemCode: '54M50ESBK 01', qty: 5, saleValueEa: 1759, total: 8795, customer: 'baliga', poNo: 'BLE/00254671', poDate: '2025-12-18', status: 'Delivered' }, // Status inferred from green color in image
    { internalOrderNo: '202526-450', date: '2025-12-20', description: '3.5 Lt Top Flange', itemCode: '', qty: 1, saleValueEa: 4000, total: 4000, customer: 'Biojenik', deliveryDateActual: '2026-02-02', dcNo: '4871', deliveryQty: 1, status: 'Delivered' },
    { internalOrderNo: '202526-456', date: '2025-12-20', description: '12mm Retainer part', itemCode: '', qty: 100, saleValueEa: 160, total: 16000, customer: 'Biojenik', deliveryDateActual: '2026-01-28', dcNo: '4854', status: 'Delivered' },
    { internalOrderNo: '202526-461', date: '2025-12-25', description: 'crane arrangement', itemCode: '', qty: 1, saleValueEa: 32000, total: 32000, customer: 'Raja Hardwares', status: 'Delivered' },

    // --- JANUARY 2026 ---
    { internalOrderNo: '202526-478', date: '2026-01-07', description: 'Twin body mounting bracket', itemCode: 'BR 251080 02', qty: 6, saleValueEa: 2250, total: 13500, customer: 'baliga', poNo: 'BLE/00255048', poDate: '2026-01-06', status: 'Pending' },
    { internalOrderNo: '202526-479', date: '2026-01-08', description: 'pipe', itemCode: '350810049', qty: 6, saleValueEa: 560, prodValueEa: 275, total: 1650, customer: 'baliga', poNo: 'BLE/00255048', poDate: '2026-01-10', deliveryDateActual: '2026-02-04', dcNo: '4879', deliveryQty: 6, status: 'Delivered' },
    { internalOrderNo: '202526-488', date: '2026-01-08', description: 'Trolley', itemCode: '', qty: 1, total: 0, customer: 'pillar', status: 'Pending' },
    { internalOrderNo: '202526-492', date: '2026-01-15', description: 'fixing strap', itemCode: 'FS 251001 22', qty: 4, total: 0, customer: 'baliga', poNo: 'BLE/00250079', status: 'Pending' },
    { internalOrderNo: '202526-495', date: '2026-01-10', description: 'motor test setup', itemCode: '', qty: 1, saleValueEa: 55000, total: 55000, customer: 'bray', poNo: 'BTS1/01/2026', poDate: '2026-01-08', status: 'Pending' },
    { internalOrderNo: '202526-496', date: '2026-01-12', description: 'Twin body mounting bracket', itemCode: 'BR 250785 14', qty: 4, saleValueEa: 2250, total: 9000, customer: 'baliga', poNo: 'BLE/00255155', poDate: '2026-01-10', status: 'Pending' },
    { internalOrderNo: '202526-497', date: '2026-01-19', description: 'pipe M20x1.5P', itemCode: '350810049', qty: 4, saleValueEa: 560, prodValueEa: 275, total: 1100, customer: 'baliga', poNo: 'BLE/00255155', poDate: '2026-01-10', deliveryDateActual: '2026-02-04', dcNo: '4880', deliveryQty: 4, status: 'Delivered' },
    { internalOrderNo: '202526-503', date: '2026-01-19', description: 'Twin body mounting bracket', itemCode: 'BR 250785 14', qty: 6, saleValueEa: 2250, total: 13500, customer: 'baliga', poNo: 'BLE/00255215', poDate: '2026-01-14', status: 'Pending' },
    { internalOrderNo: '202526-504', date: '2026-01-22', description: 'pipe M20x1.5P', itemCode: '350810049', qty: 6, saleValueEa: 560, prodValueEa: 275, total: 1650, customer: 'baliga', poNo: 'BLE/00255215', poDate: '2026-01-14', deliveryDateActual: '2026-02-04', dcNo: '4881', deliveryQty: 6, status: 'Delivered' },
    { internalOrderNo: '202526-505', date: '2026-01-19', description: 'J bracket', itemCode: 'No. PA 250918 01', qty: 13, saleValueEa: 1075, total: 13975, customer: 'baliga', poNo: 'BLE/00255233', poDate: '2026-01-19', status: 'In Progress' },
    { internalOrderNo: '202526-506', date: '2026-01-20', description: 'interconnecting nipple', itemCode: 'NI 250350 50', qty: 10, saleValueEa: 820, total: 8200, customer: 'baliga', poNo: 'BLE/00255245', poDate: '2026-01-19', status: 'In Progress' },
    { internalOrderNo: '202526-507', date: '2026-01-20', description: 'Hot Air sealing system', itemCode: 'MHS346AC07,09,10& 11', qty: 5, saleValueEa: 9273, total: 46365, customer: 'baliga', poNo: 'BLE/00255254', poDate: '2026-01-19', status: 'In Progress' },
    { internalOrderNo: '202526-510', date: '2026-01-21', description: 'fixing strap', itemCode: 'ES251141 02', qty: 4, saleValueEa: 326.04, total: 1304.16, customer: 'baliga', poNo: 'BLE/00250079', status: 'Pending' },
    { internalOrderNo: '202526-513', date: '2026-01-22', description: 'light Testing Fixture', itemCode: '', qty: 100, saleValueEa: 550, total: 55000, status: 'Pending' },
    { internalOrderNo: '202526-514', date: '2026-01-23', description: 'fixing frame', itemCode: '350450079', qty: 1, total: 0, customer: 'baliga', poNo: 'BLE/00250079', status: 'Pending' },
    { internalOrderNo: '202526-515', date: '2026-01-28', description: 'MPC Adaptor 1/2 to 12.7', itemCode: 'BE-GG2-75L MFC CONNETOR-01-A', qty: 8, saleValueEa: 300, total: 2400, customer: 'biojenik', status: 'Pending' },
    { internalOrderNo: '202526-516', date: '2026-01-28', description: 'fixing frame', itemCode: 'No.350450529', qty: 4, saleValueEa: 424, total: 1696, customer: 'baliga', poNo: 'BLE/00255417', poDate: '2026-01-28', status: 'Pending' },
    { internalOrderNo: '202526-517', date: '2026-01-28', description: 'din channel', itemCode: 'NO. DN 250458 04', qty: 2, saleValueEa: 150, prodValueEa: 60, total: 300, customer: 'baliga', poNo: 'BLE/00255383', poDate: '2026-01-27', deliveryDateActual: '2026-02-02', dcNo: '4874', deliveryQty: 2, status: 'Delivered' },
    { internalOrderNo: '202526-518', date: '2026-01-28', description: 'din channel', itemCode: 'NO. DN 250458 01', qty: 6, saleValueEa: 150, prodValueEa: 60, total: 900, customer: 'baliga', poNo: 'BLE/00255383', poDate: '2026-01-27', deliveryDateActual: '2026-02-02', dcNo: '4874', deliveryQty: 6, status: 'Delivered' },
    { internalOrderNo: '202526-519', date: '2026-01-28', description: 'din channel', itemCode: 'NO. DN 250458 01', qty: 2, saleValueEa: 132, prodValueEa: 60, total: 264, customer: 'baliga', poNo: 'BLE/00255383', poDate: '2026-01-27', deliveryDateActual: '2026-02-02', dcNo: '4874', deliveryQty: 2, status: 'Delivered' },

    // --- FEBRUARY 2026 ---
    { internalOrderNo: '202526-520', date: '2026-02-02', description: 'fixing strap', itemCode: 'FS 250942', qty: 446, saleValueEa: 382.8, prodValueEa: 185.6, total: 170728.8, customer: 'baliga', poNo: 'BLE/00250079', poDate: '2026-02-02', status: 'In Progress' },
    { internalOrderNo: '202526-521', date: '2026-02-02', description: '200dx30 thick plate machining', itemCode: '', qty: 1, total: 0, customer: 'gk', status: 'Pending' },
    { internalOrderNo: '202526-522', date: '2026-02-02', description: 'Frame small', itemCode: '', qty: 1, total: 0, customer: 'gk', status: 'Pending' },
    { internalOrderNo: '202526-523', date: '2026-02-02', description: 'ss duct od941*id800mm', itemCode: 'IPX/MFG/121', qty: 1, saleValueEa: 45000, total: 45000, customer: 'INSAPLEX', poNo: 'FA516/25-26', poDate: '2026-01-09', deliveryDateActual: '2026-02-03', dcNo: '4875', deliveryQty: 1, status: 'Delivered' },
    { internalOrderNo: '202526-524', date: '2026-02-02', description: 'GI SHEET', itemCode: '', qty: 3, saleValueEa: 1000, total: 3000, customer: 'baliga', deliveryDateActual: '2026-02-03', dcNo: '4876', deliveryQty: 3, status: 'Delivered' },
    { internalOrderNo: '202526-525', date: '2026-02-02', description: 'Inner plate GI 2mm th', itemCode: '', qty: 2, total: 0, customer: 'baliga', status: 'Pending' },
    { internalOrderNo: '202526-526', date: '2026-02-02', description: 'welding column', itemCode: '', qty: 500, saleValueEa: 94.5, prodValueEa: 35, total: 47250, customer: 'barqs', status: 'Pending' },
    { internalOrderNo: '202526-527', date: '2026-02-02', description: 'welding column', itemCode: '', qty: 100, saleValueEa: 94.5, prodValueEa: 40, total: 9450, customer: 'barqs', status: 'Pending' },
    { internalOrderNo: '202526-528', date: '2026-02-03', description: 'GK frame', itemCode: '', qty: 1, total: 0, customer: 'gk', status: 'Pending' },
    { internalOrderNo: '202526-529', date: '2026-02-04', description: 'din channel', itemCode: '', qty: 4, saleValueEa: 170, prodValueEa: 60, total: 240, customer: 'baliga', poNo: 'BLE/00255563', poDate: '2026-01-30', deliveryDateActual: '2026-02-04', dcNo: '4882', deliveryQty: 4, status: 'Delivered' },
    { internalOrderNo: '202526-530', date: '2026-02-04', description: 'din channel', itemCode: '', qty: 2, saleValueEa: 170, prodValueEa: 60, total: 120, customer: 'baliga', poNo: 'BLE/00255563', poDate: '2026-01-30', deliveryDateActual: '2026-02-04', dcNo: '4882', deliveryQty: 2, status: 'Delivered' },
    { internalOrderNo: '202526-531', date: '2026-02-04', description: 'fixing strap', itemCode: '', qty: 10, saleValueEa: 158.4, prodValueEa: 76.8, total: 1584, customer: 'baliga', poNo: 'BLE/00250079', status: 'Pending' },
    { internalOrderNo: '202526-532', date: '2026-02-05', description: 'TORQUE SENSOR', itemCode: '970000-10533', qty: 1, saleValueEa: 6500, prodValueEa: 3500, total: 6500, customer: 'braycontrols', status: 'Pending' },
    { internalOrderNo: '202526-533', date: '2026-02-06', description: 'fixing strap', itemCode: 'FS251232 01', qty: 8, total: 0, customer: 'baliga', deliveryDateActual: '2026-02-06', dcNo: '4886', deliveryQty: 8, status: 'Delivered' },

    // --- ADDITIONAL BOTTOM ENTRIES (FEB 2026) ---
    // REMOVED AS PER USER REQUEST (7 Entries)
    // { internalOrderNo: '', date: '2026-02-05', description: 'brick conveyer', itemCode: '', qty: 1, total: 120000, customer: 'm-fac', deliveryDateActual: '2026-02-05', dcNo: '4884', deliveryQty: 1, status: 'Delivered' },
    // { internalOrderNo: '', date: '2026-02-05', description: 'fixing strap', itemCode: 'FS250942 01', qty: 140, total: 48378, customer: 'baliga', deliveryDateActual: '2026-02-05', dcNo: '4883', deliveryQty: 140, status: 'Delivered' },
    // { internalOrderNo: '', date: '2026-02-06', description: 'fixing strap', itemCode: 'FS250992 03', qty: 4, total: 1155, customer: 'baliga', deliveryDateActual: '2026-02-06', dcNo: '4887', deliveryQty: 4, status: 'Delivered' },
    // { internalOrderNo: '', date: '2026-02-06', description: 'fixing strap', itemCode: 'FS251001 22', qty: 4, total: 1155, customer: 'baliga', deliveryDateActual: '2026-02-06', dcNo: '4887', deliveryQty: 4, status: 'Delivered' },
    // { internalOrderNo: '', date: '2026-02-06', description: 'fixing strap', itemCode: 'FS251232 01', qty: 8, total: 2772, customer: 'baliga', deliveryDateActual: '2026-02-06', dcNo: '4886', deliveryQty: 8, status: 'Delivered' },
    // { internalOrderNo: '', date: '2026-02-06', description: 'fixing strap', itemCode: 'FS250942 01', qty: 35, total: 12127, customer: 'baliga', deliveryDateActual: '2026-02-06', dcNo: '4886', deliveryQty: 35, status: 'Delivered' },
    // { internalOrderNo: '', date: '2026-02-06', description: 'crane arrangement', itemCode: '', qty: 1, total: 32000, customer: 'raja hardwars', deliveryDateActual: '2026-02-06', dcNo: '4886', deliveryQty: 1, status: 'Delivered' }
];

async function bulkAddInternal() {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = "Starting FULL bulk internal addition (WITH DELIVERY DATA)...<br>";

    let successCount = 0;
    for (let i = 0; i < internalOrders.length; i++) {
        const order = internalOrders[i];

        const data = {
            ...order,
            entryType: 'internal_order',
            drgAvail: order.drgAvail || 'n',
            rawAvail: order.rawAvail || 'n',
            finishAvail: order.finishAvail || 'n',
            priority: 'Medium'
        };

        statusDiv.innerHTML = `Adding ${i + 1}/${internalOrders.length}: ${order.internalOrderNo || order.description}... `;
        const result = await addOrder(data);
        if (result.error) {
            statusDiv.innerHTML += `<span style="color: red;">Error: ${result.error}</span><br>`;
        } else {
            successCount++;
            statusDiv.innerHTML += `<span style="color: green;">Success</span><br>`;
        }
    }
    statusDiv.innerHTML += `<br><strong>Done! Successfully added ${successCount} entries (Full).</strong>`;
}

window.runBulkAddInternal = bulkAddInternal;
