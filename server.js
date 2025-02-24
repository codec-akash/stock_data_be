const express = require('express');
const sequelize = require('./config/database');
const stockRoutes = require('./routes/stock_routes');
const userRoutes = require('./routes/user_routes');
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

app.get('/', (req, res) => {
    res.send('Nothing to see here. Move along.');
});


app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Routes
app.use('/api/stocks', stockRoutes);
app.use('/api/user', userRoutes);

// 404 handler for routes that don't exist
app.use((req, res) => {
    res.status(404).json({ error: "You are lost" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});