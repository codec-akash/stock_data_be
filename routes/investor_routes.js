const express = require('express');
const router = express.Router();
const investorController = require('../controllers/investor_controller');

// Route to get trades for a specific investor
router.get('/:clientName', investorController.getInvestorTrades);

module.exports = router; 