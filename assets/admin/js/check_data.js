import { db } from "./firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

async function checkData() {
    console.log("Checking all orders...");
    const snapshot = await getDocs(collection(db, "internal_orders"));

    let internalCount = 0;
    let deliveryReportCount = 0;
    let undefinedTypeCount = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`ID: ${doc.id}, Type: ${data.entryType}, Status: ${data.status}`);

        if (data.entryType === 'internal_order') internalCount++;
        else if (data.entryType === 'delivery_report') deliveryReportCount++;
        else undefinedTypeCount++;
    });

    console.log("--- SUMMARY ---");
    console.log(`Internal Orders: ${internalCount}`);
    console.log(`Delivery Report: ${deliveryReportCount}`);
    console.log(`Undefined Type : ${undefinedTypeCount}`);
    console.log(`Total Docs     : ${snapshot.size}`);

    document.body.innerHTML += `<pre>
    Internal Orders: ${internalCount}
    Delivery Report: ${deliveryReportCount}
    Undefined Type : ${undefinedTypeCount}
    Total Docs     : ${snapshot.size}
    Check console for details.
    </pre>`;
}

window.checkData = checkData;
checkData();
