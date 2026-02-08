import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDA053MUUIG7vG17XLwJGsDqTKF_N-ND0Y",
    authDomain: "ies-crm.firebaseapp.com",
    projectId: "ies-crm",
    storageBucket: "ies-crm.firebasestorage.app",
    messagingSenderId: "37296676137",
    appId: "1:37296676137:web:792fa3a9c01204e3e22b38"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
