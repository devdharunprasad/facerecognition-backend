require('dotenv').config();
const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');





const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});
// New

const s3 = new AWS.S3();
const rekognition = new AWS.Rekognition();

// Helper: Upload file to S3
const uploadToS3 = async (file, folder) => {
  const fileContent = fs.readFileSync(file.path);
  const fileExt = path.extname(file.originalname);
  const s3Key = `${folder}/${uuidv4()}${fileExt}`;

  await s3.putObject({
    Bucket: process.env.S3_BUCKET,
    Key: s3Key,
    Body: fileContent,
    ContentType: file.mimetype,
    ACL: 'public-read', // So frontend can access it
  }).promise();

  return {
    key: s3Key,
    url: `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
  };
};

app.get("/", (req, res) => {
  res.send("hello")
})

app.post('/upload', upload.fields([
  { name: 'reference', maxCount: 1 },
  { name: 'eventPhotos', maxCount: 10 },
]), async (req, res) => {
  try {
    const referenceImage = req.files['reference'][0];
    const eventPhotos = req.files['eventPhotos'];

    // Upload reference image to S3
    const referenceS3 = await uploadToS3(referenceImage, 'profile-images');

    const matchedPhotos = [];

    for (let photo of eventPhotos) {
      // Upload event photo to S3
      const eventS3 = await uploadToS3(photo, 'event-photos');

      // Compare faces
      const compareResult = await rekognition.compareFaces({
        SourceImage: {
          S3Object: {
            Bucket: process.env.S3_BUCKET,
            Name: referenceS3.key,
          },
        },
        TargetImage: {
          S3Object: {
            Bucket: process.env.S3_BUCKET,
            Name: eventS3.key,
          },
        },
        SimilarityThreshold: 90,
      }).promise();

      if (compareResult.FaceMatches.length > 0) {
        matchedPhotos.push(eventS3.url);
      }
    }

    res.json({
      profileImage: referenceS3.url,
      matchedPhotos,
    });
  } catch (err) {
    console.error('Error comparing faces:', err);
    res.status(500).send('Something went wrong');
  }
});

app.listen(8000, () => {
  console.log('Server running on http://localhost:8000');
});
