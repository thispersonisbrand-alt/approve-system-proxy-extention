const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());

// স্টোরেজ (প্রোডাকশনে ডাটাবেস ব্যবহার করুন)
let pendingRequests = [];
let approvedDevices = new Map();
let users = [];

// টেলিগ্রাম বোট সেটআপ
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'YOUR_ADMIN_CHAT_ID';
const BOT_USERNAME = '@thispersonisbrand537';

// ইউনিক কী জেনারেট
function generateUniqueKey() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// ডিভাইস আইডি জেনারেট
function generateDeviceId() {
    return crypto.randomBytes(8).toString('hex').toUpperCase();
}

// টেলিগ্রাম মেসেজ পাঠান
async function sendTelegramMessage(chatId, text, keyboard = null) {
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

// API: রিকোয়েস্ট সাবমিট
app.post('/api/request-access', async (req, res) => {
    const { name, deviceId, extensionId } = req.body;
    
    if (!name || !deviceId) {
        return res.status(400).json({ error: 'Name and Device ID required' });
    }
    
    // চেক আগে থেকে অ্যাপ্রুভড কিনা
    if (approvedDevices.has(deviceId)) {
        const approved = approvedDevices.get(deviceId);
        return res.json({ 
            approved: true, 
            key: approved.key,
            message: 'Device already approved!'
        });
    }
    
    // চেক পেন্ডিং আছে কিনা
    const existingRequest = pendingRequests.find(r => r.deviceId === deviceId);
    if (existingRequest) {
        return res.json({ 
            pending: true, 
            message: 'Request already pending. Wait for admin approval.'
        });
    }
    
    // নতুন কী জেনারেট
    const accessKey = generateUniqueKey();
    const requestId = Date.now().toString();
    
    // পেন্ডিং রিকোয়েস্ট সেভ
    const newRequest = {
        id: requestId,
        name: name,
        deviceId: deviceId,
        key: accessKey,
        extensionId: extensionId || 'unknown',
        timestamp: new Date().toISOString(),
        status: 'pending'
    };
    
    pendingRequests.push(newRequest);
    
    // অ্যাডমিনকে টেলিগ্রামে নোটিফিকেশন
    const adminMessage = `
🔐 <b>New Access Request!</b>

👤 <b>Name:</b> ${name}
🔑 <b>Key:</b> <code>${accessKey}</code>
📱 <b>Device ID:</b> <code>${deviceId}</code>
🆔 <b>Request ID:</b> ${requestId}
⏰ <b>Time:</b> ${new Date().toLocaleString()}

⚙️ <b>Tool:</b> Proxy Tools

Please approve this request.
    `;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: '✅ Approve', callback_data: `approve_${requestId}` },
                { text: '❌ Reject', callback_data: `reject_${requestId}` }
            ]
        ]
    };
    
    await sendTelegramMessage(ADMIN_CHAT_ID, adminMessage, keyboard);
    
    res.json({ 
        success: true, 
        pending: true,
        requestId: requestId,
        message: 'Access request sent to admin. Please wait for approval.'
    });
});

// API: অ্যাপ্রুভ স্ট্যাটাস চেক
app.post('/api/check-status', async (req, res) => {
    const { deviceId } = req.body;
    
    if (approvedDevices.has(deviceId)) {
        const approved = approvedDevices.get(deviceId);
        return res.json({ 
            approved: true, 
            key: approved.key,
            name: approved.name
        });
    }
    
    const pending = pendingRequests.find(r => r.deviceId === deviceId);
    if (pending) {
        return res.json({ 
            pending: true, 
            requestId: pending.id 
        });
    }
    
    res.json({ approved: false });
});

// API: অ্যাডমিন লগইন
app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, token: 'admin-session-token' });
    } else {
        res.json({ success: false, error: 'Invalid password' });
    }
});

// API: অ্যাডমিন ড্যাশবোর্ড ডাটা
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
            approvedAt: data.approvedAt
        })),
        totalUsers: approvedDevices.size,
        totalPending: pendingRequests.length,
        users: users
    });
});

