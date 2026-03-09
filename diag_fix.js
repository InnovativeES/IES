
import { db } from "./firebase-config.js";
import { collection, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

async function diagnoseAndFix() {
    console.log("Starting diagnosis...");
    const snap = await getDocs(collection(db, "daily_workflows"));
    console.log(`Found ${snap.size} workflow documents.`);

    let updatedCount = 0;
    for (const d of snap.docs) {
        const data = d.data();
        const assignments = data.assignments || [];
        const projectIds = [...new Set(assignments.map(a => a.orderNo).filter(id => id && id !== 'Ad-hoc'))];

        console.log(`Doc ${d.id}: Assignments=${assignments.length}, Projects=[${projectIds.join(', ')}]`);

        // If index is missing or outdated, update it
        if (!data.projectIds || JSON.stringify(data.projectIds.sort()) !== JSON.stringify(projectIds.sort())) {
            console.log(`Updating index for ${d.id}...`);
            await updateDoc(doc(db, "daily_workflows", d.id), { projectIds });
            updatedCount++;
        }
    }
    console.log(`Finished. Updated ${updatedCount} documents.`);
}

diagnoseAndFix();
