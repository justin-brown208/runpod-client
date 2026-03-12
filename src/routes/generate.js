const express = require('express');
const router = express.Router();
const RunPodAPI = require('../api/runpod');

// Get configuration (excluding sensitive data)
router.get('/config', (req, res) => {
    res.json({
        promptPlaceholder: process.env.PROMPT_PLACEHOLDER || 'PROMPT_PLACEHOLDER',
        imagePlaceholder: process.env.IMAGE_PLACEHOLDER || 'IMAGE_PLACEHOLDER',
        pollInterval: parseInt(process.env.POLL_INTERVAL) || 2000,
        pollTimeout: parseInt(process.env.POLL_TIMEOUT) || 900000
    });
});

// Submit a job to RunPod
router.post('/generate', async (req, res) => {
    try {
        const result = await RunPodAPI.submitJob(req.body);
        res.json(result);
    } catch (err) {
        console.error('Generate error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Check job status
router.get('/status/:jobId', async (req, res) => {
    try {
        const result = await RunPodAPI.checkStatus(req.params.jobId);
        res.json(result);
    } catch (err) {
        console.error('Status error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