// API: অ্যাপ্রুভ রিকোয়েস্ট
app.post('/api/admin/approve', async (req, res) => {
    const { requestId, authToken } = req.body;
    
    if (authToken !== 'admin-session-token') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const request = pendingRequests.find(r => r.id === requestId);
    if (!request) {
        return res.json({ error: 'Request not found' });
    }
    
    // পেন্ডিং থেকে রিমুভ
    pendingRequests = pendingRequests.filter(r => r.id !== requestId);
    
    // অ্যাপ্রুভড ডিভাইসে যোগ
    approvedDevices.set(request.deviceId, {
        name: request.name,
        key: request.key,
        approvedAt: new Date().toISOString()
    });
    
    users.push({
        name: request.name,
        deviceId: request.deviceId,
        key: request.key,
        approvedAt: new Date().toISOString(),
        status: 'active'
    });
    
    // ইউজারকে সাকসেস মেসেজ পাঠান (যদি extension রিটার্ন করে)
    res.json({ 
        success: true, 
        message: 'Request approved successfully',
        deviceId: request.deviceId,
        key: request.key
    });
});

// API: রিজেক্ট রিকোয়েস্ট
app.post('/api/admin/reject', async (req, res) => {
    const { requestId, authToken } = req.body;
    
    if (authToken !== 'admin-session-token') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    pendingRequests = pendingRequests.filter(r => r.id !== requestId);
    
    res.json({ success: true, message: 'Request rejected' });
});

// API: ডিভাইস রিমুভ
app.post('/api/admin/remove-device', async (req, res) => {
    const { deviceId, authToken } = req.body;
    
    if (authToken !== 'admin-session-token') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    approvedDevices.delete(deviceId);
    users = users.filter(u => u.deviceId !== deviceId);
    
    res.json({ success: true, message: 'Device removed' });
});

// টেলিগ্রাম ওয়েবহুক (callback queries)
app.post('/webhook/telegram', async (req, res) => {
    const { callback_query } = req.body;
    
    if (callback_query) {
        const data = callback_query.data;
        const messageId = callback_query.message.message_id;
        
        if (data.startsWith('approve_')) {
            const requestId = data.replace('approve_', '');
            const request = pendingRequests.find(r => r.id === requestId);
            
            if (request) {
                pendingRequests = pendingRequests.filter(r => r.id !== requestId);
                approvedDevices.set(request.deviceId, {
                    name: request.name,
                    key: request.key,
                    approvedAt: new Date().toISOString()
                });
                
                await sendTelegramMessage(ADMIN_CHAT_ID, `
✅ <b>Request Approved!</b>

👤 Name: ${request.name}
🔑 Key: <code>${request.key}</code>
📱 Device: ${request.deviceId}

User can now use the proxy tool.
                `);
            }
        } else if (data.startsWith('reject_')) {
            const requestId = data.replace('reject_', '');
            pendingRequests = pendingRequests.filter(r => r.id !== requestId);
            
            await sendTelegramMessage(ADMIN_CHAT_ID, `
❌ <b>Request Rejected!</b>

Request ID: ${requestId}
                `);
        }
        
        res.sendStatus(200);
    }
});

