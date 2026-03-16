const express = require('express');
const multer = require('multer');
const cors = require('cors');
const AWS = require('aws-sdk');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.options('*', cors());

// Explicit CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
// Cloudflare R2 supports files up to 5GB per file
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5GB per file - R2 max
});

// Error handling for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5GB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files uploaded.' });
    }
  }
  next(err);
});

// Initialize Cloudflare R2 client
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mixing-submissions';

const s3 = new AWS.S3({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

console.log('Cloudflare R2 initialized');
console.log(`Account ID: ${R2_ACCOUNT_ID}`);
console.log(`Bucket: ${R2_BUCKET_NAME}`);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Bhoomi Mixing Backend is running' });
});

// Form submission endpoint
app.post('/api/submit', upload.single('files'), async (req, res) => {
  try {
    console.log('=== SUBMISSION RECEIVED ===');
    console.log('Method: POST');
    console.log('Body keys:', Object.keys(req.body));
    console.log('File:', req.file?.originalname);

    const { email, service, song_title, artist, bpm, notes } = req.body;

    // Validate required fields
    if (!email || !service || !song_title || !artist) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['email', 'service', 'song_title', 'artist']
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Create folder path: artist/song_title
    const folderPath = `${artist.replace(/\//g, '-')}/${song_title.replace(/\//g, '-')}`;
    const fileName = `${req.file.originalname}`;
    const filePath = `${folderPath}/${fileName}`;

    const fileSizeMB = req.file.size / (1024 * 1024);
    console.log(`Uploading file to R2: ${filePath} (${fileSizeMB.toFixed(2)}MB)`);

    // Upload file to Cloudflare R2
    const uploadParams = {
      Bucket: R2_BUCKET_NAME,
      Key: filePath,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream',
    };

    await s3.upload(uploadParams).promise();
    console.log('✓ File uploaded successfully to R2:', filePath);

    // Create a simple text file with all submission info
    const submissionInfo = `BHOOMI RECORDS - MIXING SUBMISSION INFO
======================================

Email: ${email}
Service Type: ${service}
Song Title: ${song_title}
Artist/Project: ${artist}
BPM: ${bpm || 'Not specified'}

SPECIAL INSTRUCTIONS / NOTES:
${notes || 'None'}

FILE INFORMATION:
Submitted: ${new Date().toISOString()}
File Size: ${fileSizeMB.toFixed(2)} MB
File Name: ${fileName}

======================================`;

    const infoPath = `${folderPath}/SUBMISSION_INFO.txt`;
    const infoBuffer = Buffer.from(submissionInfo);

    const infoParams = {
      Bucket: R2_BUCKET_NAME,
      Key: infoPath,
      Body: infoBuffer,
      ContentType: 'text/plain',
    };

    await s3.upload(infoParams).promise();
    console.log('✓ Submission info saved:', infoPath);

    // Return success response
    res.json({
      success: true,
      message: 'Submission received and uploaded successfully',
      data: {
        artist,
        song: song_title,
        fileSize: `${fileSizeMB.toFixed(2)} MB`,
        uploadPath: filePath,
        infoPath: infoPath
      }
    });

    console.log('✓ Response sent successfully');

  } catch (error) {
    console.error('✗ Error processing submission:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      error: 'Failed to process submission',
      details: error.message,
      errorType: error.name
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bhoomi Mixing Backend running on port ${PORT}`);
  console.log(`Using Cloudflare R2 for file uploads`);
});
