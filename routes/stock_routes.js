const express = require('express');
const router = express.Router();
const multer = require('multer');
const stockController = require('../controllers/stock_controller');

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

// Add file filter to only accept CSV files
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
        cb(null, true);
    } else {
        cb(new Error('Only CSV files are allowed'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // Limit file size to 10MB
    }
});

// Route to handle CSV file upload
router.post('/upload', upload.single('file'), stockController.uploadCSV);

// Error handling middleware
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            error: 'File upload error',
            details: error.message
        });
    }
    next(error);
});

// Add this new route along with your existing routes
router.get('/', stockController.getStocks);

router.get('/filter/', stockController.getFilters);

module.exports = router;