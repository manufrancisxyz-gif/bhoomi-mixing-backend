const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const cors = require('cors');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Google Drive API setup
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const GOOGLE_FOLDER_ID = process.env.GOOGLE_FOLDER_ID;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;

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

// Main submission endpoint
app.post('/api/submit', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { email, serviceType, songName, artistName, bpm, notes } = req.body;

    // Validate required fields
    if (!email || !serviceType || !songName || !artistName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create folder name: "Artist - Song"
    const folderName = `${artistName} - ${songName}`;

    // Create folder in Google Drive
    console.log(`Creating folder: ${folderName}`);
    const folderId = await createFolder(folderName, GOOGLE_FOLDER_ID);

    // Upload ZIP file
    console.log(`Uploading file: ${req.file.originalname}`);
    const fileResult = await uploadFile(
      req.file.originalname,
      req.file.buffer,
      folderId,
      'application/zip'
    );

    // Create metadata file
    const metadata = {
      email,
      serviceType,
      songName,
      artistName,
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
