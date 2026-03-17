// Configuration loaded from server
let CONFIG = {
    promptPlaceholder: 'PROMPT_PLACEHOLDER',
    imagePlaceholder: 'IMAGE_PLACEHOLDER',
    videoPlaceholder: 'VIDEO_PLACEHOLDER',
    pollInterval: 2000,
    pollTimeout: 900000,
    videoExtensions: ['.mp4', '.mov', '.webm', '.avi', '.mkv']
};

// Load config from server on startup
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            CONFIG = await response.json();
        }
    } catch (err) {
        console.warn('Failed to load config, using defaults:', err.message);
    }
}

// ===========================================
// Module 1: Media Input Handler (Images + Videos)
// ===========================================
const MediaInput = {
    base64Data: null,  // For images
    ref: null,         // For videos (S3 reference)
    filename: null,
    isVideo: false,

    _isVideoFile(filename) {
        const ext = '.' + filename.split('.').pop().toLowerCase();
        return CONFIG.videoExtensions.includes(ext);
    },

    async load(file) {
        this.clear();
        this.filename = file.name;
        this.isVideo = this._isVideoFile(file.name);

        if (this.isVideo) {
            // Upload video to S3
            const formData = new FormData();
            formData.append('video', file);

            const response = await fetch('/api/upload-video', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Video upload failed');
            }

            const result = await response.json();
            this.ref = result.ref;
            return this.ref;
        } else {
            // Load image as base64
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        // Convert to PNG using canvas
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);

                        // Get base64 PNG (strip the data URL prefix)
                        const dataUrl = canvas.toDataURL('image/png');
                        this.base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
                        resolve(this.base64Data);
                    };
                    img.onerror = () => reject(new Error('Failed to load image'));
                    img.src = e.target.result;
                };
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });
        }
    },

    clear() {
        this.base64Data = null;
        this.ref = null;
        this.filename = null;
        this.isVideo = false;
    },

    isLoaded() {
        return this.base64Data !== null || this.ref !== null;
    },

    getFilename() {
        return this.filename;
    },

    getBase64() {
        return this.base64Data;
    },

    getRef() {
        return this.ref;
    },

    getIsVideo() {
        return this.isVideo;
    }
};

// Backwards compatibility alias
const ImageInput = MediaInput;

// ===========================================
// Module 2: Workflow Manager
// ===========================================
const WorkflowManager = {
    workflows: [],
    selected: null,
    loadedWorkflow: null,

    async fetchList() {
        const response = await fetch('/api/workflows');
        this.workflows = await response.json();
        return this.workflows;
    },

    async select(id) {
        if (!id) {
            this.selected = null;
            this.loadedWorkflow = null;
            return null;
        }
        this.selected = this.workflows.find(w => w.id === id);
        const response = await fetch(`/api/workflows/${id}`);
        this.loadedWorkflow = await response.json();
        return this.selected;
    },

    isLoaded() {
        return this.loadedWorkflow !== null;
    },

    hasPlaceholder(name) {
        return this.selected?.placeholders?.includes(name) || false;
    },

    prepareWithPrompt(prompt, mediaInput = null) {
        const workflowCopy = JSON.parse(JSON.stringify(this.loadedWorkflow));
        let jsonString = JSON.stringify(workflowCopy);

        // Replace prompt placeholder
        jsonString = jsonString.split(CONFIG.promptPlaceholder).join(prompt);

        // For images, replace placeholder in workflow (existing behavior)
        if (mediaInput && !mediaInput.isVideo && mediaInput.base64Data) {
            jsonString = jsonString.split(CONFIG.imagePlaceholder).join(mediaInput.base64Data);
        }

        // For videos, replace VIDEO_PLACEHOLDER with the filename
        // The handler uploads to ComfyUI with this name, so VHS node can reference it
        if (mediaInput && mediaInput.isVideo && mediaInput.filename) {
            jsonString = jsonString.split(CONFIG.videoPlaceholder).join(mediaInput.filename);
        }

        const parsed = JSON.parse(jsonString);

        // Build the request structure
        let request;
        if (parsed.input && parsed.input.workflow) {
            request = parsed;
        } else {
            request = {
                input: {
                    workflow: parsed
                }
            };
        }

        // For videos, add to images array with ref field
        if (mediaInput && mediaInput.isVideo && mediaInput.ref) {
            if (!request.input.images) {
                request.input.images = [];
            }
            request.input.images.push({
                name: mediaInput.filename,
                ref: mediaInput.ref
            });
        }

        return request;
    }
};

