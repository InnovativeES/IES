/**
 * ==========================================================================
 * IES MULTI-UNIT CONFIGURATION & STATE MANAGER
 * Supports Unit 1 (Echangadu) and Unit 2 (Thirumudivakkam)
 * ==========================================================================
 */

export const UNITS = {
    unit1: {
        id: 'unit1',
        code: 'U1',
        name: 'UNIT 1 — Echangadu',
        shortName: 'Unit 1 (Echangadu)',
        facility: 'Main Works & SPMs',
        location: 'Echangadu, Chennai',
        address: 'Plot 19, Self Help Industrial Estate, Echangadu, Chennai - 600117',
        state: 'Tamil Nadu',
        country: 'India',
        color: '#10b981', // emerald
        badgeBg: '#ecfdf5',
        badgeText: '#047857',
        badgeBorder: '#a7f3d0'
    },
    unit2: {
        id: 'unit2',
        code: 'U2',
        name: 'UNIT 2 — Thirumudivakkam',
        shortName: 'Unit 2 (Thirumudivakkam)',
        facility: 'Precision Works & New Facility',
        location: 'Thirumudivakkam, Chennai',
        address: 'Thirumudivakkam Industrial Estate, Chennai - 600044',
        state: 'Tamil Nadu',
        country: 'India',
        color: '#6366f1', // indigo
        badgeBg: '#eef2ff',
        badgeText: '#4338ca',
        badgeBorder: '#c7d2fe'
    }
};

const STORAGE_KEY = 'ies_active_unit';
const SESSION_PROMPTED_KEY = 'ies_unit_prompted_session';

/**
 * Get current active unit ID ('unit1' | 'unit2')
 */
export function getActiveUnit() {
    const val = localStorage.getItem(STORAGE_KEY);
    return val === 'unit2' ? 'unit2' : 'unit1';
}

/**
 * Set current active unit ID
 */
export function setActiveUnit(unitId) {
    if (!UNITS[unitId]) unitId = 'unit1';
    localStorage.setItem(STORAGE_KEY, unitId);
    sessionStorage.setItem(SESSION_PROMPTED_KEY, 'true');
}

/**
 * Check if user has explicitly selected a unit during this session
 */
export function hasSessionUnitSelection() {
    return sessionStorage.getItem(SESSION_PROMPTED_KEY) === 'true';
}

export function markSessionUnitPrompted() {
    sessionStorage.setItem(SESSION_PROMPTED_KEY, 'true');
}

/**
 * Get active unit configuration details
 */
export function getActiveUnitConfig() {
    const unitId = getActiveUnit();
    return UNITS[unitId] || UNITS.unit1;
}

/**
 * Dynamic Collection Name Router:
 * - Unit 1 uses base collection name (zero migration, zero risk to existing data)
 * - Unit 2 uses baseName_u2
 */
export function getCollectionName(baseName) {
    const unitId = getActiveUnit();
    if (unitId === 'unit2') {
        return `${baseName}_u2`;
    }
    return baseName;
}

if (typeof window !== 'undefined') {
    window.Units = {
        UNITS,
        getActiveUnit,
        setActiveUnit,
        hasSessionUnitSelection,
        markSessionUnitPrompted,
        getActiveUnitConfig,
        getCollectionName
    };
}
