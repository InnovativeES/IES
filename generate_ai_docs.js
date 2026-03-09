const fs = require('fs');
const path = require('path');

const rootDir = 'e:/re/Innovative Engineering Solutions';
const outputMd = path.join(rootDir, 'IES_AI_Knowledge_Base.md');

const treeStructure = `
## 1. Complete Directory Structure
\`\`\`text
Innovative Engineering Solutions/
├── index.html                   (Public Marketing Site)
├── admin.html                   (Internal CRM Portal)
├── firebase-config.js           (Firebase configuration & initialization)
├── styles.css                   (Global styles for public site)
├── package.json                 (Node dependencies)
├── assets/
│   ├── admin/
│   │   ├── css/
│   │   │   ├── admin.css        (Core layout & theme)
│   │   │   ├── delivery-modal.css
│   │   │   ├── pm-theme.css     (Premium Project Management Theme)
│   │   │   ├── project.css      (Project Specific Customizations)
│   │   │   └── tailwind.css     (Local Tailwind Build)
│   │   └── js/
│   │       ├── app.js           (Main entry, routing, state management)
│   │       ├── auth.js          (Firebase Auth wrappers)
│   │       ├── db.js            (Firestore CRUD abstractions)
│   │       ├── ui.js            (Modals, Toasts, Reusable UI)
│   │       ├── monitoring.js    (Internal Orders logic)
│   │       ├── kanban.js        (Pending Assignment logic)
│   │       ├── inventory.js     (Inventory & Ledger logic)
│   │       ├── charts.js        (D3.js dashboard charts)
│   │       ├── workflow.js      (Project Management logic)
│   │       ├── bulk_add.js      (Bulk Import UI logic)
│   │       ├── bulk_add_internal.js
│   │       ├── cleanup_internal.js
│   │       └── check_data.js
\`\`\`
`;

const markdownIntro = `
# IES: AI Engineering Knowledge Base & Rebuilding Guide

**Purpose**: This document contains the EXHAUSTIVE architectural details, file structures, schemas, and core implementation code for the "Innovative Engineering Solutions" (IES) platform. It is designed to be fed into an AI coding agent to instantly grant it 100% context of the application, enabling it to rebuild, extend, or maintain the site without hallucinating.

---

## Architecture Overview
1. **Frontend Landing Page (index.html)**: High-performance, SEO-friendly HTML with vanilla JS and CSS.
2. **Secure Admin CRM (admin.html)**: Single-Page Application (SPA) mechanics built entirely with Vanilla JavaScript (ES10+). It features custom tab-routing, dynamic DOM updates, and complex modular states.
3. **Backend as a Service (Firebase v10)**: Utilizes Firestore for NoSQL document storage, Firebase Auth for security, and Firebase Storage for handling images (like inventory tool photos).

---

## 2. Firebase Database Schema Design
* **internal_orders**: internalOrderNo, customer, poNo, drgNo, description, qty, deliveryDate, status, prices, drawings.
* **roster_assignments**: employeeId, date, department, machine, ioNo, productionCostUnit, totalProductionValue.
* **projects**: projectId, customer, description, status, members.
* **inventory**: Items, stock, and transaction logs.

---

## 3. Core Implementation Files

`;

let fullMd = markdownIntro + treeStructure;

const appendFile = (title, filepath, language) => {
    fullMd += "\\n\\n### File: " + filepath.replace(rootDir + '/', '') + "\\n";
    fullMd += "*Description: " + title + "*\\n\\n";
    fullMd += "\`\`\`" + language + "\\n";

    try {
        const content = fs.readFileSync(filepath, 'utf8');
        fullMd += content + "\\n";
    } catch (e) {
        fullMd += "> Error reading file: " + e.message + "\\n";
    }
    fullMd += "\`\`\`\\n";
}

appendFile('Firebase Config', path.join(rootDir, 'firebase-config.js'), 'javascript');
appendFile('DB Operations Layer', path.join(rootDir, 'assets/admin/js/db.js'), 'javascript');
appendFile('Auth Operations Layer', path.join(rootDir, 'assets/admin/js/auth.js'), 'javascript');
appendFile('Internal Orders Logic', path.join(rootDir, 'assets/admin/js/monitoring.js'), 'javascript');
appendFile('Project Workflow Logic', path.join(rootDir, 'assets/admin/js/workflow.js'), 'javascript');
appendFile('Admin Core Logic (Routing)', path.join(rootDir, 'assets/admin/js/app.js'), 'javascript');
appendFile('Admin Styles (Subsets)', path.join(rootDir, 'assets/admin/css/pm-theme.css'), 'css');
appendFile('Admin Dashboard Layout Structure', path.join(rootDir, 'admin.html'), 'html');

fs.writeFileSync(outputMd, fullMd, 'utf8');
console.log('Knowledge Base MD generated successfully.');
