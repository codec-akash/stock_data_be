const fs = require('fs');
const csv = require('csv-parser');
const Stock = require('../models/stock');
const sequelize = require('../config/database');
const { Op } = require('sequelize');
const e = require('express');
const express = require('express');
const app = express();

// Add these configurations before routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({
    extended: true,
    limit: '10mb'
}));

// Increase timeout
app.use((req, res, next) => {
    req.setTimeout(300000); // 5 minutes
    res.setTimeout(300000);
    next();
});

const validateSortField = (field) => {
    const allowedFields = ['date', 'symbol', 'securityName', 'clientName', 'tradeType', 'quantityTraded', 'tradePrice'];
    return allowedFields.includes(field) ? field : 'date';
};

const validateDateFormat = (dateString) => {
    const date = new Date(dateString);
    if (date instanceof Date && !isNaN(date)) {
        // Convert to IST (UTC+5:30)
        date.setMinutes(date.getMinutes() + 330);
        return date;
    }
    return null;
};

exports.uploadCSV = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const results = [];
        const duplicates = [];
        let processedCount = 0;

        // First, process CSV file and collect all data
        await new Promise((resolve, reject) => {
            fs.createReadStream(req.file.path)
                .pipe(csv({
                    mapHeaders: ({ header }) => {
                        return header?.trim().replace(/\n/g, '') || '';
                    },
                    skipLines: 0,
                    strict: true,
                    trim: true
                }))
                .on('data', (data) => {
                    processedCount++;
                    const isEmptyRow = Object.values(data).every(value =>
                        !value || value.toString().trim() === '');

                    if (isEmptyRow) {
                        console.log('Skipping empty row');
                        return;
                    }

                    // Standardize keys
                    findAndMapKey(data, 'DATE', 'date');
                    findAndMapKey(data, 'Symbol', 'symbol');
                    findAndMapKey(data, 'Security Name', 'security_name');
                    findAndMapKey(data, 'Client Name', 'client_name');
                    findAndMapKey(data, 'Buy', 'buy_sell');
                    findAndMapKey(data, 'Quantity', 'quantity_traded');
                    findAndMapKey(data, 'Trade Price', 'trade_price');
                    findAndMapKey(data, 'Remarks', 'remarks');

                    // Parse date properly
                    let parsedDate;
                    try {
                        parsedDate = new Date(data.date);
                        // Convert to IST (UTC+5:30)
                        parsedDate.setMinutes(parsedDate.getMinutes() + 330);
                        if (isNaN(parsedDate.getTime())) {
                            // Try parsing DD-MMM-YYYY format
                            const [day, month, year] = data.date.split('-');
                            parsedDate = new Date(`${month} ${day}, ${year}`);
                        }
                    } catch (error) {
                        console.error('Date parsing error:', error);
                        return;
                    }

                    const transformedData = {
                        date: parsedDate.toISOString().split('T')[0],
                        symbol: data.symbol?.trim(),
                        securityName: data.security_name?.trim(),
                        clientName: data.client_name?.trim(),
                        tradeType: data.buy_sell?.trim(),
                        quantityTraded: parseInt((data.quantity_traded || '').replace(/,/g, '')),
                        tradePrice: parseFloat((data.trade_price || '').replace(/,/g, '')),
                        remarks: data.remarks?.trim()
                    };

                    if (transformedData.symbol && transformedData.securityName &&
                        transformedData.clientName && transformedData.tradeType &&
                        !isNaN(transformedData.quantityTraded) &&
                        !isNaN(transformedData.tradePrice) &&
                        transformedData.date) {
                        results.push(transformedData);
                    } else {
                        console.log('Skipping row with missing or invalid fields:', transformedData);
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`Total rows processed: ${processedCount}`);
        console.log(`Valid rows collected: ${results.length}`);

        // Then, process the collected data with transaction
        const transaction = await sequelize.transaction();
        try {
            // First get all existing records
            const allExistingRecords = await Stock.findAll({
                attributes: ['date', 'symbol', 'clientName', 'tradeType', 'quantityTraded', 'tradePrice'],
                raw: true,
                transaction
            });

            console.log('Total existing records:', allExistingRecords.length);

            // Create a Set of existing record keys for faster lookup
            const existingSet = new Set();
            allExistingRecords.forEach(record => {
                const key = `${record.date}-${record.symbol}-${record.clientName}-${record.tradeType}-${record.quantityTraded}-${record.tradePrice}`;
                existingSet.add(key);
            });

            console.log('Unique keys in database:', existingSet.size);

            // Debug: Log a few existing keys
            console.log('Sample existing keys:', Array.from(existingSet).slice(0, 5));

            // Filter out duplicates from results
            const uniqueResults = [];
            const seenKeys = new Set(); // Track keys within current batch

            results.forEach(data => {
                const key = `${data.date}-${data.symbol}-${data.clientName}-${data.tradeType}-${data.quantityTraded}-${data.tradePrice}`;

                // Debug log for sample records
                if (results.indexOf(data) < 5) {
                    console.log('Processing record:', {
                        key,
                        existsInDB: existingSet.has(key),
                        existsInBatch: seenKeys.has(key),
                        data
                    });
                }

                if (existingSet.has(key)) {
                    duplicates.push({
                        ...data,
                        reason: 'Duplicate entry found in database'
                    });
                } else if (seenKeys.has(key)) {
                    duplicates.push({
                        ...data,
                        reason: 'Duplicate entry in current batch'
                    });
                } else {
                    uniqueResults.push(data);
                    seenKeys.add(key);
                }
            });

            console.log('Unique keys in current batch:', seenKeys.size);
            console.log('Unique records to insert:', uniqueResults.length);
            console.log('Duplicates found:', duplicates.length);

            // Add detailed counts in response
            const duplicatesByReason = duplicates.reduce((acc, curr) => {
                acc[curr.reason] = (acc[curr.reason] || 0) + 1;
                return acc;
            }, {});

            // Bulk insert only non-duplicate data
            if (uniqueResults.length > 0) {
                const chunkSize = 1000;
                for (let i = 0; i < uniqueResults.length; i += chunkSize) {
                    const chunk = uniqueResults.slice(i, i + chunkSize);
                    await Stock.bulkCreate(chunk, {
                        transaction,
                        validate: true
                    });
                    console.log(`Inserted ${i + chunk.length} of ${uniqueResults.length} records`);
                }
            }

            await transaction.commit();
            fs.unlinkSync(req.file.path);

            res.status(200).json({
                message: 'CSV file successfully processed',
                recordsImported: uniqueResults.length,
                duplicatesSkipped: duplicates.length,
                duplicatesByReason,
                totalProcessed: processedCount,
                databaseStats: {
                    existingRecordsCount: allExistingRecords.length,
                    uniqueKeysInDB: existingSet.size
                },
                sampleData: {
                    existingRecords: allExistingRecords.slice(0, 3),
                    duplicates: duplicates.slice(0, 3),
                    uniqueResults: uniqueResults.slice(0, 3)
                }
            });

        } catch (error) {
            await transaction.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Error:', error);

        // Delete the uploaded file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            error: 'Error processing CSV file',
            details: error.message
        });
    }
};

function findAndMapKey(obj, searchText, standardKey) {
    const key = Object.keys(obj).find(key =>
        key.toLowerCase().includes(searchText.toLowerCase())
    );
    if (key) {
        // Create new key with standard name and copy value
        obj[standardKey] = obj[key];
        // Delete old key
        delete obj[key];
    }
    return standardKey;
}

exports.getStocks = async (req, res) => {
    try {
        // Pagination params
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        // Sorting params
        const sortField = validateSortField(req.query.sortBy);
        const sortOrder = req.query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Filtering params
        const filters = {};
        const validFilters = {
            symbol: req.query.symbol,
            clientName: req.query.clientName,
            tradeType: req.query.tradeType,
            date: req.query.date,
            securityName: req.query.securityName,
            executedAt: req.query['executedAt.values']
        };

        // Build filter conditions
        Object.entries(validFilters).forEach(([key, value]) => {
            if (value) {
                if (key === 'date') {
                    const validDate = validateDateFormat(value);
                    if (validDate) {
                        filters[key] = validDate;
                    }
                } else if (key === 'executedAt') {
                    const dates = value.split(',');
                    if (dates.length === 2) {
                        const startDate = validateDateFormat(dates[0]);
                        const endDate = validateDateFormat(dates[1]);
                        if (startDate && endDate) {
                            filters['date'] = {
                                [sequelize.Op.between]: [startDate, endDate]
                            };
                        }
                    }
                } else {
                    // Case-insensitive partial match for string fields
                    filters[key] = sequelize.where(
                        sequelize.fn('LOWER', sequelize.col(key)),
                        'LIKE',
                        `%${value.toLowerCase()}%`
                    );
                }
            }
        });

        // Get data with filters and sorting
        const { count, rows } = await Stock.findAndCountAll({
            where: filters,
            limit: limit,
            offset: offset,
            order: [[sortField, sortOrder]],
        });

        // Calculate pagination info
        const totalPages = Math.ceil(count / limit);

        res.status(200).json({
            currentPage: page,
            totalPages: totalPages,
            totalItems: count,
            itemsPerPage: limit,
            data: rows,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
            sortBy: sortField,
            sortOrder: sortOrder,
            appliedFilters: Object.entries(validFilters)
                .filter(([_, value]) => value !== undefined)
                .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
        });

    } catch (error) {
        console.error('Error fetching stocks:', error);
        res.status(500).json({
            error: 'Error fetching stocks',
            details: error.message
        });
    }
};

exports.getFilters = async (req, res) => {
    try {
        // Get unique stock symbols and security names
        const stocks = await Stock.findAll({
            attributes: ['symbol', 'securityName'],
            group: ['symbol', 'securityName']
        });

        // Get unique client names
        const uniqueClientNames = await Stock.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('clientName')), 'clientName']]
        });

        // Get unique trade types
        const uniqueTradeTypes = await Stock.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('tradeType')), 'tradeType']]
        });

        res.status(200).json({
            clientName: uniqueClientNames.map(client => client.clientName),
            stocks: stocks.map(stock => ({
                symbol: stock.symbol,
                securityName: stock.securityName
            })),
            tradeType: uniqueTradeTypes.map(type => type.tradeType)
        });
    } catch (error) {
        console.error('Error fetching filters:', error);
        res.status(500).json({
            error: 'Error fetching filters',
            details: error.message
        });
    }
};
