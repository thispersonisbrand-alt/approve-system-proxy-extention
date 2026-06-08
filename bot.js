const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// CORS configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const PORT = process.env.PORT || 3000;

// Storage
let pendingRequests = [];
let approvedDevices = new Map();
let users = [];

// Generate unique key
function generateUniqueKey() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// Send Telegram message
async function sendTelegramMessage(chatId, text, keyboard = null) {
    if (!TELEGRAM_BOT_TOKEN) return;
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
    };
    
    if (keyboard) {
        payload.reply_markup = JSON.stringify(keyboard);
    }
    
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error('Telegram send error:', error);
    }
}

// ============= HOME PAGE =============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Proxy Tools API Server</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 { color: #667eea; margin-bottom: 10px; font-size: 28px; }
        .status { background: #d4edda; color: #155724; padding: 10px; border-radius: 10px; margin: 20px 0; }
        .info { text-align: left; background: #f8f9fa; padding: 15px; border-radius: 10px; margin: 20px 0; }
        .info-item { padding: 8px 0; border-bottom: 1px solid #e0e0e0; }
        .label { font-weight: bold; color: #667eea; }
        .button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 25px;
            margin-top: 20px;
        }
        .footer { margin-top: 20px; font-size: 12px; color: #999; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Proxy Tools API Server</h1>
        <div class="status">✅ Server is Running</div>
        <div class="info">
            <div class="info-item"><span class="label">📡 Status:</span> Online</div>
            <div class="info-item"><span class="label">🤖 Telegram Bot:</span> ${TELEGRAM_BOT_TOKEN ? '✅ Connected' : '❌ Not Configured'}</div>
            <div class="info-item"><span class="label">👥 Pending Requests:</span> ${pendingRequests.length}</div>
            <div class="info-item"><span class="label">✅ Approved Users:</span> ${approvedDevices.size}</div>
        </div>
        <a href="/admin" class="button">📊 Admin Dashboard</a>
        <div class="footer">Made with ❤️ by This person is brand</div>
    </div>
</body>
</html>
    `);
});

// ============= API ROUTES =============

// Request access
app.post('/api/request-access', async (req, res) => {
    const { name, telegramUsername, deviceId, extensionId } = req.body;
    
    if (!name || !deviceId) {
        return res.status(400).json({ error: 'Name and Device ID required' });
    }
    
    if (approvedDevices.has(deviceId)) {
        const approved = approvedDevices.get(deviceId);
        return res.json({ approved: true, key: approved.key, message: 'Device already approved!' });
    }
    
    const existingRequest = pendingRequests.find(r => r.deviceId === deviceId);
    if (existingRequest) {
        return res.json({ pending: true, message: 'Request already pending. Wait for admin approval.' });
    }
    
    const accessKey = generateUniqueKey();
    const requestId = Date.now().toString();
    
    const newRequest = {
        id: requestId,
        name: name,
        telegramUsername: telegramUsername || '',
        deviceId: deviceId,
        key: accessKey,
        extensionId: extensionId || 'unknown',
        timestamp: new Date().toISOString(),
        status: 'pending'
    };
    
    pendingRequests.push(newRequest);
    
    if (TELEGRAM_BOT_TOKEN && ADMIN_CHAT_ID) {
        const adminMessage = `
🔐 <b>New Access Request!</b>

👤 <b>Name:</b> ${name}
📱 <b>Telegram:</b> ${telegramUsername || 'Not provided'}
🔑 <b>Key:</b> <code>${accessKey}</code>
📱 <b>Device ID:</b> <code>${deviceId}</code>
🆔 <b>Request ID:</b> ${requestId}
⏰ <b>Time:</b> ${new Date().toLocaleString()}
        `;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Approve (30 days)', callback_data: `approve_${requestId}` }],
                [{ text: '❌ Reject', callback_data: `reject_${requestId}` }]
            ]
        };
        
        await sendTelegramMessage(ADMIN_CHAT_ID, adminMessage, keyboard);
    }
    
    res.json({ success: true, pending: true, requestId: requestId, message: 'Access request sent to admin.' });
});

// Check status
app.post('/api/check-status', async (req, res) => {
    const { deviceId } = req.body;
    
    if (approvedDevices.has(deviceId)) {
        const approved = approvedDevices.get(deviceId);
        return res.json({ 
            approved: true, 
            key: approved.key,
            name: approved.name,
            expiryDate: approved.expiryDate
        });
    }
    
    const pending = pendingRequests.find(r => r.deviceId === deviceId);
    if (pending) {
        return res.json({ pending: true, requestId: pending.id });
    }
    
    res.json({ approved: false });
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, token: 'admin-session-token' });
    } else {
        res.json({ success: false, error: 'Invalid password' });
    }
});

// Admin dashboard data
app.get('/api/admin/dashboard', async (req, res) => {
    const authToken = req.headers.authorization;
    if (authToken !== 'Bearer admin-session-token') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    res.json({
        pendingRequests: pendingRequests,
        approvedDevices: Array.from(approvedDevices.entries()).map(([id, data]) => ({
            deviceId: id,
            name: data.name,
            key: data.key,
            telegramUsername: data.telegramUsername || '',
            approvedAt: data.approvedAt,
            expiryDate: data.expiryDate
        })),
        totalUsers: approvedDevices.size,
        totalPending: pendingRequests.length
    });
});

// Approve request
app.post('/api/admin/approve', async (req, res) => {
    const { requestId, authToken } = req.body;
    
    if (authToken !== 'admin-session-token') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const request = pendingRequests.find(r => r.id === requestId);
    if (!request) {
        return res.json({ error: 'Request not found' });
    }
    
    pendingRequests = pendingRequests.filter(r => r.id !== requestId);
    
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);
    
    approvedDevices.set(request.deviceId, {
        name: request.name,
        key: request.key,
        telegramUsername: request.telegramUsername || '',
        approvedAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString()
    });
    
    if (TELEGRAM_BOT_TOKEN && ADMIN_CHAT_ID) {
        await sendTelegramMessage(ADMIN_CHAT_ID, `
✅ <b>Request Approved!</b>

👤 Name: ${request.name}
🔑 Key: <code>${request.key}</code>
📱 Device: ${request.deviceId}
⏰ Expires: ${expiryDate.toLocaleDateString()}
        `);
    }
    
    res.json({ success: true, message: 'Request approved successfully (30 days access)' });
});

// Reject request
app.post('/api/admin/reject', async (req, res) => {
    const { requestId, authToken } = req.body;
    
    if (authToken !== 'admin-session-token') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    pendingRequests = pendingRequests.filter(r => r.id !== requestId);
    res.json({ success: true, message: 'Request rejected' });
});

// Remove device
app.post('/api/admin/remove-device', async (req, res) => {
    const { deviceId, authToken } = req.body;
    
    if (authToken !== 'admin-session-token') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    approvedDevices.delete(deviceId);
    res.json({ success: true, message: 'Device removed' });
});

// Telegram webhook
app.post('/webhook/telegram', async (req, res) => {
    const { callback_query } = req.body;
    
    if (callback_query) {
        const data = callback_query.data;
        
        if (data.startsWith('approve_')) {
            const requestId = data.replace('approve_', '');
            const request = pendingRequests.find(r => r.id === requestId);
            
            if (request) {
                pendingRequests = pendingRequests.filter(r => r.id !== requestId);
                const expiryDate = new Date();
                expiryDate.setDate(expiryDate.getDate() + 30);
                
                approvedDevices.set(request.deviceId, {
                    name: request.name,
                    key: request.key,
                    telegramUsername: request.telegramUsername || '',
                    approvedAt: new Date().toISOString(),
                    expiryDate: expiryDate.toISOString()
                });
                
                await sendTelegramMessage(ADMIN_CHAT_ID, `✅ Approved: ${request.name}`);
            }
        } else if (data.startsWith('reject_')) {
            const requestId = data.replace('reject_', '');
            pendingRequests = pendingRequests.filter(r => r.id !== requestId);
            await sendTelegramMessage(ADMIN_CHAT_ID, `❌ Rejected: Request ${requestId}`);
        }
        
        res.sendStatus(200);
    } else {
        res.sendStatus(200);
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        telegramConfigured: !!(TELEGRAM_BOT_TOKEN && ADMIN_CHAT_ID),
        pendingCount: pendingRequests.length,
        approvedCount: approvedDevices.size
    });
});

// ============= ADMIN DASHBOARD =============
app.get('/admin', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Proxy Tools Admin Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        
        /* Header */
        .header {
            background: white;
            border-radius: 20px;
            padding: 25px 30px;
            margin-bottom: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        .header h1 { color: #667eea; font-size: 28px; margin-bottom: 5px; }
        .header p { color: #666; font-size: 14px; }
        .header-links { margin-top: 15px; }
        .header-links a { color: #667eea; text-decoration: none; font-size: 13px; }
        
        /* Stats Cards */
        .stats {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin-bottom: 25px;
        }
        .stat-card {
            background: white;
            border-radius: 20px;
            padding: 20px;
            text-align: center;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            transition: transform 0.2s;
        }
        .stat-card:hover { transform: translateY(-5px); }
        .stat-number { font-size: 42px; font-weight: bold; color: #667eea; }
        .stat-label { color: #666; margin-top: 8px; font-size: 13px; }
        .stat-icon { font-size: 30px; margin-bottom: 10px; }
        
        /* Sections */
        .section {
            background: white;
            border-radius: 20px;
            padding: 25px;
            margin-bottom: 25px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        }
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        .section-header h2 { color: #667eea; font-size: 20px; }
        .refresh-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 8px 20px;
            border-radius: 10px;
            cursor: pointer;
            font-size: 13px;
        }
        
        /* Tables */
        .table-wrapper {
            overflow-x: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th {
            background: #f8f9fa;
            color: #667eea;
            padding: 14px 12px;
            text-align: left;
            font-weight: bold;
            font-size: 13px;
        }
        td {
            padding: 12px;
            border-bottom: 1px solid #f0f0f0;
            font-size: 12px;
        }
        tr:hover { background: #f8f9fa; }
        
        /* Badges */
        .badge-pending { background: #ffc107; color: #333; padding: 4px 10px; border-radius: 20px; font-size: 11px; }
        .badge-approved { background: #28a745; color: white; padding: 4px 10px; border-radius: 20px; font-size: 11px; }
        .badge-expiring { background: #dc3545; color: white; padding: 4px 10px; border-radius: 20px; font-size: 11px; }
        .badge-warning { background: #fd7e14; color: white; padding: 4px 10px; border-radius: 20px; font-size: 11px; }
        
        /* Buttons */
        .btn-approve { background: #28a745; color: white; border: none; padding: 6px 15px; border-radius: 8px; cursor: pointer; font-size: 11px; margin: 2px; }
        .btn-reject { background: #dc3545; color: white; border: none; padding: 6px 15px; border-radius: 8px; cursor: pointer; font-size: 11px; margin: 2px; }
        .btn-remove { background: #ffc107; color: #333; border: none; padding: 6px 15px; border-radius: 8px; cursor: pointer; font-size: 11px; margin: 2px; }
        .btn-copy { background: #17a2b8; color: white; border: none; padding: 3px 8px; border-radius: 5px; cursor: pointer; font-size: 10px; }
        
        /* Login Form */
        .login-form {
            max-width: 420px;
            margin: 100px auto;
            background: white;
            padding: 35px;
            border-radius: 25px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        }
        .login-form h2 { color: #667eea; text-align: center; margin-bottom: 20px; }
        .login-form input {
            width: 100%;
            padding: 12px 15px;
            margin: 10px 0;
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            font-size: 14px;
        }
        .login-form input:focus { outline: none; border-color: #667eea; }
        .login-form button {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            margin-top: 15px;
        }
        
        /* Empty State */
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #999;
        }
        
        /* Responsive */
        @media (max-width: 1000px) {
            .stats { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 600px) {
            .stats { grid-template-columns: 1fr; }
            .section-header { flex-direction: column; gap: 10px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Login Section -->
        <div id="loginSection" class="login-form">
            <h2>🔐 Admin Login</h2>
            <input type="password" id="adminPassword" placeholder="Enter Admin Password">
            <button onclick="login()">Login to Dashboard</button>
        </div>
        
        <!-- Dashboard Section -->
        <div id="dashboardSection" style="display:none;">
            <!-- Header -->
            <div class="header">
                <h1>🛡️ Proxy Tools Admin Dashboard</h1>
                <p>Manage user access requests and approved devices</p>
                <div class="header-links">
                    <a href="/">← Back to Home</a>
                </div>
            </div>
            
            <!-- Stats Cards -->
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-icon">👥</div>
                    <div class="stat-number" id="totalUsers">0</div>
                    <div class="stat-label">Total Users</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">⏳</div>
                    <div class="stat-number" id="totalPending">0</div>
                    <div class="stat-label">Pending Requests</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">✅</div>
                    <div class="stat-number" id="totalApproved">0</div>
                    <div class="stat-label">Approved Devices</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">⚠️</div>
                    <div class="stat-number" id="totalExpiring">0</div>
                    <div class="stat-label">Expiring Soon (7 days)</div>
                </div>
            </div>
            
            <!-- Pending Requests Table -->
            <div class="section">
                <div class="section-header">
                    <h2>📋 Pending Requests</h2>
                    <button class="refresh-btn" onclick="loadData()">🔄 Refresh</button>
                </div>
                <div class="table-wrapper" id="pendingTable"></div>
            </div>
            
            <!-- Approved Users Table -->
            <div class="section">
                <div class="section-header">
                    <h2>✅ Approved Users</h2>
                    <button class="refresh-btn" onclick="exportToCSV()">📥 Export CSV</button>
                </div>
                <div class="table-wrapper" id="approvedTable"></div>
            </div>
        </div>
    </div>
    
    <script>
        let authToken = '';
        
        async function login() {
            const password = document.getElementById('adminPassword').value;
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password })
            });
            const data = await response.json();
            
            if (data.success) {
                authToken = data.token;
                document.getElementById('loginSection').style.display = 'none';
                document.getElementById('dashboardSection').style.display = 'block';
                loadData();
                setInterval(() => { if (authToken) loadData(); }, 15000);
            } else {
                alert('Invalid password!');
            }
        }
        
        async function loadData() {
            try {
                const response = await fetch('/api/admin/dashboard', {
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                const data = await response.json();
                
                // Update stats
                document.getElementById('totalUsers').textContent = data.totalUsers;
                document.getElementById('totalPending').textContent = data.totalPending;
                document.getElementById('totalApproved').textContent = data.approvedDevices.length;
                
                // Calculate expiring soon (7 days)
                const expiringCount = data.approvedDevices.filter(dev => {
                    const expiryDate = new Date(dev.expiryDate);
                    const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
                    return daysLeft <= 7 && daysLeft > 0;
                }).length;
                document.getElementById('totalExpiring').textContent = expiringCount;
                
                // Pending Requests Table
                if (data.pendingRequests.length === 0) {
                    document.getElementById('pendingTable').innerHTML = '<div class="empty-state">✨ No pending requests</div>';
                } else {
                    let pendingHtml = \`
                        <table>
                            <thead>
                                <tr>
                                    <th>👤 Name</th>
                                    <th>📱 Telegram</th>
                                    <th>🔑 Device ID</th>
                                    <th>🗝️ Key</th>
                                    <th>⏰ Time</th>
                                    <th>⚡ Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                    \`;
                    data.pendingRequests.forEach(req => {
                        const time = new Date(req.timestamp).toLocaleString();
                        pendingHtml += \`
                            <tr>
                                <td><strong>\${escapeHtml(req.name)}</strong></td>
                                <td>\${req.telegramUsername || '-'}</td>
                                <td><code>\${req.deviceId.substring(0, 16)}...</code></td>
                                <td><code>\${req.key}</code> <button class="btn-copy" onclick="copyText('\${req.key}')">Copy</button></td>
                                <td>\${time}</td>
                                <td>
                                    <button class="btn-approve" onclick="approveRequest('\${req.id}')">✅ Approve</button>
                                    <button class="btn-reject" onclick="rejectRequest('\${req.id}')">❌ Reject</button>
                                </td>
                            </tr>
                        \`;
                    });
                    pendingHtml += '</tbody></table>';
                    document.getElementById('pendingTable').innerHTML = pendingHtml;
                }
                
                // Approved Users Table
                if (data.approvedDevices.length === 0) {
                    document.getElementById('approvedTable').innerHTML = '<div class="empty-state">📭 No approved users yet</div>';
                } else {
                    let approvedHtml = \`
                        <table>
                            <thead>
                                <tr>
                                    <th>👤 Name</th>
                                    <th>📱 Telegram</th>
                                    <th>🔑 Device ID</th>
                                    <th>🗝️ Access Key</th>
                                    <th>📅 Approved</th>
                                    <th>⏰ Expiry</th>
                                    <th>⚡ Status</th>
                                    <th>🛠️ Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                    \`;
                    data.approvedDevices.forEach(dev => {
                        const approvedDate = new Date(dev.approvedAt).toLocaleDateString();
                        const expiryDate = new Date(dev.expiryDate);
                        const now = new Date();
                        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
                        
                        let statusBadge = '';
                        let statusText = '';
                        if (daysLeft <= 0) {
                            statusBadge = 'badge-expiring';
                            statusText = 'Expired';
                        } else if (daysLeft <= 7) {
                            statusBadge = 'badge-warning';
                            statusText = daysLeft + ' days left';
                        } else {
                            statusBadge = 'badge-approved';
                            statusText = daysLeft + ' days left';
                        }
                        
                        approvedHtml += \`
                            <tr>
                                <td><strong>\${escapeHtml(dev.name)}</strong></td>
                                <td>\${dev.telegramUsername || '-'}</td>
                                <td><code>\${dev.deviceId.substring(0, 16)}...</code></td>
                                <td><code>\${dev.key}</code> <button class="btn-copy" onclick="copyText('\${dev.key}')">Copy</button></td>
                                <td>\${approvedDate}</td>
                                <td>\${expiryDate.toLocaleDateString()}</td>
                                <td><span class="\${statusBadge}">\${statusText}</span></td>
                                <td><button class="btn-remove" onclick="removeDevice('\${dev.deviceId}')">🗑️ Remove</button></td>
                            </tr>
                        \`;
                    });
                    approvedHtml += '</tbody></table>';
                    document.getElementById('approvedTable').innerHTML = approvedHtml;
                }
            } catch (error) {
                console.error('Error loading data:', error);
            }
        }
        
        async function approveRequest(requestId) {
            if (confirm('Approve this request? User will get 30 days access.')) {
                const response = await fetch('/api/admin/approve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requestId: requestId, authToken: authToken })
                });
                const data = await response.json();
                if (data.success) {
                    loadData();
                    alert('✅ Request approved for 30 days!');
                } else {
                    alert('❌ Failed to approve');
                }
            }
        }
        
        async function rejectRequest(requestId) {
            if (confirm('Reject this request?')) {
                const response = await fetch('/api/admin/reject', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requestId: requestId, authToken: authToken })
                });
                const data = await response.json();
                if (data.success) {
                    loadData();
                    alert('❌ Request rejected');
                }
            }
        }
        
        async function removeDevice(deviceId) {
            if (confirm('Remove this device? User will lose access immediately.')) {
                const response = await fetch('/api/admin/remove-device', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceId: deviceId, authToken: authToken })
                });
                const data = await response.json();
                if (data.success) {
                    loadData();
                    alert('🗑️ Device removed');
                }
            }
        }
        
        function copyText(text) {
            navigator.clipboard.writeText(text);
            alert('📋 Copied: ' + text);
        }
        
        function exportToCSV() {
            const table = document.querySelector('#approvedTable table');
            if (!table) return;
            
            let csv = [];
            const rows = table.querySelectorAll('tr');
            for (let row of rows) {
                const cells = row.querySelectorAll('th, td');
                const rowData = [];
                for (let cell of cells) {
                    let text = cell.innerText;
                    if (text.includes('Copy')) continue;
                    rowData.push('"' + text.replace(/"/g, '""') + '"');
                }
                if (rowData.length) csv.push(rowData.join(','));
            }
            
            const blob = new Blob([csv.join('\\n')], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'approved-users.csv';
            a.click();
            URL.revokeObjectURL(url);
        }
        
        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>
    `);
});

// 404 handler
app.use((req, res) => {
    res.status(404).send(`
<!DOCTYPE html>
<html>
<head><title>404</title>
<style>
    body{font-family:Arial;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;justify-content:center;align-items:center;height:100vh;}
    .container{background:white;border-radius:20px;padding:40px;text-align:center;}
    h1{color:#dc3545;font-size:72px;}
    a{background:#667eea;color:white;padding:10px 20px;text-decoration:none;border-radius:25px;display:inline-block;margin-top:20px;}
</style>
</head>
<body>
<div class="container"><h1>404</h1><p>Page not found</p><a href="/">Go Home</a></div>
</body>
</html>
    `);
});

// Start server
app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('🚀 Proxy Tools Backend Server');
    console.log('='.repeat(50));
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🏠 Home page: http://localhost:${PORT}/`);
    console.log(`📱 Admin Dashboard: http://localhost:${PORT}/admin`);
    console.log(`🤖 Telegram Bot: ${TELEGRAM_BOT_TOKEN ? 'CONFIGURED ✅' : 'NOT CONFIGURED ⚠️'}`);
    console.log(`👤 Admin Chat ID: ${ADMIN_CHAT_ID ? 'CONFIGURED ✅' : 'NOT CONFIGURED ⚠️'}`);
    console.log('='.repeat(50));
});
