const express = require('express');
const router = express.Router();
const investorController = require('../controllers/investor_controller');

// Route to get trades for a specific investor
router.get('/:clientName', investorController.getInvestorTrades);

// Route to get investors holding a specific stock
router.get('/', investorController.getInvestorsByStock);

module.exports = router; 