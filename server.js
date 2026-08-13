const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store active server sessions in memory
// Format: { [id]: { ip, targetWs, status, logs: [], webClients: Set } }
const sessions = {};

// Helper: Generate a unique ID
function generateId() {
    return crypto.randomBytes(4).toString('hex');
}

// Route to render console interface
app.get('/console/history/:id', (req, res) => {
    const { id } = req.params;
    if (!sessions[id]) {
        return res.status(404).send('Session not found or expired.');
    }
    res.sendFile(path.join(__dirname, 'views', 'console.html'));
});

// Endpoint to register/connect to a new target server
// Usage: POST /api/session { "ip": "192.168.1.100:8080" }
app.post('/api/session', (req, res) => {
    const { ip } = req.body;
    if (!ip) {
        return res.status(400).json({ error: 'IP address is required.' });
    }

    const id = generateId();
    
    // Initialize session state
    sessions[id] = {
        id: id,
        ip: ip,
        status: 'OFFLINE',
        logs: [],
        webClients: new Set(),
        targetWs: null
    };

    // Initiate connection to the target Minecraft WebSocket
    connectToTargetServer(id, ip);

    const protocol = req.protocol;
    const host = req.get('host');
    const fullUrl = `${protocol}://${host}/console/history/${id}`;

    res.json({
        id: id,
        ip: ip,
        url: fullUrl
    });
});

// API to retrieve full session log history
app.get('/api/session/:id/logs', (req, res) => {
    const session = sessions[req.params.id];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({
        ip: session.ip,
        status: session.status,
        logs: session.logs
    });
});

// Function to establish and maintain WebSocket link to target server
function connectToTargetServer(id, targetIp) {
    const session = sessions[id];
    if (!session) return;

    const targetUrl = targetIp.startsWith('ws://') || targetIp.startsWith('wss://')
        ? targetIp
        : `ws://${targetIp}`;

    logToSession(id, `[SYSTEM] Connecting to target server at ${targetUrl}...`);

    try {
        const ws = new WebSocket(targetUrl);
        session.targetWs = ws;

        ws.on('open', () => {
            session.status = 'ONLINE';
            logToSession(id, `[SYSTEM] Connected successfully to ${targetIp}. Sending auth...`);
            
            // Send default authentication payload
            ws.send(JSON.stringify({
                type: "auth",
                password: "changeme"
            }));

            broadcastStatus(id, 'ONLINE');
        });

        ws.on('message', (data) => {
            const message = data.toString();
            logToSession(id, message);
        });

        ws.on('error', (err) => {
            session.status = 'OFFLINE';
            logToSession(id, `[SYSTEM] Target connection error: ${err.message}`);
            broadcastStatus(id, 'OFFLINE');
        });

        ws.on('close', () => {
            session.status = 'OFFLINE';
            logToSession(id, `[SYSTEM] Server connection closed.`);
            broadcastStatus(id, 'OFFLINE');
        });

    } catch (err) {
        session.status = 'OFFLINE';
        logToSession(id, `[SYSTEM] Failed to initiate connection: ${err.message}`);
        broadcastStatus(id, 'OFFLINE');
    }
}

// Log appending and streaming to web viewers
function logToSession(id, message) {
    const session = sessions[id];
    if (!session) return;

    session.logs.push(message);

    // Broadcast log line to connected web browser clients
    const payload = JSON.stringify({ type: 'log', data: message });
    session.webClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

function broadcastStatus(id, status) {
    const session = sessions[id];
    if (!session) return;

    const payload = JSON.stringify({ type: 'status', status: status });
    session.webClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// Handle WebSocket links between Browser Frontend and Backend Proxy
wss.on('connection', (ws, req) => {
    // Extract ID from path URL: ws://host/console/history/:id
    const matches = req.url.match(/\/console\/history\/([a-f0-9]+)/);
    const sessionId = matches ? matches[1] : null;

    if (!sessionId || !sessions[sessionId]) {
        ws.close(1008, 'Invalid Session ID');
        return;
    }

    const session = sessions[sessionId];
    session.webClients.add(ws);

    // Sync initial state and history to new connection
    ws.send(JSON.stringify({
        type: 'init',
        status: session.status,
        logs: session.logs
    }));

    // Handle commands typed into the web interface
    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            if (parsed.type === 'command' && parsed.command) {
                if (session.targetWs && session.targetWs.readyState === WebSocket.OPEN) {
                    // Send command object to target Minecraft server
                    session.targetWs.send(JSON.stringify({
                        type: 'command',
                        command: parsed.command
                    }));
                    logToSession(sessionId, `> ${parsed.command}`);
                } else {
                    ws.send(JSON.stringify({
                        type: 'log',
                        data: '[SYSTEM] Cannot send command: Server is offline.'
                    }));
                }
            }
        } catch (e) {
            console.error('Invalid client message:', e.message);
        }
    });

    ws.on('close', () => {
        session.webClients.delete(ws);
    });
});

server.listen(PORT, () => {
    console.log(`Central Backend Server live at http://localhost:${PORT}`);
});
