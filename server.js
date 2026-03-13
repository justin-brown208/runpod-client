require('dotenv').config();
const express = require('express');
const path = require('path');
const generateRoutes = require('./src/routes/generate');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve output images
app.use('/outputs', express.static(path.join(__dirname, 'data/outputs')));

// API routes
app.use('/api', generateRoutes);

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`RunPod Client server running at http://localhost:${PORT}`);
});
