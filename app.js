const API_BASE = `https://api.runpod.ai/v2/${CONFIG.endpointId}`;

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
// Module 2: Workflow Handler
// ===========================================
const WorkflowHandler = {
    workflow: null,
    filename: null,

    load(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    this.workflow = JSON.parse(e.target.result);
                    this.filename = file.name;
                    resolve(this.workflow);
                } catch (err) {
                    reject(new Error('Invalid JSON file'));
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    },

    isLoaded() {
        return this.workflow !== null;
    },

    getFilename() {
        return this.filename;
    },

    prepareWithPrompt(prompt, imageBase64 = null) {
        const workflowCopy = JSON.parse(JSON.stringify(this.workflow));
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
            // Already has the correct structure
            return parsed;
        }

        // Wrap raw workflow in required parent structure
        return {
            input: {
                workflow: parsed
            }
        };
    }
};

// ===========================================
// Module 3: RunPod API Client
// ===========================================
const RunPodAPI = {
    async submitJob(requestBody) {
        // requestBody is the complete request structure (already contains input.workflow)
        console.log('Submitting:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(`${API_BASE}/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Submit failed: ${response.status} - ${errorText}`);
        }

        return response.json();
    },

    async checkStatus(jobId) {
        const response = await fetch(`${API_BASE}/status/${jobId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`
            }
        });

        if (!response.ok) {
            throw new Error(`Status check failed: ${response.status}`);
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
        workflowInput: document.getElementById('workflow-input'),
        workflowFilename: document.getElementById('workflow-filename'),
        imageInput: document.getElementById('image-input'),
        imageFilename: document.getElementById('image-filename'),
        promptInput: document.getElementById('prompt-input'),
        generateBtn: document.getElementById('generate-btn'),
        statusText: document.getElementById('status-text'),
        jobIdText: document.getElementById('job-id-text')
    },

    init() {
        this.elements.workflowInput.addEventListener('change', (e) => this.handleWorkflowUpload(e));
        this.elements.imageInput.addEventListener('change', (e) => this.handleImageUpload(e));
        this.elements.generateBtn.addEventListener('click', () => this.handleGenerate());
        this.updateButtonState();
    },

    async handleWorkflowUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            await WorkflowHandler.load(file);
            this.elements.workflowFilename.textContent = WorkflowHandler.getFilename();
            this.elements.workflowFilename.classList.remove('empty');
            this.updateButtonState();
        } catch (err) {
            this.setStatus('error', `Load error: ${err.message}`);
        }
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
        const prompt = this.elements.promptInput.value.trim();
        if (!prompt || !WorkflowHandler.isLoaded()) return;

        this.setGenerating(true);
        ImageDisplay.clear();
        this.elements.jobIdText.textContent = '-';

        try {
            this.setStatus('submitting', 'Submitting job...');
            const imageBase64 = ImageInput.isLoaded() ? ImageInput.getBase64() : null;
            const workflow = WorkflowHandler.prepareWithPrompt(prompt, imageBase64);
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
        this.elements.workflowInput.disabled = isGenerating;
        this.elements.imageInput.disabled = isGenerating;
        this.elements.promptInput.disabled = isGenerating;
    },

    updateButtonState() {
        const hasWorkflow = WorkflowHandler.isLoaded();
        this.elements.generateBtn.disabled = !hasWorkflow;
    }
};

// Initialize on page load
UIController.init();
