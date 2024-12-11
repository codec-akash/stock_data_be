const express = require('express');
const sequelize = require('./config/database');
const stockRoutes = require('./routes/stock_routes');
const fs = require('fs');
const app = express();

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Initialize database connection
async function initDatabase() {
    try {
        await sequelize.authenticate();
        console.log('Database connection established successfully.');

        // Sync database (create tables if they don't exist)
        await sequelize.sync();
        console.log('Database synchronized successfully.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
}

initDatabase();

// Routes
app.use('/api/stocks', stockRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});