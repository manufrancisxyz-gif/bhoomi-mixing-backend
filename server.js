const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const cors = require('cors');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const app = express();

// Middleware
const corsOptions = {
  origin: [
    'https://sparkling-tartufo-32a611.netlify.app',
    'https://bhoomirecords.com',
    'http://localhost:3000',
    'http://localhost:5000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Google Drive API setup
let GOOGLE_CREDENTIALS;
const credsString = process.env.GOOGLE_CREDENTIALS;

console.log('Checking GOOGLE_CREDENTIALS...');
console.log('Type:', typeof credsString);
console.log('Length:', credsString ? credsString.length : 0);

try {
  if (credsString) {
    // If it's already an object, use it directly
    if (typeof credsString === 'object') {
      GOOGLE_CREDENTIALS = credsString;
    } else {
      // Otherwise parse it as JSON string
      GOOGLE_CREDENTIALS = JSON.parse(credsString);
    }
    console.log('✓ Credentials loaded successfully');
  } else {
    throw new Error('GOOGLE_CREDENTIALS is empty or undefined');
  }
} catch (error) {
  console.error('✗ Failed to parse GOOGLE_CREDENTIALS:', error.message);
  console.error('Raw value:', credsString?.substring(0, 100));
  process.exit(1);
}

const GOOGLE_FOLDER_ID = process.env.GOOGLE_FOLDER_ID;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;

if (!GOOGLE_FOLDER_ID) {
  console.error('✗ GOOGLE_FOLDER_ID is missing');
  process.exit(1);
}

console.log('✓ GOOGLE_FOLDER_ID:', GOOGLE_FOLDER_ID);

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/drive']
});

const drive = google.drive({ version: 'v3', auth });

// Email transporter setup (using Gmail)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Utility: Create folder in Google Drive
async function createFolder(folderName, parentId) {
  try {
    const response = await drive.files.create({
      resource: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      },
      fields: 'id'
    });
    return response.data.id;
  } catch (error) {
    console.error('Error creating folder:', error);
    throw error;
  }
}

// Utility: Upload file to Google Drive
async function uploadFile(fileName, fileBuffer, parentId, mimeType = 'application/zip') {
  try {
    const response = await drive.files.create({
      resource: {
        name: fileName,
        parents: [parentId]
      },
      media: {
        mimeType: mimeType,
        body: require('stream').Readable.from([fileBuffer])
      },
      fields: 'id, webViewLink'
    });
    return response.data;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

// Utility: Send notification email
async function sendNotificationEmail(data, fileLink) {
  const serviceLabel = {
    mixing: 'Mixing Only',
    mastering: 'Mastering Only',
    both: 'Mixing + Mastering'
  };

  const emailContent = `
    <h2>New Mixing Submission</h2>
    <p><strong>Song Title:</strong> ${data.songName}</p>
    <p><strong>Artist/Project:</strong> ${data.artistName}</p>
    <p><strong>Service Type:</strong> ${serviceLabel[data.serviceType]}</p>
    <p><strong>BPM:</strong> ${data.bpm || 'Not specified'}</p>
    <p><strong>Email:</strong> ${data.email}</p>
    <p><strong>Notes:</strong></p>
    <p>${data.notes || 'None'}</p>
    <p><strong>File Link:</strong> <a href="${fileLink}">View in Google Drive</a></p>
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: NOTIFICATION_EMAIL,
      subject: `New Submission: ${data.artistName} - ${data.songName}`,
      html: emailContent
    });
    console.log('Notification email sent');
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
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

    // Create folder name: "Artist - Song"
    const folderName = `${artist} - ${song_title}`;

    // Create folder in Google Drive
    console.log(`Creating folder: ${folderName}`);
    const folderId = await createFolder(folderName, GOOGLE_FOLDER_ID);
    console.log(`✓ Folder created: ${folderId}`);

    // Upload ZIP file
    console.log(`Uploading file: ${req.file.originalname}`);
    const fileResult = await uploadFile(
      req.file.originalname,
      req.file.buffer,
      folderId,
      'application/zip'
    );
    console.log(`✓ File uploaded`);

    // Create metadata file
    const metadata = {
      email,
      serviceType: service,
      songName: song_title,
      artistName: artist,
      bpm: bpm || 'Not specified',
      notes: notes || 'None',
      submittedAt: new Date().toISOString()
    };

    const metadataContent = JSON.stringify(metadata, null, 2);
    const metadataBuffer = Buffer.from(metadataContent, 'utf-8');

    await uploadFile('metadata.json', metadataBuffer, folderId, 'application/json');

    // Send notification email
    await sendNotificationEmail(metadata, fileResult.webViewLink);

    res.json({
      success: true,
      message: 'Submission received and processed',
      folderId,
      fileId: fileResult.id
    });

  } catch (error) {
    console.error('Error processing submission:', error);
    res.status(500).json({ 
      error: 'Failed to process submission',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'Backend is running' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bhoomi Mixing Backend running on port ${PORT}`);
});
