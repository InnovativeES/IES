// UI Module - Clean Version for New Admin Panel

let views = [];
let navLinks = [];

export const toggleAuthView = (user) => {
    const authContainer = document.getElementById('auth-container');
    const dashboardContainer = document.getElementById('dashboard-container');

    if (user) {
        if (authContainer) authContainer.style.display = 'none';
        if (dashboardContainer) {
            dashboardContainer.style.display = 'flex';
            dashboardContainer.classList.remove('hidden');
        }
        const emailDisplay = document.getElementById('user-email-display');
        if (emailDisplay) emailDisplay.textContent = user.email;
    } else {
        if (authContainer) authContainer.style.display = 'flex';
        if (dashboardContainer) dashboardContainer.style.display = 'none';
    }
};

export const showLoginError = (message) => {
    const loginError = document.getElementById('login-error');
    if (loginError) {
        loginError.textContent = message;
        loginError.classList.remove('hidden');
    }
};

export const switchView = (viewName) => {
    if (!views.length) views = document.querySelectorAll('.view-section');

    views.forEach(view => view.classList.add('hidden'));

    const target = document.getElementById(`view-${viewName}`);
    if (target) {
        target.classList.remove('hidden');

        // Update Page Title
        const titles = {
            'overview': 'Dashboard Overview',
            'monitoring': 'Internal Orders',
            'team_org': 'Team & Organization',
            'project_management': 'Project Management'
        };

        const pageTitle = document.getElementById('page-title');
        if (pageTitle) pageTitle.textContent = titles[viewName] || 'Dashboard';

        // Update Sidebar Active State
        updateActiveLink(viewName);

        // Trigger View Renders
        if (viewName === 'team_org') {
            if (window.adminApp?.renderTeamView) {
                window.adminApp.renderTeamView();
            }
        }
        if (viewName === 'monitoring') {
            if (window.adminApp?.renderMonitoring) {
                window.adminApp.renderMonitoring();
            }
        }
    }
};

const updateActiveLink = (viewName) => {
    navLinks.forEach(link => {
        const targetView = link.getAttribute('data-view');
        link.classList.remove('active');
        if (targetView === viewName) {
            link.classList.add('active');
        }
    });
};

export const setupNavigation = () => {
    views = document.querySelectorAll('.view-section');
    navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.getAttribute('data-view');
            switchView(view);
        });
    });
};

export const renderMemberList = (members) => {
    const memberListBody = document.getElementById('member-list-body');
    if (!memberListBody) return;

    if (!members || members.length === 0) {
        memberListBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center" style="padding: 3rem; color: #64748b;">
                    No team members found. Click "Add Member" to get started.
                </td>
            </tr>
        `;
        return;
    }

    memberListBody.innerHTML = '';

    // Sort members by Employee ID
    const sortedMembers = [...members].sort((a, b) => {
        const idA = (a.employeeId || '').toString().toLowerCase();
        const idB = (b.employeeId || '').toString().toLowerCase();
        if (idA < idB) return -1;
        if (idA > idB) return 1;
        return 0;
    });

    sortedMembers.forEach(member => {
        // Get role display
        const role = member.role || member.designation || '-';
        const section = member.section || member.department || '-';
        const status = member.status || 'Active';

        // Status badge class
        let badgeClass = 'badge-success';
        if (status === 'On Leave') badgeClass = 'badge-warning';
        if (status === 'Inactive') badgeClass = 'badge-default';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #34d399 0%, #059669 100%); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 0.875rem;">
                        ${member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-weight: 600; color: #1e293b;">${member.name}</div>
                        <div style="font-size: 0.8125rem; color: #64748b;">${member.email || ''}</div>
                    </div>
                </div>
            </td>
            <td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.8125rem;">${member.employeeId || '-'}</code></td>
            <td style="font-weight: 500;">${role}</td>
            <td>${section}</td>
            <td>${member.phone || '-'}</td>
            <td>${member.joiningDate ? new Date(member.joiningDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
            <td><span class="badge ${badgeClass}">${status}</span></td>
            <td class="text-right">
                <div class="action-btns">
                    <button class="action-btn edit" onclick="window.adminApp.editMember('${member.id}')" title="Edit">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    <button class="action-btn delete" onclick="window.adminApp.deleteMember('${member.id}', '${member.name}')" title="Delete">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </td>
        `;
        memberListBody.appendChild(row);
    });
};

