let adminToken = '';

const loginBtn = document.getElementById('login-btn');
const passwordInput = document.getElementById('password-input');
const loginError = document.getElementById('login-error');
const overlay = document.getElementById('login-overlay');
const dashboard = document.getElementById('dashboard');

const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const dateBadge = document.getElementById('current-date-badge');
const statsList = document.getElementById('stats-list');
const profilesTbody = document.getElementById('profiles-tbody');
const toastContainer = document.getElementById('toast-container');

const triggerBtn = document.getElementById('trigger-daily-btn');
const resetBtn = document.getElementById('reset-stats-btn');

// --- Dynamic UI Helpers ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ℹ️';
    if(type === 'success') icon = '✅';
    if(type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    // Click to dismiss
    toast.addEventListener('click', () => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    });

    // Auto dismiss
    setTimeout(() => {
        if(toast.parentElement) {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
}

// --- Login Logic ---
loginBtn.addEventListener('click', () => {
    const pwd = passwordInput.value;
    if (pwd) {
        adminToken = pwd;
        checkStatus();
    }
});

passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginBtn.click();
});

// API Call is redefined above so remove the old one:

async function checkStatus() {
    try {
        const data = await apiCall('/api/status');
        // Success login
        overlay.classList.remove('active');
        dashboard.classList.remove('hidden');
        loginError.classList.add('hidden');
        
        dateBadge.innerText = data.todayDate || 'Today';

        if (data.ready) {
            statusDot.className = 'status-indicator ready';
            statusText.innerText = 'Bot Online & Ready';
            triggerBtn.disabled = false;
        } else {
            statusDot.className = 'status-indicator loading';
            statusText.innerText = 'Bot Syncing/Starting...';
            triggerBtn.disabled = true;
        }

        fetchStats();
    } catch (e) {
        if (e.message === 'Unauthorized') {
            loginError.classList.remove('hidden');
        } else {
            statusDot.className = 'status-indicator offline';
            statusText.innerText = 'Server Offline';
        }
    }
}

async function fetchStats() {
    try {
        const data = await apiCall('/api/stats');
        renderProfiles(data.profiles);
        
        // Find today's stats based on the badge or just the latest key
        const today = dateBadge.innerText;
        const todayStats = data.stats[today] || [];
        renderStats(todayStats, data.profiles);
    } catch (e) {
        console.error(e);
    }
}

function renderProfiles(profiles) {
    profilesTbody.innerHTML = '';
    const keys = Object.keys(profiles);
    if (keys.length === 0) {
        profilesTbody.innerHTML = `<tr><td colspan="3" class="empty-state">No linked profiles yet.</td></tr>`;
        return;
    }
    
    keys.forEach(id => {
        const tr = document.createElement('tr');
        
        // Handle either enriched object or raw string (fallback)
        const username = typeof profiles[id] === 'string' ? profiles[id] : profiles[id].username;
        const isBlocked = typeof profiles[id] === 'string' ? false : profiles[id].isBlocked;
        const inGroup = typeof profiles[id] === 'string' ? true : profiles[id].inGroup;

        // Action Buttons
        const blockAction = isBlocked ? 'unblock' : 'block';
        const blockText = isBlocked ? 'Unblock' : 'Block Contact';
        const blockClass = isBlocked ? 'primary-btn' : 'danger-btn';

        const groupAction = inGroup ? 'kick' : 'add';
        const groupText = inGroup ? 'Kick from Group' : 'Add to Group';
        const groupClass = inGroup ? 'danger-btn' : 'primary-btn';

        tr.style.animationDelay = `${index * 0.05}s`;
        tr.innerHTML = `
            <td><code>${id}</code></td>
            <td><strong>${username}</strong></td>
            <td class="action-cell">
                <button class="${blockClass} small-btn" onclick="userAction('${blockAction}', '${id}')">${blockText}</button>
                <button class="${groupClass} small-btn" onclick="userAction('${groupAction}', '${id}')">${groupText}</button>
            </td>
        `;
        profilesTbody.appendChild(tr);
    });
}

// --- Action Buttons ---
async function userAction(action, userId) {
    if (!confirm(`Are you sure you want to ${action} this user?`)) return;

    try {
        await apiCall('/api/user-action', 'POST', { action, userId });
        showToast(`Successfully performed: ${action}`, 'success');
        fetchStats(); // refresh data
    } catch (e) {
        showToast(`Failed to perform ${action}.`, 'error');
    }
}

async function apiCall(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Authorization': adminToken,
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(endpoint, options);
    if (res.status === 401) {
        throw new Error('Unauthorized');
    }
    return res.json();
}

function renderStats(todayStats, profiles) {
    statsList.innerHTML = '';
    if (todayStats.length === 0) {
        statsList.innerHTML = `<div class="empty-state">No one has finished today's question yet.</div>`;
        return;
    }

    todayStats.forEach((id, index) => {
        const pData = profiles[id];
        const username = (typeof pData === 'string' ? pData : pData?.username) || 'Unknown User';
        const div = document.createElement('div');
        div.className = 'stat-item';
        div.style.animationDelay = `${index * 0.1}s`;
        div.innerHTML = `
            <span class="icon">✅</span>
            <strong>${username}</strong>
            <span class="user-id">${id}</span>
        `;
        statsList.appendChild(div);
    });
}

// --- Action Buttons ---
triggerBtn.addEventListener('click', async () => {
    if(!confirm('Are you sure you want to force the bot to send the daily question now?')) return;
    
    triggerBtn.innerText = '⏳ Sending...';
    triggerBtn.disabled = true;
    try {
        await apiCall('/api/trigger-daily', 'POST');
        showToast('Daily question triggered successfully!', 'success');
    } catch (e) {
        showToast('Failed to trigger daily question.', 'error');
    }
    triggerBtn.innerText = '🚀 Send Daily Question Now';
    triggerBtn.disabled = false;
});

resetBtn.addEventListener('click', async () => {
    if(!confirm('⚠️ WARNING: Are you sure you want to delete all completion records for TODAY? This cannot be undone.')) return;
    
    resetBtn.innerText = '⏳ Resetting...';
    resetBtn.disabled = true;
    try {
        await apiCall('/api/reset-stats', 'POST');
        fetchStats(); // Refresh UI
        showToast("Today's stats have been reset.", 'success');
    } catch (e) {
        showToast('Failed to reset stats.', 'error');
    }
    resetBtn.innerText = '⚠️ Reset Today\'s Stats';
    resetBtn.disabled = false;
});

// Auto-refresh every 30 seconds if logged in
setInterval(() => {
    if (adminToken) {
        checkStatus();
    }
}, 30000);
