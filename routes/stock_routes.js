const express = require('express');
const router = express.Router();
const multer = require('multer');
const stockController = require('../controllers/stock_controller');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        fieldSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

// Wrap upload middleware in error handler
router.post('/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({
                error: 'File upload error',
                details: err.message
            });
        } else if (err) {
            return res.status(500).json({
                error: 'Server error during upload',
                details: err.message
            });
        }
        stockController.uploadCSV(req, res);
    });
});

// Add this new route along with your existing routes
router.get('/deals', stockController.getStocks);

router.get('/filters', stockController.getFilters);

module.exports = router;