// ===========================================
// Module 3: Queue API Client
// ===========================================
const QueueAPI = {
    async addToQueue(workflow) {
        const response = await fetch('/api/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(workflow)
        });
        if (!response.ok) throw new Error('Failed to queue');
        return response.json();
    },

    async submitAll(currentWorkflow = null) {
        const response = await fetch('/api/submit-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflow: currentWorkflow })
        });
        if (!response.ok) throw new Error('Failed to submit');
        return response.json();
    },

    async getJobs() {
        const response = await fetch('/api/jobs');
        if (!response.ok) throw new Error('Failed to fetch jobs');
        return response.json();
    }
};

// ===========================================
// Module 4: Jobs Poller
// ===========================================
const JobsPoller = {
    intervalId: null,
    onUpdate: null,

    start(onUpdate) {
        // Don't create duplicate intervals
        if (this.intervalId) return;

        this.onUpdate = onUpdate;
        this.poll();
        this.intervalId = setInterval(() => this.poll(), CONFIG.pollInterval);
    },

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    },

    async poll() {
        try {
            const jobs = await QueueAPI.getJobs();
            if (this.onUpdate) this.onUpdate(jobs);

            // Stop polling if no jobs are in progress
            const hasInProgress = jobs.some(j => j.status === 'IN_PROGRESS');
            if (!hasInProgress && this.intervalId) {
                this.stop();
            }
        } catch (err) {
            console.error('Jobs poll error:', err);
        }
    }
};

// ===========================================
// Module 5: Image Display
// ===========================================
const ImageDisplay = {
    placeholder: document.getElementById('image-placeholder'),
    image: document.getElementById('result-image'),

    clear() {
        this.image.style.display = 'none';
        this.image.src = '';
        this.placeholder.style.display = 'block';
    },

    show(src) {
        // Handle URLs, base64 data URLs, or raw base64
        if (src.startsWith('/') || src.startsWith('http')) {
            this.image.src = src;
        } else if (src.startsWith('data:')) {
            this.image.src = src;
        } else {
            this.image.src = `data:image/png;base64,${src}`;
        }
        this.image.style.display = 'block';
        this.placeholder.style.display = 'none';
    },

    extractFromResponse(response) {
        const output = response.output;
        if (!output) return null;

        // ComfyUI worker format: output.images[].data contains base64 or S3 URL
        if (output.images && output.images.length > 0) {
            return output.images[0].data;
        }

        return null;
    }
};

