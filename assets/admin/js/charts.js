// charts.js - Modern Professional Organization Chart

/**
 * Renders a sleek, modern organization chart
 */
export const renderHierarchy = (members, containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const displayMembers = members || [];

    // Helper to get roles/depts robustly (case-insensitive)
    const getRoles = (m) => {
        let r = (m.orgRoles || []).map(role => role.toLowerCase().trim());
        if (m.role) {
            const lowRole = m.role.toLowerCase().trim();
            if (!r.includes(lowRole)) r.push(lowRole);
        }
        if (m.designation) {
            const lowDesig = m.designation.toLowerCase().trim();
            if (!r.includes(lowDesig)) r.push(lowDesig);
        }
        return r;
    };

    const getDepts = (m) => {
        let d = (m.departments || []).map(dept => dept.toLowerCase().trim());
        if (m.department) {
            const lowDept = m.department.toLowerCase().trim();
            if (!d.includes(lowDept)) d.push(lowDept);
        }
        if (m.section) {
            const lowSect = m.section.toLowerCase().trim();
            if (!d.includes(lowSect)) d.push(lowSect);
        }
        return d;
    };

    // Helper to find members (supports multi-department)
    const findMembers = (criteria) => {
        return displayMembers.filter(m => {
            const roles = getRoles(m);
            const depts = getDepts(m);

            if (criteria.role) {
                const target = criteria.role.toLowerCase().trim();
                return roles.includes(target);
            }
            if (criteria.employeeType) {
                const target = criteria.employeeType.toLowerCase().trim();
                return (m.employeeType && m.employeeType.toLowerCase().trim() === target) || roles.includes(target);
            }
            if (criteria.department) {
                const target = criteria.department.toLowerCase().trim();
                return depts.includes(target);
            }
            return false;
        });
    };

    // Find key people
    const director = findMembers({ role: 'Director' })[0] || findMembers({ role: 'Managing Director' })[0];
    const bdm = findMembers({ role: 'Business Development Manager' })[0] || findMembers({ role: 'Business Development' })[0];

    const fabTeam = findMembers({ department: 'Fabrication' });
    const cncTeam = findMembers({ department: 'CNC & VMC' });
    const spmTeam = findMembers({ department: 'SPM' });
    const hrTeam = findMembers({ department: 'HR' });

    // Compact member card
    const createCard = (member, isHead = false) => {
        if (!member) return `<div class="org-empty">Not Assigned</div>`;
        const initials = member.name.split(' ').map(n => n[0]).join('').substring(0, 2);

        const roles = getRoles(member);
        const roleDisplay = member.designation || member.role || roles[0] || 'Team Member';

        const cardStyle = isHead
            ? 'background: linear-gradient(135deg, #334155 0%, #1e293b 100%); color: white; border: none;'
            : 'background: white; border: 1px solid #e2e8f0; color: #1e293b;';
        const avatarStyle = isHead
            ? 'background: rgba(255,255,255,0.1); color: white;'
            : 'background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white;';

        return `
            <div class="org-card ${isHead ? 'org-head' : ''}" style="${cardStyle}">
                <div class="org-avatar" style="${avatarStyle}">${initials}</div>
                <div class="org-info">
                    <div class="org-name" style="${isHead ? 'color: white;' : ''}">${member.name}</div>
                    <div class="org-role" style="${isHead ? 'color: #94a3b8;' : ''}">${roleDisplay}</div>
                </div>
            </div>
        `;
    };

    // Section with head and team
    const createSection = (name, icon, color, members) => {
        const sectionHead = members.find(m => {
            const roles = getRoles(m);
            const depts = getDepts(m);
            return (roles.includes('section head') || roles.includes('manager') || (m.employeeType && m.employeeType.toLowerCase() === 'manager')) && depts.includes(name.toLowerCase());
        });
        const teamMembers = members.filter(m => m !== sectionHead);

        return `
            <div class="org-dept" style="--dept-color: ${color};">
                <div class="org-dept-header" style="background: ${color};">
                    <span class="org-dept-icon">${icon}</span>
                    <span class="org-dept-name">${name}</span>
                    <span class="org-dept-count">${members.length}</span>
                </div>
                <div class="org-dept-body">
                    ${sectionHead ? createCard(sectionHead, true) : '<div class="org-empty">No Head</div>'}
                    ${teamMembers.length > 0 ? `
                        <div class="org-team-divider"></div>
                        <div class="org-team">
                            ${teamMembers.map(m => createCard(m)).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    };

    // Inline CSS for the modern chart
    const styles = `
        <style>
            .org-container {
                padding: 1.5rem;
                background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                border-radius: 12px;
                min-height: 400px;
            }
            .org-header {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 1rem;
                padding: 1rem 1.5rem;
                background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
                border-radius: 10px;
                margin-bottom: 1.5rem;
            }
            .org-header-icon {
                width: 36px;
                height: 36px;
                background: rgba(255,255,255,0.1);
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .org-header-icon svg { width: 20px; height: 20px; stroke: #94a3b8; }
            .org-header-text h2 { 
                font-size: 1rem; 
                font-weight: 700; 
                color: #ffffff !important; 
                margin: 0;
            }
            .org-header-text p { 
                font-size: 0.75rem; 
                color: #94a3b8 !important; 
                margin: 0;
            }
            
            .org-leadership {
                display: flex;
                justify-content: center;
                gap: 2rem;
                margin-bottom: 1.5rem;
            }
            .org-leader {
                text-align: center;
            }
            .org-leader-label {
                font-size: 0.625rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #64748b;
                margin-bottom: 0.5rem;
                font-weight: 600;
            }
            
            .org-departments {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 1rem;
            }
            
            .org-dept {
                background: white;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                border: 1px solid #e2e8f0;
            }
            .org-dept-header {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.625rem 0.75rem;
                color: white;
                font-weight: 600;
                font-size: 0.75rem;
            }
            .org-dept-icon { opacity: 0.9; font-size: 0.875rem; }
            .org-dept-name { flex: 1; }
            .org-dept-count { 
                background: rgba(255,255,255,0.2);
                padding: 0.125rem 0.5rem;
                border-radius: 99px;
                font-size: 0.625rem;
            }
            .org-dept-body {
                padding: 0.75rem;
            }
            
            .org-card {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.5rem;
                border-radius: 8px;
                margin-bottom: 0.375rem;
                transition: all 0.15s ease;
            }
            .org-card:last-child { margin-bottom: 0; }
            .org-card:not(.org-head):hover {
                background: #f8fafc;
                transform: translateX(2px);
            }
            .org-avatar {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 600;
                font-size: 0.625rem;
                flex-shrink: 0;
            }
            .org-info { min-width: 0; }
            .org-name { 
                font-size: 0.75rem; 
                font-weight: 600; 
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .org-role { 
                font-size: 0.625rem; 
                opacity: 0.7;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .org-head .org-name, .org-head .org-role { color: white !important; }
            
            .org-team-divider {
                height: 1px;
                background: #e2e8f0;
                margin: 0.5rem 0;
            }
            .org-team { display: flex; flex-direction: column; gap: 0.25rem; }
            
            .org-empty {
                padding: 0.75rem;
                text-align: center;
                color: #94a3b8;
                font-size: 0.75rem;
                background: #f8fafc;
                border-radius: 6px;
                border: 1px dashed #cbd5e1;
            }
            
            .org-connector {
                display: flex;
                justify-content: center;
                margin-bottom: 1rem;
            }
            .org-connector::before {
                content: '';
                width: 2px;
                height: 20px;
                background: #cbd5e1;
            }
        </style>
    `;

    // Build the chart
    container.innerHTML = `
        ${styles}
        <div class="org-container">
            <div class="org-header">
                <div class="org-header-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
                    </svg>
                </div>
                <div class="org-header-text">
                    <h2>Innovative Engineering Solutions</h2>
                    <p>Organization Structure</p>
                </div>
            </div>
            
            <div class="org-leadership">
                <div class="org-leader">
                    <div class="org-leader-label">Managing Director</div>
                    ${createCard(director, true)}
                </div>
                <div class="org-leader">
                    <div class="org-leader-label">Business Development</div>
                    ${createCard(bdm, false)}
                </div>
            </div>
            
            <div class="org-connector"></div>
            
            <div class="org-departments">
                ${createSection('Fabrication', '🔧', '#6366f1', fabTeam)}
                ${createSection('CNC & VMC', '⚙️', '#3b82f6', cncTeam)}
                ${createSection('SPM', '🔩', '#8b5cf6', spmTeam)}
                ${createSection('HR', '👥', '#ec4899', hrTeam)}
            </div>
        </div>
    `;
};

// Alias for backward compatibility
export const renderSimpleTree = renderHierarchy;
