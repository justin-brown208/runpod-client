// Configuration loaded from server
let CONFIG = {
    promptPlaceholder: 'PROMPT_PLACEHOLDER',
    imagePlaceholder: 'IMAGE_PLACEHOLDER',
    pollInterval: 2000,
    pollTimeout: 900000
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
// Module 1: Image Input Handler
// ===========================================
const ImageInput = {
    base64Data: null,
    filename: null,

    load(file) {
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
                    this.filename = file.name;
                    resolve(this.base64Data);
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    },

    clear() {
        this.base64Data = null;
        this.filename = null;
    },

    isLoaded() {
        return this.base64Data !== null;
    },

    getFilename() {
        return this.filename;
    },

    getBase64() {
        return this.base64Data;
    }
};

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

    prepareWithPrompt(prompt, imageBase64 = null) {
        const workflowCopy = JSON.parse(JSON.stringify(this.loadedWorkflow));
        let jsonString = JSON.stringify(workflowCopy);

        // Replace prompt placeholder
        jsonString = jsonString.split(CONFIG.promptPlaceholder).join(prompt);

        // Replace image placeholder if image provided
        if (imageBase64) {
            jsonString = jsonString.split(CONFIG.imagePlaceholder).join(imageBase64);
        }

        const parsed = JSON.parse(jsonString);

        // Wrap in parent structure if not already wrapped
        if (parsed.input && parsed.input.workflow) {
            return parsed;
        }

        return {
            input: {
                workflow: parsed
            }
        };
    }
};

// ===========================================
// Module 3: RunPod API Client (via local backend)
// ===========================================
const RunPodAPI = {
    async submitJob(requestBody) {
        console.log('Submitting:', JSON.stringify(requestBody, null, 2));

        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Submit failed: ${response.status}`);
        }

        return response.json();
    },

    async checkStatus(jobId) {
        const response = await fetch(`/api/status/${jobId}`, {
            method: 'GET'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Status check failed: ${response.status}`);
        }

        return response.json();
    }
};

// ===========================================
// Module 4: Polling Controller
// ===========================================
const PollingController = {
    timeoutId: null,
    startTime: null,

    start(jobId, onUpdate, onComplete, onError) {
        this.startTime = Date.now();
        this.poll(jobId, onUpdate, onComplete, onError);
    },

    stop() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    },

    async poll(jobId, onUpdate, onComplete, onError) {
        if (Date.now() - this.startTime > CONFIG.pollTimeout) {
            onError(new Error('Polling timeout exceeded'));
            return;
        }

        try {
            const result = await RunPodAPI.checkStatus(jobId);
            console.log('Status response:', result);
            onUpdate(result.status);

            if (result.status === 'COMPLETED') {
                onComplete(result);
                return;
            }

            if (result.status === 'FAILED') {
                // Extract error details from response
                let errorMsg = 'Job failed';
                if (result.error) {
                    errorMsg = typeof result.error === 'string'
                        ? result.error
                        : result.error.message || JSON.stringify(result.error);
                } else if (result.output?.error) {
                    errorMsg = result.output.error;
                }
                onError(new Error(errorMsg));
                return;
            }

            this.timeoutId = setTimeout(
                () => this.poll(jobId, onUpdate, onComplete, onError),
                CONFIG.pollInterval
            );
        } catch (err) {
            onError(err);
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

    show(base64Data) {
        let dataUrl = base64Data;
        if (!base64Data.startsWith('data:')) {
            dataUrl = `data:image/png;base64,${base64Data}`;
        }
        this.image.src = dataUrl;
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
        generateBtn: document.getElementById('generate-btn'),
        statusText: document.getElementById('status-text'),
        jobIdText: document.getElementById('job-id-text')
    },

    async init() {
        // Load available workflows
        try {
            const workflows = await WorkflowManager.fetchList();
            this.populateWorkflowDropdown(workflows);
        } catch (err) {
            this.setStatus('error', 'Failed to load workflows');
        }

        this.elements.workflowSelect.addEventListener('change', (e) => this.handleWorkflowSelect(e));
        this.elements.imageInput.addEventListener('change', (e) => this.handleImageUpload(e));
        this.elements.generateBtn.addEventListener('click', () => this.handleGenerate());
        this.elements.generateBtn.disabled = true;
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
            this.elements.generateBtn.disabled = true;
            return;
        }

        try {
            await WorkflowManager.select(id);
            this.updateInputVisibility();
            this.elements.generateBtn.disabled = false;
        } catch (err) {
            this.setStatus('error', `Failed to load workflow: ${err.message}`);
        }
    },

    updateInputVisibility() {
        // Show/hide based on placeholders in selected workflow
        const showPrompt = WorkflowManager.hasPlaceholder('PROMPT_PLACEHOLDER');
        const showImage = WorkflowManager.hasPlaceholder('IMAGE_PLACEHOLDER');

        this.elements.promptSection.classList.toggle('hidden', !showPrompt);
        this.elements.imageSection.classList.toggle('hidden', !showImage);
    },

    hideAllInputs() {
        this.elements.promptSection.classList.add('hidden');
        this.elements.imageSection.classList.add('hidden');
    },

    async handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) {
            ImageInput.clear();
            this.elements.imageFilename.textContent = 'No image selected';
            this.elements.imageFilename.classList.add('empty');
            return;
        }

        try {
            await ImageInput.load(file);
            this.elements.imageFilename.textContent = ImageInput.getFilename();
            this.elements.imageFilename.classList.remove('empty');
        } catch (err) {
            this.setStatus('error', `Image load error: ${err.message}`);
        }
    },

    async handleGenerate() {
        if (!WorkflowManager.isLoaded()) return;

        const prompt = this.elements.promptInput.value.trim();
        const needsPrompt = WorkflowManager.hasPlaceholder('PROMPT_PLACEHOLDER');
        if (needsPrompt && !prompt) {
            this.setStatus('error', 'Prompt required');
            return;
        }

        this.setGenerating(true);
        ImageDisplay.clear();
        this.elements.jobIdText.textContent = '-';

        try {
            this.setStatus('submitting', 'Submitting job...');
            const imageBase64 = ImageInput.isLoaded() ? ImageInput.getBase64() : null;
            const workflow = WorkflowManager.prepareWithPrompt(prompt, imageBase64);
            const submitResult = await RunPodAPI.submitJob(workflow);

            const jobId = submitResult.id;
            this.elements.jobIdText.textContent = jobId;
            this.setStatus('polling', 'Polling for results...');

            PollingController.start(
                jobId,
                (status) => this.setStatus('polling', `Polling... (${status})`),
                (result) => this.handleComplete(result),
                (err) => this.handleError(err)
            );
        } catch (err) {
            this.handleError(err);
        }
    },

    handleComplete(result) {
        this.setGenerating(false);
        this.setStatus('complete', 'Complete');

        const imageData = ImageDisplay.extractFromResponse(result);
        if (imageData) {
            ImageDisplay.show(imageData);
        } else {
            this.setStatus('error', 'No image in response');
        }
    },

    handleError(err) {
        this.setGenerating(false);
        PollingController.stop();
        this.setStatus('error', `Error: ${err.message}`);
    },

    setStatus(state, message) {
        this.elements.statusText.textContent = message;
        this.elements.statusText.className = `status-value ${state}`;
    },

    setGenerating(isGenerating) {
        this.elements.generateBtn.disabled = isGenerating;
        this.elements.workflowSelect.disabled = isGenerating;
        this.elements.imageInput.disabled = isGenerating;
        this.elements.promptInput.disabled = isGenerating;
    }
};

// Initialize on page load
loadConfig().then(() => {
    UIController.init();
});
