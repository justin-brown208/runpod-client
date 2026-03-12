# Runpod Serverless API Request Documentation

Source: https://docs.runpod.io/serverless/endpoints/send-requests

## Core Concepts

Runpod serverless endpoints accept HTTP requests to submit jobs for processing. A "job" packages input data for worker processing. Jobs either execute immediately (synchronous) or queue for later processing (asynchronous).

## Request Input Structure

All requests require a JSON object with an `input` key containing worker-specific parameters:

```json
{
  "input": {
    "prompt": "Your input here"
  }
}
```

Parameters depend on the specific worker implementation.

## Synchronous vs. Asynchronous Operations

**Synchronous (`/runsync`):**
- Client waits for job completion
- Results are available for 1 minute by default (5 minutes max)
- Maximum payload: 20 MB
- Best for quick responses and interactive applications

**Asynchronous (`/run`):**
- Job processes in background, returns job ID immediately
- Results available 30 minutes after completion
- Maximum payload: 10 MB
- Best for long-running tasks

Extend sync result availability using `?wait=x` parameter (milliseconds, max 300000).

## API Operations

| Operation | Method | Purpose |
|-----------|--------|---------|
| `/runsync` | POST | Submit synchronous job |
| `/run` | POST | Submit asynchronous job |
| `/status` | GET | Check job status and retrieve results |
| `/stream` | GET | Receive incremental results |
| `/cancel` | POST | Stop job execution |
| `/retry` | POST | Requeue failed/timed-out jobs |
| `/purge-queue` | POST | Clear pending jobs |
| `/health` | GET | Monitor endpoint operational status |

## Request/Response Examples

### /runsync Response
```json
{
  "delayTime": 824,
  "executionTime": 3391,
  "id": "sync-79164ff4-d212-44bc-9fe3-389e199a5c15",
  "output": [{"image": "https://image.url", "seed": 46578}],
  "status": "COMPLETED"
}
```

### /run Response
```json
{
  "id": "eaebd6e7-6a92-4bb8-a911-f996ac5ea99d",
  "status": "IN_QUEUE"
}
```

### /status Response
```json
{
  "delayTime": 31618,
  "executionTime": 1437,
  "id": "60902e6c-08a1-426e-9cb9-9eaec90f5e2b-u1",
  "output": {"text": ["Hello! How can I assist you today?"]},
  "status": "COMPLETED"
}
```

### /health Response
```json
{
  "jobs": {
    "completed": 1,
    "failed": 5,
    "inProgress": 0,
    "inQueue": 2,
    "retried": 0
  },
  "workers": {"idle": 0, "running": 0}
}
```

## Advanced Options

### Webhook Notifications
```json
{
  "input": {"prompt": "Your input here"},
  "webhook": "https://your-webhook-url.com"
}
```

Runpod POSTs results to the webhook URL. Expects 200 status code; retries up to 2 additional times with 10-second delays.

### Execution Policies
```json
{
  "input": {"prompt": "Your input here"},
  "policy": {
    "executionTimeout": 900000,
    "lowPriority": false,
    "ttl": 3600000
  }
}
```

**Policy Parameters:**
- `executionTimeout`: Maximum runtime (milliseconds, default 600000/10 min, min 5000)
- `lowPriority`: Prevents worker scaling when true (default false)
- `ttl`: Maximum job lifetime (milliseconds, default 86400000/24 hrs, 10 sec–1 week range)

### S3-Compatible Storage
```json
{
  "input": {"prompt": "Your input here"},
  "s3Config": {
    "accessId": "KEY_ID",
    "accessSecret": "SECRET_KEY",
    "bucketName": "BUCKET_NAME",
    "endpointUrl": "ENDPOINT_URL"
  }
}
```

Works with MinIO, Backblaze B2, DigitalOcean Spaces, and other S3-compatible providers.

## Rate Limits

| Operation | Method | Limit | Concurrent |
|-----------|--------|-------|-----------|
| `/runsync` | POST | 2000/10s | 400 |
| `/run` | POST | 1000/10s | 200 |
| `/status` | GET | 2000/10s | 400 |
| `/stream` | GET | 2000/10s | 400 |
| `/cancel` | POST | 100/10s | 20 |
| `/purge-queue` | POST | 2/10s | N/A |

Dynamic rate limiting scales based on running workers: effective limit = `max(base_limit, workers × per_worker_limit)`. Exceeding limits returns `429 (Too Many Requests)`.

