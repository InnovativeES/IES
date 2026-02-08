import { db } from "./firebase-config.js";
import { collection, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

async function cleanupAllOrders() {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = "Cleaning up ALL internal orders and delivery reports...<br>";

    // Delete everything in internal_orders collection
    const snapshot = await getDocs(collection(db, "internal_orders"));

    statusDiv.innerHTML += `Found ${snapshot.size} entries to delete.<br>`;

    let deleted = 0;
    for (const document of snapshot.docs) {
        await deleteDoc(doc(db, "internal_orders", document.id));
        deleted++;
        statusDiv.innerHTML = `Cleaning up... ${deleted}/${snapshot.size}`;
    }

    statusDiv.innerHTML += "<br><strong>Cleanup Done! All data wiped.</strong>";
}

window.runCleanup = cleanupAllOrders;
