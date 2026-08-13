const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static view files
app.use(express.static(path.join(__dirname, 'views')));

// Endpoint to view console history by ID
// Query param format: /console/history/12345?ip=192.168.1.10:8080
app.get('/console/history/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'console.html'));
});

// API endpoint to initiate a console session dynamically
app.post('/api/create-session', (req, res) => {
    const { ip } = req.body;
    if (!ip) {
        return res.status(400).json({ error: 'IP address is required' });
    }
    
    // Generate a unique session ID
    const id = Math.random().toString(36).substring(2, 9);
    const consoleUrl = `/console/history/${id}?ip=${encodeURIComponent(ip)}`;
    
    res.json({
        id: id,
        url: consoleUrl
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
