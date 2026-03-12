const express = require('express');
const router = express.Router();
const RunPodAPI = require('../api/runpod');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '../../data/workflows');
const KNOWN_PLACEHOLDERS = ['PROMPT_PLACEHOLDER', 'IMAGE_PLACEHOLDER'];

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

// List available workflows
router.get('/workflows', (req, res) => {
    try {
        const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
        const workflows = files.map(filename => {
            const content = fs.readFileSync(path.join(WORKFLOWS_DIR, filename), 'utf8');
            const placeholders = KNOWN_PLACEHOLDERS.filter(p => content.includes(p));
            return {
                id: filename.replace('.json', ''),
                filename,
                placeholders
            };
        });
        res.json(workflows);
    } catch (err) {
        console.error('Workflows error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get a specific workflow
router.get('/workflows/:id', (req, res) => {
    try {
        const filepath = path.join(WORKFLOWS_DIR, req.params.id + '.json');
        const content = fs.readFileSync(filepath, 'utf8');
        res.json(JSON.parse(content));
    } catch (err) {
        console.error('Workflow fetch error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