// অ্যাডমিন ড্যাশবোর্ড HTML
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
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            background: white;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        }
        h1 { color: #667eea; margin-bottom: 10px; }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .stat-card {
            background: white;
            border-radius: 15px;
            padding: 20px;
            text-align: center;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        }
        .stat-number {
            font-size: 36px;
            font-weight: bold;
            color: #667eea;
        }
        .stat-label {
            color: #666;
            margin-top: 5px;
        }
        .section {
            background: white;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        }
        .section h2 {
            color: #667eea;
            margin-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
            padding-bottom: 10px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #f0f0f0;
        }
        th {
            background: #f8f9fa;
            color: #667eea;
        }
        .approve-btn, .reject-btn, .remove-btn {
            padding: 5px 15px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            margin: 0 3px;
        }
        .approve-btn { background: #28a745; color: white; }
        .reject-btn { background: #dc3545; color: white; }
        .remove-btn { background: #ffc107; color: #333; }
        .login-form {
            max-width: 400px;
            margin: 100px auto;
            background: white;
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.2);
        }
        .login-form input {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            border: 1px solid #ddd;
            border-radius: 8px;
        }
        .login-form button {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
        }
        .status-badge {
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 12px;
        }
        .status-pending { background: #ffc107; color: #333; }
        .status-approved { background: #28a745; color: white; }
        .refresh-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 20px;
            border-radius: 8px;
            cursor: pointer;
            margin-bottom: 15px;
        }
        .copy-btn {
            background: #17a2b8;
            color: white;
            border: none;
            padding: 2px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }
    </style>
</head>
<body>
    <div id="app">
        <div class="container">
            <div id="loginSection" class="login-form">
                <h2 style="text-align:center;">Admin Login</h2>
                <input type="password" id="adminPassword" placeholder="Enter Admin Password">
                <button onclick="login()">Login to Dashboard</button>
            </div>
            
            <div id="dashboardSection" style="display:none;">
                <div class="header">
                    <h1>🛡️ Proxy Tools Admin Dashboard</h1>
                    <p>Manage user access requests and approved devices</p>
                </div>
                
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-number" id="totalUsers">0</div>
                        <div class="stat-label">Total Users</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="totalPending">0</div>
                        <div class="stat-label">Pending Requests</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="totalApproved">0</div>
                        <div class="stat-label">Approved Devices</div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>📋 Pending Requests</h2>
                    <button class="refresh-btn" onclick="loadData()">🔄 Refresh</button>
                    <div id="pendingTable"></div>
                </div>
                
                <div class="section">
                    <h2>✅ Approved Users</h2>
                    <div id="approvedTable"></div>
                </div>
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
            } else {
                alert('Invalid password!');
            }
        }
        
        async function loadData() {
            const response = await fetch('/api/admin/dashboard', {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            const data = await response.json();
            
            document.getElementById('totalUsers').textContent = data.totalUsers;
            document.getElementById('totalPending').textContent = data.totalPending;
            document.getElementById('totalApproved').textContent = data.approvedDevices.length;
            
            // Pending table
            let pendingHtml = '<table><tr><th>Name</th><th>Device ID</th><th>Key</th><th>Time</th><th>Actions</th></tr>';
            data.pendingRequests.forEach(req => {
                pendingHtml += \`
                    <tr>
                        <td>\${req.name}</td>
                        <td><code>\${req.deviceId}</code></td>
                        <td><code>\${req.key}</code></td>
                        <td>\${new Date(req.timestamp).toLocaleString()}</td>
                        <td>
                            <button class="approve-btn" onclick="approveRequest('\${req.id}')">Approve</button>
                            <button class="reject-btn" onclick="rejectRequest('\${req.id}')">Reject</button>
                        </td>
                    </tr>
                \`;
            });
            pendingHtml += '</table>';
            if (data.pendingRequests.length === 0) pendingHtml = '<p>No pending requests</p>';
            document.getElementById('pendingTable').innerHTML = pendingHtml;
            
            // Approved table
            let approvedHtml = '<table><tr><th>Name</th><th>Device ID</th><th>Key</th><th>Approved At</th><th>Actions</th></tr>';
            data.approvedDevices.forEach(dev => {
                approvedHtml += \`
                    <tr>
                        <td>\${dev.name}</td>
                        <td><code>\${dev.deviceId}</code></td>
                        <td><code>\${dev.key}</code> <button class="copy-btn" onclick="copyText('\${dev.key}')">Copy</button></td>
                        <td>\${new Date(dev.approvedAt).toLocaleString()}</td>
                        <td>
                            <button class="remove-btn" onclick="removeDevice('\${dev.deviceId}')">Remove</button>
                        </td>
                    </tr>
                \`;
            });
            approvedHtml += '</table>';
            if (data.approvedDevices.length === 0) approvedHtml = '<p>No approved users</p>';
            document.getElementById('approvedTable').innerHTML = approvedHtml;
        }
        
        async function approveRequest(requestId) {
            const response = await fetch('/api/admin/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: requestId, authToken: authToken })
            });
            const data = await response.json();
            if (data.success) {
                loadData();
                alert('Request approved!');
            }
        }
        
        async function rejectRequest(requestId) {
            const response = await fetch('/api/admin/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: requestId, authToken: authToken })
            });
            const data = await response.json();
            if (data.success) {
                loadData();
                alert('Request rejected!');
            }
        }
        
        async function removeDevice(deviceId) {
            if (confirm('Remove this device? User will lose access.')) {
                const response = await fetch('/api/admin/remove-device', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceId: deviceId, authToken: authToken })
                });
                const data = await response.json();
                if (data.success) {
                    loadData();
                    alert('Device removed!');
                }
            }
        }
        
        function copyText(text) {
            navigator.clipboard.writeText(text);
            alert('Copied: ' + text);
        }
        
        // Auto refresh every 10 seconds
        setInterval(() => {
            if (authToken) loadData();
        }, 10000);
    </script>
</body>
</html>
    `);
});

// সার্ভার স্টার্ট
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Admin Dashboard: http://localhost:${PORT}/admin`);
    console.log(`🤖 Telegram Bot Active`);
});