const express = require('express');
const multer = require('multer');
const cors = require('cors');
const AWS = require('aws-sdk');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Initialize S3 client for Cloudflare R2
const s3 = new AWS.S3({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

const bucket = process.env.R2_BUCKET_NAME || 'mixing-submissions';

// In-memory storage for tracks and comments
const tracks = {};
const comments = {};

function generateTrackId() {
  return 'track_' + Math.random().toString(36).substr(2, 9);
}

// ============= ENDPOINTS =============

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Bhoomi Mixing Backend is running' });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is working!', timestamp: new Date() });
});

// Form submission (artists)
app.post('/api/submit', upload.single('files'), async (req, res) => {
  try {
    const { email, service, song_title, artist, bpm, notes } = req.body;

    if (!email || !service || !song_title || !artist || !req.file) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const folderPath = `${artist.replace(/\//g, '-')}/${song_title.replace(/\//g, '-')}`;
    const filePath = `${folderPath}/${req.file.originalname}`;

    const params = {
      Bucket: bucket,
      Key: filePath,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    await s3.upload(params).promise();

    res.json({
      success: true,
      message: 'Submission received',
      file: filePath,
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Admin: Upload delivery track
app.post('/api/admin/upload-delivery', upload.single('files'), async (req, res) => {
  try {
    const { title, artist, download_code, admin_code } = req.body;

    // Validate admin code
    const expectedCode = String(process.env.ADMIN_CODE || '').trim();
    const providedCode = String(admin_code || '').trim();

    console.log('Admin code validation:', {
      provided: providedCode,
      expected: expectedCode,
      match: providedCode === expectedCode,
    });

    if (providedCode !== expectedCode) {
      return res.status(401).json({ error: 'Invalid admin code' });
    }

    if (!title || !artist || !download_code || !req.file) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const trackId = generateTrackId();
    const fileName = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.mp3`;
    const deliveryPath = `delivery/${trackId}/${fileName}`;

    const params = {
      Bucket: bucket,
      Key: deliveryPath,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    await s3.upload(params).promise();

    // Store track metadata
    tracks[trackId] = {
      id: trackId,
      title,
      artist,
      download_code,
      uploadedAt: new Date(),
      fileName,
      r2Path: deliveryPath,
    };

    comments[trackId] = [];

    res.json({
      success: true,
      trackId,
      shareLink: `/listen/${trackId}`,
      fullLink: `${process.env.FRONTEND_URL || 'https://bhoomirecords.com'}/listen/${trackId}`,
    });
  } catch (error) {
    console.error('Error uploading delivery:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Get track info
app.get('/api/tracks/:trackId', (req, res) => {
  const track = tracks[req.params.trackId];
  if (!track) {
    return res.status(404).json({ error: 'Track not found' });
  }
  res.json({
    id: track.id,
    title: track.title,
    artist: track.artist,
    uploadedAt: track.uploadedAt,
  });
});

// Get track stream
app.get('/api/tracks/:trackId/stream', async (req, res) => {
  try {
    const track = tracks[req.params.trackId];
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    const signedUrl = s3.getSignedUrl('getObject', {
      Bucket: bucket,
      Key: track.r2Path,
      Expires: 3600,
    });

    res.json({ url: signedUrl });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stream' });
  }
});

// Get comments
app.get('/api/tracks/:trackId/comments', (req, res) => {
  const trackComments = comments[req.params.trackId] || [];
  res.json({ comments: trackComments });
});

// Post comment
app.post('/api/tracks/:trackId/comments', express.json(), (req, res) => {
  const { author, text, timestamp } = req.body;

  if (!author || !text) {
    return res.status(400).json({ error: 'Missing author or text' });
  }

  if (!comments[req.params.trackId]) {
    comments[req.params.trackId] = [];
  }

  const comment = {
    id: Math.random().toString(36).substr(2, 9),
    author,
    text,
    timestamp: timestamp || 0,
    createdAt: new Date(),
  };

  comments[req.params.trackId].push(comment);
  res.json({ success: true, comment });
});

// Validate download code
app.post('/api/tracks/:trackId/validate-download', express.json(), (req, res) => {
  try {
    const { download_code } = req.body;
    const track = tracks[req.params.trackId];

    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    if (download_code !== track.download_code) {
      return res.status(401).json({ error: 'Invalid download code' });
    }

    const signedUrl = s3.getSignedUrl('getObject', {
      Bucket: bucket,
      Key: track.r2Path,
      Expires: 86400, // 24 hours
    });

    res.json({
      success: true,
      downloadUrl: signedUrl,
      expiresIn: 86400,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate download link' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bhoomi Mixing Backend running on port ${PORT}`);
  console.log(`R2 Bucket: ${bucket}`);
  console.log('Delivery system endpoints available');
});