## SDK Installation

```bash
# Python
python -m pip install runpod

# JavaScript
npm install --save runpod-sdk

# Go
go get github.com/runpod/go-sdk && go mod tidy
```

## Python SDK Examples

**Synchronous:**
```python
import runpod, os
runpod.api_key = os.getenv("RUNPOD_API_KEY")
endpoint = runpod.Endpoint(os.getenv("ENDPOINT_ID"))
run_request = endpoint.run_sync({"prompt": "Hello, world!"}, timeout=60)
```

**Asynchronous:**
```python
run_request = endpoint.run({"prompt": "Hello, World!"})
status = run_request.status()
output = run_request.output(timeout=60)
```

**Cancel:**
```python
run_request.cancel()
```

**Health:**
```python
endpoint_health = endpoint.health()
```

## JavaScript SDK Examples

**Synchronous:**
```javascript
const runpod = runpodSdk(RUNPOD_API_KEY);
const endpoint = runpod.endpoint(ENDPOINT_ID);
const result = await endpoint.runSync({
  input: {"prompt": "Hello, World!"},
  timeout: 60000
});
```

**Asynchronous:**
```javascript
const result = await endpoint.run({input: {"prompt": "Hello, World!"}});
const status = await endpoint.status(result.id);
```

**Stream:**
```javascript
for await (const result of endpoint.stream(jobId)) {
  console.log(result);
}
```

## cURL Examples

**Synchronous:**
```bash
curl --request POST \
  --url https://api.runpod.ai/v2/$ENDPOINT_ID/runsync \
  -H "authorization: $RUNPOD_API_KEY" \
  -H "content-type: application/json" \
  -d '{"input": {"prompt": "Hello, world!"}}'
```

**Asynchronous:**
```bash
curl --request POST \
  --url https://api.runpod.ai/v2/$ENDPOINT_ID/run \
  -H "authorization: $RUNPOD_API_KEY" \
  -H "content-type: application/json" \
  -d '{"input": {"prompt": "Hello, world!"}}'
```

**Status:**
```bash
curl --request GET \
  --url https://api.runpod.ai/v2/$ENDPOINT_ID/status/YOUR_JOB_ID \
  -H "authorization: $RUNPOD_API_KEY"
```

**Cancel:**
```bash
curl --request POST \
  --url https://api.runpod.ai/v2/$ENDPOINT_ID/cancel/YOUR_JOB_ID \
  -H "authorization: $RUNPOD_API_KEY"
```

**Health:**
```bash
curl --request GET \
  --url https://api.runpod.ai/v2/$ENDPOINT_ID/health \
  -H "authorization: $RUNPOD_API_KEY"
```

**Purge Queue:**
```bash
curl --request POST \
  --url https://api.runpod.ai/v2/$ENDPOINT_ID/purge-queue \
  -H "authorization: $RUNPOD_API_KEY"
```

## Streaming

Enable streaming by setting `"return_aggregate_stream": True` in handler configuration. Maximum streamed chunk size: 1 MB.

**Streaming response format:**
```json
[
  {
    "metrics": {
      "input_tokens": 0,
      "output_tokens": 1,
      "stream_index": 2
    },
    "output": {"text": [" How"]}
  }
]
```

## Error Handling

| HTTP Status | Issue | Solution |
|------------|-------|----------|
| 400 | Bad Request | Verify request format and parameters |
| 401 | Unauthorized | Confirm API key validity and permissions |
| 404 | Not Found | Check endpoint ID |
| 429 | Rate Limited | Implement exponential backoff retry logic |
| 500 | Server Error | Review endpoint logs; worker may have crashed |

## Common Issues

- **Queue bottleneck**: Increase max workers; monitor endpoint health
- **Timeout errors**: Raise execution timeout in policy; optimize processing
- **Failed jobs**: Check logs; validate input format; retry with corrections
- **Missing results**: Retrieve within expiration (30 min async, 1 min sync, 5 min with `?wait`)

## Best Practices

- Use asynchronous requests for jobs exceeding a few seconds
- Implement polling with backoff for status checks
- Set appropriate timeouts and monitor endpoint health regularly
- Handle errors comprehensively across all API calls
- Prefer webhooks over polling to reduce API overhead
- Cancel unnecessary jobs to free resources
- Test endpoints via console before implementing programmatic integration
