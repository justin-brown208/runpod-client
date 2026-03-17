const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const s3Client = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    },
    forcePathStyle: true
});

const S3API = {
    /**
     * Upload a video file to S3 inputs folder
     * @param {Buffer|Stream} fileData - File data to upload
     * @param {string} originalFilename - Original filename (for extension)
     * @returns {Promise<string>} - The ref (filename) to use in API calls
     */
    async uploadInput(fileData, originalFilename) {
        const ext = path.extname(originalFilename).toLowerCase();
        const ref = `${randomUUID()}${ext}`;
        const key = `inputs/${ref}`;

        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: process.env.S3_BUCKET,
                Key: key,
                Body: fileData
            }
        });

        await upload.done();
        return ref;
    },

    /**
     * Download an output file from S3 outputs folder
     * @param {string} ref - The ref (filename) from the API response
     * @param {string} destPath - Local destination path
     * @returns {Promise<void>}
     */
    async downloadOutput(ref, destPath) {
        const key = `outputs/${ref}`;

        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key
        });

        const response = await s3Client.send(command);
        await pipeline(response.Body, fs.createWriteStream(destPath));
    },

    /**
     * Delete a file from S3 (for cleanup after download)
     * @param {string} ref - The ref (filename)
     * @param {string} folder - 'inputs' or 'outputs'
     * @returns {Promise<void>}
     */
    async deleteFile(ref, folder = 'outputs') {
        const key = `${folder}/${ref}`;

        const command = new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key
        });

        await s3Client.send(command);
    }
};

module.exports = S3API;
