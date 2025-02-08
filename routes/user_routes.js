const express = require('express');
const router = express.Router();
const userController = require('../controllers/user_controller');


router.post('/notification', userController.getUserNotification);

module.exports = router;