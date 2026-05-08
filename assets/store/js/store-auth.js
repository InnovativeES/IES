import { auth } from '../../../firebase-config.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Admin login (email/password)
export const loginAdmin = async (email, password) => {
    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        return { user: cred.user, error: null };
    } catch (err) {
        console.error('Login error:', err);
        return { user: null, error: err.message };
    }
};

// Google Sign-In (for customers on storefront)
const googleProvider = new GoogleAuthProvider();
export const loginWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        return { user: result.user, error: null };
    } catch (err) {
        console.error('Google login error:', err);
        return { user: null, error: err.message };
    }
};

// Logout
export const logout = async () => {
    try {
        await signOut(auth);
        return true;
    } catch (err) {
        console.error('Logout error:', err);
        return false;
    }
};

// Auth state listener
export const onAuthChange = (callback) => {
    return onAuthStateChanged(auth, callback);
};

export { auth };
