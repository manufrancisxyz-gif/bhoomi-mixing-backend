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

// In-memory storage for tracks and comments (in production, use a database)
const tracks = {}; // { trackId: { title, artist, code, uploadedAt, comments: [] } }
const comments = {}; // { trackId: [{ author, text, timestamp, postedAt }] }

// Generate unique track ID
function generateTrackId() {
  return 'track_' + Math.random().toString(36).substr(2, 9);
}

// Test endpoint to verify admin code
app.post('/api/test-admin-code', express.json(), (req, res) => {
  const { admin_code } = req.body;
  const correct_code = process.env.ADMIN_CODE || 'not-set';
  
  res.json({
    provided: admin_code,
    expected: correct_code,
    match: admin_code === correct_code,
    env_admin_code: process.env.ADMIN_CODE,
    env_set: !!process.env.ADMIN_CODE
  });
});

// Admin: Upload track for client delivery
app.post('/api/admin/upload-delivery', upload.single('files'), async (req, res) => {
  try {
    const { title, artist, download_code, admin_code } = req.body;

    // Verify admin password with trimming and logging
    const providedCode = String(admin_code || '').trim();
    const expectedCode = String(process.env.ADMIN_CODE || '').trim();
    
    console.log('=== ADMIN CODE VALIDATION ===');
    console.log('Provided:', providedCode);
    console.log('Expected:', expectedCode);
    console.log('Match:', providedCode === expectedCode);
    
    if (providedCode !== expectedCode || !providedCode) {
      return res.status(401).json({ error: 'Invalid admin code' });
    }

    if (!title || !artist || !download_code || !req.file) {
      return res.status(400).json({ error: 'Missing required fields: title, artist, download_code, file' });
    }

    const trackId = generateTrackId();
    const fileName = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.mp3`;
    const deliveryPath = `delivery/${trackId}/${fileName}`;

    // Upload to R2
    const uploadParams = {
      Bucket: 'mixing-submissions', // Use same bucket or create new one
      Key: deliveryPath,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'audio/mpeg',
    };

    await s3.upload(uploadParams).promise();
    console.log('✓ Delivery track uploaded:', deliveryPath);

    // Store track metadata in memory
    tracks[trackId] = {
      id: trackId,
      title,
      artist,
      download_code,
      uploadedAt: new Date(),
      fileName,
      r2Path: deliveryPath
    };

    comments[trackId] = [];

    res.json({
      success: true,
      trackId,
      shareLink: `/listen/${trackId}`,
      fullLink: `${process.env.FRONTEND_URL || 'https://bhoomirecords.com'}/listen/${trackId}`
    });

  } catch (error) {
    console.error('Error uploading delivery track:', error);
    res.status(500).json({ error: 'Failed to upload track', details: error.message });
  }
});

// Client: Get track info (without download code validation)
app.get('/api/tracks/:trackId', (req, res) => {
  const track = tracks[req.params.trackId];
  if (!track) {
    return res.status(404).json({ error: 'Track not found' });
  }

  res.json({
    id: track.id,
    title: track.title,
    artist: track.artist,
    uploadedAt: track.uploadedAt
  });
});

// Client: Get track comments
app.get('/api/tracks/:trackId/comments', (req, res) => {
  const trackComments = comments[req.params.trackId] || [];
  res.json({ comments: trackComments });
});

// Client: Stream audio file
app.get('/api/tracks/:trackId/stream', async (req, res) => {
  const track = tracks[req.params.trackId];
  if (!track) {
    return res.status(404).json({ error: 'Track not found' });
  }

  try {
    // Generate presigned URL for streaming (valid for 1 hour)
    const signedUrl = await s3.getSignedUrl('getObject', {
      Bucket: 'mixing-submissions',
      Key: track.r2Path,
      Expires: 3600 // 1 hour for streaming
    });

    // Redirect to R2 signed URL for streaming
    res.redirect(signedUrl);
  } catch (error) {
    console.error('Error streaming audio:', error);
    res.status(500).json({ error: 'Failed to stream audio' });
  }
});

// Client: Add comment with timestamp
app.post('/api/tracks/:trackId/comments', express.json(), (req, res) => {
  const { author, text, timestamp } = req.body;

  if (!author || !text || timestamp === undefined) {
    return res.status(400).json({ error: 'Missing required fields: author, text, timestamp' });
  }

  if (!comments[req.params.trackId]) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const comment = {
    id: 'comment_' + Math.random().toString(36).substr(2, 9),
    author,
    text,
    timestamp: parseFloat(timestamp),
    postedAt: new Date()
  };

  comments[req.params.trackId].push(comment);
  res.json({ success: true, comment });
});

// Client: Validate download code and get download URL
app.post('/api/tracks/:trackId/validate-download', express.json(), async (req, res) => {
  const { download_code } = req.body;
  const track = tracks[req.params.trackId];

  if (!track) {
    return res.status(404).json({ error: 'Track not found' });
  }

  if (download_code !== track.download_code) {
    return res.status(401).json({ error: 'Invalid download code' });
  }

  // Generate presigned URL for download (valid for 24 hours)
  try {
    const signedUrl = await s3.getSignedUrl('getObject', {
      Bucket: 'mixing-submissions',
      Key: track.r2Path,
      Expires: 86400 // 24 hours
    });

    res.json({
      success: true,
      downloadUrl: signedUrl,
      fileName: track.fileName
    });
  } catch (error) {
    console.error('Error generating download URL:', error);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bhoomi Mixing Backend running on port ${PORT}`);
  console.log(`Using Cloudflare R2 for file uploads`);
  console.log(`Delivery system endpoints available`);
});
