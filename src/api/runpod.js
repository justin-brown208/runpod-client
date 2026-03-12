const API_BASE = `https://api.runpod.ai/v2/${process.env.RUNPOD_ENDPOINT_ID}`;

const RunPodAPI = {
    async submitJob(requestBody) {
        const response = await fetch(`${API_BASE}/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.RUNPOD_API_KEY}`
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
                'Authorization': `Bearer ${process.env.RUNPOD_API_KEY}`
            }
        });

        if (!response.ok) {
            throw new Error(`Status check failed: ${response.status}`);
        }

        return response.json();
    }
};

module.exports = RunPodAPI;
