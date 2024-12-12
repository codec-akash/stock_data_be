const fs = require('fs');
const csv = require('csv-parser');
const Stock = require('../models/stock');
const sequelize = require('../config/database');

const validateSortField = (field) => {
    const allowedFields = ['date', 'symbol', 'securityName', 'clientName', 'buyOrSell', 'quantityTraded', 'tradePrice'];
    return allowedFields.includes(field) ? field : 'date';
};

const validateDateFormat = (dateString) => {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) ? date : null;
};

exports.uploadCSV = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const results = [];
        const duplicates = [];

        // Process CSV file
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
                .on('data', async (data) => {

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

                    const transformedData = {
                        date: data.date,
                        symbol: data.symbol?.trim(),
                        securityName: data.security_name?.trim(),
                        clientName: data.client_name?.trim(),
                        buyOrSell: data.buy_sell?.trim(),
                        quantityTraded: parseInt((data.quantity_traded || '').replace(/,/g, '')),
                        tradePrice: parseFloat(data.trade_price),
                        remarks: data.remarks?.trim()
                    };

                    if (transformedData.symbol && transformedData.securityName && transformedData.clientName && transformedData.buyOrSell) {
                        // Check for duplicate before pushing to results
                        const existingRecord = await Stock.findOne({
                            where: {
                                date: transformedData.date,
                                symbol: transformedData.symbol,
                                clientName: transformedData.clientName,
                                buyOrSell: transformedData.buyOrSell,
                                quantityTraded: transformedData.quantityTraded,
                                tradePrice: transformedData.tradePrice
                            },
                            transaction
                        });

                        if (existingRecord) {
                            duplicates.push({
                                ...transformedData,
                                reason: 'Duplicate entry found'
                            });
                        } else {
                            results.push(transformedData);
                        }
                    } else {
                        console.log('Skipping row with missing required fields:', transformedData);
                    }
                })
                .on('end', () => {
                    resolve();
                })
                .on('error', (error) => {
                    console.error('Error processing CSV:', error);
                    reject(error);
                });
        });

        // Bulk insert only non-duplicate data
        if (results.length > 0) {
            await Stock.bulkCreate(results, {
                transaction,
                validate: true
            });
        }

        // Commit transaction
        await transaction.commit();

        // Delete the uploaded file
        fs.unlinkSync(req.file.path);

        res.status(200).json({
            message: 'CSV file successfully processed',
            recordsImported: results.length,
            duplicatesSkipped: duplicates.length,
            duplicateRecords: duplicates
        });

    } catch (error) {
        console.error('Error:', error);
        // Rollback transaction on error
        await transaction.rollback();

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
            buyOrSell: req.query.buyOrSell,
            date: req.query.date,
            securityName: req.query.securityName
        };

        // Build filter conditions
        Object.entries(validFilters).forEach(([key, value]) => {
            if (value) {
                if (key === 'date') {
                    const validDate = validateDateFormat(value);
                    if (validDate) {
                        filters[key] = validDate;
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

        const stockName = await Stock.findAll({ attributes: ['symbol', 'securityName'], group: ['symbol', 'securityName'] })

        const uniqueClientNames = await Stock.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('clientName')), 'clientName']]
        });

        res.status(200).json({
            stockName: stockName.map(symbol => ({ symbol: symbol.symbol, security: symbol.securityName })),
            uniqueClientNames: uniqueClientNames.map(client => client.clientName)
        });
    } catch (error) {
        res.status(500).json({
            error: 'Error fetching filters',
            details: error.message
        });
    }
};