const express = require('express');
const router = express.Router();
const multer = require('multer');
const RunPodAPI = require('../api/runpod');
const S3API = require('../api/s3');
const fs = require('fs');
const path = require('path');

// Multer config for video uploads (memory storage)
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv'];
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (VIDEO_EXTENSIONS.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type. Accepted: ${VIDEO_EXTENSIONS.join(', ')}`));
        }
    }
});

const WORKFLOWS_DIR = path.join(__dirname, '../../data/workflows');
const QUEUE_DIR = path.join(__dirname, '../../data/queue');
const JOBS_DIR = path.join(__dirname, '../../data/jobs');
const OUTPUTS_DIR = path.join(__dirname, '../../data/outputs');
const KNOWN_PLACEHOLDERS = ['PROMPT_PLACEHOLDER', 'IMAGE_PLACEHOLDER'];

// Ensure directories exist
[WORKFLOWS_DIR, QUEUE_DIR, JOBS_DIR, OUTPUTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Get configuration (excluding sensitive data)
router.get('/config', (req, res) => {
    res.json({
        promptPlaceholder: process.env.PROMPT_PLACEHOLDER || 'PROMPT_PLACEHOLDER',
        imagePlaceholder: process.env.IMAGE_PLACEHOLDER || 'IMAGE_PLACEHOLDER',
        pollInterval: parseInt(process.env.POLL_INTERVAL) || 2000,
        pollTimeout: parseInt(process.env.POLL_TIMEOUT) || 900000,
        videoExtensions: VIDEO_EXTENSIONS
    });
});

// Upload video to S3, returns ref for use in API calls
router.post('/upload-video', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided' });
        }

        const ref = await S3API.uploadInput(req.file.buffer, req.file.originalname);
        res.json({ ref, originalName: req.file.originalname });
    } catch (err) {
        console.error('Upload error:', err.message);
        res.status(500).json({ error: `Upload failed: ${err.message}` });
    }
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

// Add prepared workflow to queue
router.post('/queue', (req, res) => {
    try {
        const filename = `${Date.now()}.json`;
        fs.writeFileSync(path.join(QUEUE_DIR, filename), JSON.stringify(req.body));
        res.json({ queued: filename });
    } catch (err) {
        console.error('Queue error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Submit all queued jobs + optional current workflow
router.post('/submit-all', async (req, res) => {
    try {
        const results = [];

        // Get queued workflows sorted by creation time
        const queueFiles = fs.readdirSync(QUEUE_DIR)
            .filter(f => f.endsWith('.json'))
            .sort();

        // Submit each queued workflow
        for (const filename of queueFiles) {
            const filepath = path.join(QUEUE_DIR, filename);
            const workflow = JSON.parse(fs.readFileSync(filepath, 'utf8'));
            const result = await RunPodAPI.submitJob(workflow);

            // Create job tracking file
            const jobFile = `${Date.now()}-${result.id}.json`;
            fs.writeFileSync(path.join(JOBS_DIR, jobFile), JSON.stringify({
                id: result.id,
                status: 'IN_PROGRESS',
                submittedAt: Date.now(),
                outputPath: null
            }));

            // Remove from queue
            fs.unlinkSync(filepath);
            results.push({ id: result.id, from: 'queue' });
        }

        // Submit current workflow if provided
        if (req.body.workflow) {
            const result = await RunPodAPI.submitJob(req.body.workflow);
            const jobFile = `${Date.now()}-${result.id}.json`;
            fs.writeFileSync(path.join(JOBS_DIR, jobFile), JSON.stringify({
                id: result.id,
                status: 'IN_PROGRESS',
                submittedAt: Date.now(),
                outputPath: null
            }));
            results.push({ id: result.id, from: 'current' });
        }

        res.json({ submitted: results });
    } catch (err) {
        console.error('Submit-all error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// List jobs and update status of in-progress ones
router.get('/jobs', async (req, res) => {
    try {
        const jobFiles = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
        const jobs = [];

        for (const filename of jobFiles) {
            const filepath = path.join(JOBS_DIR, filename);
            const job = JSON.parse(fs.readFileSync(filepath, 'utf8'));

            // Check status of in-progress jobs
            if (job.status === 'IN_PROGRESS') {
                const status = await RunPodAPI.checkStatus(job.id);
                job.status = status.status;

                if (status.status === 'COMPLETED' && status.output?.images?.length > 0) {
                    // Process each output image
                    job.outputs = [];
                    for (const img of status.output.images) {
                        if (img.ref) {
                            // Video output - download from S3
                            const outputFilename = `${job.id}-${img.name || img.ref}`;
                            const outputPath = path.join(OUTPUTS_DIR, outputFilename);
                            try {
                                await S3API.downloadOutput(img.ref, outputPath);
                                await S3API.deleteFile(img.ref, 'outputs');
                                job.outputs.push({ name: img.name, path: `/outputs/${outputFilename}` });
                            } catch (err) {
                                console.error(`Failed to download ${img.ref}:`, err.message);
                                job.outputs.push({ name: img.name, error: err.message });
                            }
                        } else if (img.image) {
                            // Base64 image - save locally
                            const ext = img.name?.endsWith('.png') ? '' : '.png';
                            const outputFilename = `${job.id}-${img.name || 'output'}${ext}`;
                            const outputPath = path.join(OUTPUTS_DIR, outputFilename);

                            if (img.image.startsWith('http')) {
                                job.outputs.push({ name: img.name, path: img.image });
                            } else {
                                fs.writeFileSync(outputPath, Buffer.from(img.image, 'base64'));
                                job.outputs.push({ name: img.name, path: `/outputs/${outputFilename}` });
                            }
                        }
                    }

                    // Keep outputPath for backwards compatibility (first output)
                    job.outputPath = job.outputs[0]?.path || null;
                    fs.writeFileSync(filepath, JSON.stringify(job));
                } else if (status.status === 'FAILED') {
                    job.error = status.error || 'Job failed';
                    fs.writeFileSync(filepath, JSON.stringify(job));
                }
            }

            jobs.push(job);
        }

        // Sort by submission time (newest first)
        jobs.sort((a, b) => b.submittedAt - a.submittedAt);
        res.json(jobs);
    } catch (err) {
        console.error('Jobs error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