// ===========================================
// Module 6: UI Controller
// ===========================================
const UIController = {
    elements: {
        workflowSelect: document.getElementById('workflow-select'),
        imageSection: document.getElementById('image-section'),
        imageInput: document.getElementById('image-input'),
        imageFilename: document.getElementById('image-filename'),
        promptSection: document.getElementById('prompt-section'),
        promptInput: document.getElementById('prompt-input'),
        queueBtn: document.getElementById('queue-btn'),
        submitBtn: document.getElementById('submit-btn'),
        statusText: document.getElementById('status-text'),
        jobsList: document.getElementById('jobs-list')
    },

    async init() {
        try {
            const workflows = await WorkflowManager.fetchList();
            this.populateWorkflowDropdown(workflows);
        } catch (err) {
            this.setStatus('error', 'Failed to load workflows');
        }

        this.elements.workflowSelect.addEventListener('change', (e) => this.handleWorkflowSelect(e));
        this.elements.imageInput.addEventListener('change', (e) => this.handleImageUpload(e));
        this.elements.queueBtn.addEventListener('click', () => this.handleQueue());
        this.elements.submitBtn.addEventListener('click', () => this.handleSubmitAll());
        this.elements.queueBtn.disabled = true;

        // Load existing jobs
        this.refreshJobs();
    },

    populateWorkflowDropdown(workflows) {
        this.elements.workflowSelect.innerHTML = '<option value="">Select a workflow...</option>';
        workflows.forEach(w => {
            const option = document.createElement('option');
            option.value = w.id;
            option.textContent = w.filename;
            this.elements.workflowSelect.appendChild(option);
        });
    },

    async handleWorkflowSelect(event) {
        const id = event.target.value;
        if (!id) {
            this.hideAllInputs();
            this.elements.queueBtn.disabled = true;
            return;
        }

        try {
            await WorkflowManager.select(id);
            this.updateInputVisibility();
            this.elements.queueBtn.disabled = false;
        } catch (err) {
            this.setStatus('error', `Failed to load workflow: ${err.message}`);
        }
    },

    updateInputVisibility() {
        const showPrompt = WorkflowManager.hasPlaceholder('PROMPT_PLACEHOLDER');
        const showFile = WorkflowManager.hasPlaceholder('IMAGE_PLACEHOLDER') ||
                         WorkflowManager.hasPlaceholder('VIDEO_PLACEHOLDER');
        this.elements.promptSection.classList.toggle('hidden', !showPrompt);
        this.elements.imageSection.classList.toggle('hidden', !showFile);
    },

    hideAllInputs() {
        this.elements.promptSection.classList.add('hidden');
        this.elements.imageSection.classList.add('hidden');
    },

    async handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) {
            MediaInput.clear();
            this.elements.imageFilename.textContent = 'No file selected';
            this.elements.imageFilename.classList.add('empty');
            return;
        }

        try {
            const isVideo = MediaInput._isVideoFile(file.name);
            if (isVideo) {
                this.setStatus('uploading', `Uploading ${file.name}...`);
                this.elements.imageFilename.textContent = 'Uploading...';
            }

            await MediaInput.load(file);

            this.elements.imageFilename.textContent = MediaInput.getFilename();
            this.elements.imageFilename.classList.remove('empty');

            if (isVideo) {
                this.setStatus('idle', `Video uploaded: ${MediaInput.getRef()}`);
            }
        } catch (err) {
            MediaInput.clear();
            this.elements.imageFilename.textContent = 'Upload failed';
            this.elements.imageFilename.classList.add('empty');
            this.setStatus('error', `Upload error: ${err.message}`);
        }
    },

    getCurrentWorkflow() {
        if (!WorkflowManager.isLoaded()) return null;
        const prompt = this.elements.promptInput.value.trim();
        const needsPrompt = WorkflowManager.hasPlaceholder('PROMPT_PLACEHOLDER');
        if (needsPrompt && !prompt) return null;

        // Pass the full MediaInput object for video/image handling
        const mediaInput = MediaInput.isLoaded() ? {
            isVideo: MediaInput.getIsVideo(),
            base64Data: MediaInput.getBase64(),
            ref: MediaInput.getRef(),
            filename: MediaInput.getFilename()
        } : null;

        return WorkflowManager.prepareWithPrompt(prompt, mediaInput);
    },

    async handleQueue() {
        const workflow = this.getCurrentWorkflow();
        if (!workflow) {
            this.setStatus('error', 'Prompt required');
            return;
        }

        try {
            await QueueAPI.addToQueue(workflow);
            this.setStatus('idle', 'Added to queue');
        } catch (err) {
            this.setStatus('error', `Queue error: ${err.message}`);
        }
    },

    async handleSubmitAll() {
        const currentWorkflow = this.getCurrentWorkflow();

        try {
            this.setStatus('submitting', 'Submitting jobs...');
            const result = await QueueAPI.submitAll(currentWorkflow);
            this.setStatus('polling', `Submitted ${result.submitted.length} job(s)`);

            // Start polling for job updates
            JobsPoller.start((jobs) => this.renderJobs(jobs));
        } catch (err) {
            this.setStatus('error', `Submit error: ${err.message}`);
        }
    },

    async refreshJobs() {
        try {
            const jobs = await QueueAPI.getJobs();
            this.renderJobs(jobs);

            // Start polling if any jobs are in progress
            if (jobs.some(j => j.status === 'IN_PROGRESS')) {
                JobsPoller.start((jobs) => this.renderJobs(jobs));
            }
        } catch (err) {
            console.error('Failed to load jobs:', err);
        }
    },

    renderJobs(jobs) {
        this.elements.jobsList.innerHTML = jobs.map(job => `
            <div class="job-item">
                <span class="job-id">${job.id}</span>
                <span class="job-status ${job.status}">${job.status}</span>
            </div>
        `).join('');

        // Update status text based on job states
        const inProgress = jobs.filter(j => j.status === 'IN_PROGRESS').length;
        const completed = jobs.filter(j => j.status === 'COMPLETED').length;
        const failed = jobs.filter(j => j.status === 'FAILED').length;

        if (inProgress > 0) {
            this.setStatus('polling', `${inProgress} job(s) in progress...`);
        } else if (failed > 0 && completed === 0) {
            this.setStatus('error', `${failed} job(s) failed`);
        } else if (completed > 0) {
            this.setStatus('complete', `${completed} job(s) completed`);
        } else {
            this.setStatus('idle', 'Idle');
        }

        // Show latest completed image
        const latestCompleted = jobs.find(j => j.status === 'COMPLETED' && j.outputPath);
        if (latestCompleted) {
            ImageDisplay.show(latestCompleted.outputPath);
        }
    },

    setStatus(state, message) {
        this.elements.statusText.textContent = message;
        this.elements.statusText.className = `status-value ${state}`;
    }
};

// Initialize on page load
loadConfig().then(() => {
    UIController.init();
});
