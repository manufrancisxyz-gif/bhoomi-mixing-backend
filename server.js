const express = require('express');
const multer = require('multer');
const cors = require('cors');
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Simple submission endpoint (no Google Drive for now)
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

    console.log('✓ All validations passed');
    
    // For now, just return success without uploading to Google Drive
    // This lets us test if the backend and frontend communication works
    res.json({
      success: true,
      message: 'Submission received (test mode - not uploading yet)',
      data: {
        email,
        service,
        song_title,
        artist,
        bpm,
        fileName: req.file.originalname,
        fileSize: req.file.size
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
});
