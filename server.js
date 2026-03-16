const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
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
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Initialize Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

console.log('Initializing Supabase...');
console.log('URL:', SUPABASE_URL ? 'set' : 'NOT SET');
console.log('Service Key:', SUPABASE_SERVICE_KEY ? 'set' : 'NOT SET');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log('✓ Supabase initialized');

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running with Supabase' });
});

// Main submission endpoint
app.post('/api/submit', upload.single('file'), async (req, res) => {
  console.log('=== SUBMISSION RECEIVED ===');
  console.log('Method:', req.method);
  console.log('Body keys:', Object.keys(req.body));
  console.log('File:', req.file ? req.file.originalname : 'NO FILE');
  
  try {
    if (!req.file) {
      console.log('✗ No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { email, service, song_title, artist, bpm, notes } = req.body;

    console.log('Form data:', { email, service, song_title, artist, bpm });

    // Validate required fields
    if (!email || !service || !song_title || !artist) {
      console.log('✗ Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create folder path: artist/song_title
    const folderPath = `${artist.replace(/\//g, '-')}/${song_title.replace(/\//g, '-')}`;
    const fileName = `${req.file.originalname}`;
    const filePath = `${folderPath}/${fileName}`;

    console.log(`Uploading file to Supabase: ${filePath}`);

    // Upload file to Supabase Storage
    const { data, error } = await supabase.storage
      .from('mixing-submissions')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype || 'application/zip',
        upsert: false
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return res.status(500).json({ 
        error: 'Failed to upload file',
        details: error.message 
      });
    }

    console.log('✓ File uploaded successfully:', data.path);

    // Create metadata file
    const metadata = {
      email,
      serviceType: service,
      songName: song_title,
      artistName: artist,
      bpm: bpm || 'Not specified',
      notes: notes || 'None',
      fileName: fileName,
      fileSize: req.file.size,
      submittedAt: new Date().toISOString()
    };

    const metadataPath = `${folderPath}/metadata.json`;
    const metadataBuffer = Buffer.from(JSON.stringify(metadata, null, 2));

    const { error: metadataError } = await supabase.storage
      .from('mixing-submissions')
      .upload(metadataPath, metadataBuffer, {
        contentType: 'application/json',
        upsert: true
      });

    if (metadataError) {
      console.error('Metadata upload error:', metadataError);
      // Don't fail if metadata fails, file is already uploaded
    } else {
      console.log('✓ Metadata saved');
    }

    // Return success response with file info
    res.json({
      success: true,
      message: 'Submission received and uploaded successfully',
      data: {
        artist,
        song: song_title,
        fileSize: req.file.size,
        uploadPath: data.path
      }
    });

    console.log('✓ Response sent successfully');

  } catch (error) {
    console.error('Error processing submission:', error);
    res.status(500).json({ 
      error: 'Failed to process submission',
      details: error.message 
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bhoomi Mixing Backend running on port ${PORT}`);
  console.log(`Using Supabase Storage for file uploads`);
});