// Backward compatibility alias
export const renderEmployeeList = renderMemberList;

export const updateStats = (stats) => {
    const setEl = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value ?? '-';
    };

    setEl('stat-total-employees', stats.totalMembers || stats.totalEmployees);
    setEl('stat-active-tasks', stats.activeTasks);
    setEl('stat-completed-tasks', stats.completedTasks);
    setEl('stat-depts', stats.departments);

    // Dynamic Dashboard Stats (New)
    if (stats.revenue !== undefined) {
        const revEl = document.getElementById('stat-revenue');
        if (revEl) {
            // Store the real value in a data attribute
            const formattedRevenue = `₹ ${stats.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
            revEl.setAttribute('data-value', formattedRevenue);

            // Only update text if NOT hidden
            if (!revEl.classList.contains('revenue-hidden')) {
                revEl.textContent = formattedRevenue;
            } else {
                // Ensure it stays blurred/hidden visually (text content doesn't matter much if blurred, 
                // but let's keep it consistent)
                revEl.textContent = formattedRevenue;
            }
        }
    }
    setEl('stat-active-orders', stats.activeOrders ?? 0);
    setEl('stat-pending-count', `${stats.pendingCount ?? 0} Pending`);
    setEl('stat-weekly-due', stats.weeklyDue ?? 0);
    setEl('stat-efficiency', `${stats.efficiency ?? 0}%`);
    setEl('stat-member-count', `${stats.totalMembers || 0} Staff Active`);

    // Pipeline Bars
    const setBar = (id, pctId, value) => {
        const bar = document.getElementById(id);
        const text = document.getElementById(pctId);
        if (bar) bar.style.width = `${value}%`;
        if (text) text.textContent = `${value}%`;
    };

    setBar('pipeline-pending-bar', 'pipeline-pending-pct', stats.pendingPct || 0);
    setBar('pipeline-delivered-bar', 'pipeline-delivered-pct', stats.deliveredPct || 0);
};

export const renderDashboardPendingOrders = (orders) => {
    const container = document.getElementById('dashboard-pending-body');
    const badge = document.getElementById('pending-orders-badge');
    if (!container) return;

    const pending = orders.filter(o => o.status === 'Pending');
    if (badge) badge.textContent = `${pending.length} Items`;

    if (pending.length === 0) {
        container.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-400">No pending orders found.</td></tr>';
        return;
    }

    container.innerHTML = pending.map(order => `
        <tr>
            <td style="font-weight: 600; color: #1e293b;">${order.internalOrderNo || '-'}</td>
            <td>${order.drawingNo || '-'}</td>
            <td class="truncate" style="max-width: 200px;" title="${order.description}">${order.description || '-'}</td>
            <td>${order.customer || '-'}</td>
            <td>${order.qty || '-'}</td>
            <td>${order.qtyUnit || '-'}</td>
            <td style="color: #64748b;">${order.date || order.deliveryDateActual || '-'}</td>
            <td><span class="badge" style="background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5;">Pending</span></td>
        </tr>
    `).join('');
};

export const renderDashboardRecentActivity = (orders) => {
    const container = document.getElementById('dashboard-recent-feed');
    if (!container) return;

    // Filter to show only new Internal Orders and sort by creation time
    const recent = [...orders]
        .filter(o => o.internalOrderNo)
        .sort((a, b) => {
            const timeA = a.createdAt?.seconds || 0;
            const timeB = b.createdAt?.seconds || 0;
            return timeB - timeA;
        })
        .slice(0, 20); // Show more items to fill expanded card

    if (recent.length === 0) {
        container.innerHTML = '<li class="text-center py-4 text-xs text-slate-400">No recent orders</li>';
        return;
    }

    container.innerHTML = recent.map(order => `
        <li class="activity-item">
            <div class="activity-icon">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
            </div>
            <div class="activity-info">
                <p><strong>Order #${order.internalOrderNo}</strong> added for ${order.customer || 'Customer'}</p>
                <span class="activity-time">${order.date || 'Today'}</span>
            </div>
        </li>
    `).join('');
};
