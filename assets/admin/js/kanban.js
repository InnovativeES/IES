import * as DB from './db.js';

export const renderBoard = (projects) => {
    // Clear all columns
    ['planning', 'inprogress', 'review', 'completed'].forEach(status => {
        const col = document.getElementById(`kanban-${status}`);
        if (col) col.innerHTML = '';
        const counter = document.getElementById(`count-${status}`);
        if (counter) counter.textContent = '0';
    });

    projects.forEach(project => {
        const statusKey = getStatusKey(project.status);
        const column = document.getElementById(`kanban-${statusKey}`);

        if (column) {
            const card = createCard(project);
            column.appendChild(card);

            // Update counter
            const counter = document.getElementById(`count-${statusKey}`);
            const currentCount = parseInt(counter.textContent) || 0;
            counter.textContent = currentCount + 1;
        }
    });
};

const getStatusKey = (status) => {
    if (!status) return 'planning';
    return status.toLowerCase().replace(' ', '');
};

const createCard = (project) => {
    const div = document.createElement('div');
    div.className = 'kanban-card';
    div.draggable = true;
    div.id = `project-${project.id}`;

    // Tag Color Logic
    let tagColor = 'bg-gray-100 text-gray-800';
    if (project.type === 'Internal') tagColor = 'bg-blue-100 text-blue-800';
    if (project.type === 'Client') tagColor = 'bg-purple-100 text-purple-800';

    div.innerHTML = `
        <span class="kanban-tag ${tagColor}">${project.type || 'Project'}</span>
        <h4>${project.title}</h4>
        <p>${project.description || 'No description'}</p>
        <div class="kanban-meta">
            <div class="flex items-center text-xs text-gray-500">
                <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                ${project.dueDate || 'No Date'}
            </div>
            <div class="flex items-center">
                 <div class="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold">
                    ${project.assignedTo ? project.assignedTo.charAt(0) : '?'}
                 </div>
            </div>
        </div>
    `;

    // Drag Events
    div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData("text/plain", project.id);
        e.dataTransfer.effectAllowed = "move";
        div.classList.add('dragging');
    });

    div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
    });

    return div;
};

// Drag and Drop Global Helpers
window.allowDrop = (ev) => {
    ev.preventDefault();
};

window.drop = (ev, status) => {
    ev.preventDefault();
    const projectId = ev.dataTransfer.getData("text/plain");
    const card = document.getElementById(`project-${projectId}`);

    // Optimistic UI Update
    // Find the column by status name
    const statusKey = getStatusKey(status);
    const column = document.getElementById(`kanban-${statusKey}`);

    // Move card
    if (column && card) {
        column.appendChild(card);
        // Recount (simple reload usually safer but let's do optimistic)
        // Check if DB update succeeds
        DB.updateProjectStatus(projectId, status).then(res => {
            if (res.error) {
                alert("Failed to move card: " + res.error);
                // Revert logic would go here
            }
        });
    }
};
