# Stock Data Management API

## Overview

This project is a RESTful API built with Node.js and Express, designed to manage stock transaction data. It allows users to upload CSV files containing stock transactions, retrieve stock data with pagination, sorting, and filtering capabilities, and ensures data integrity by checking for duplicates.

## Features

- **Upload CSV**: Upload stock transaction data in CSV format.
- **Pagination**: Retrieve stock data in a paginated format (20 records per page).
- **Sorting**: Sort stock data by various fields (e.g., date, symbol).
- **Filtering**: Filter stock data based on multiple criteria, including date ranges.
- **Duplicate Checking**: Prevent duplicate entries in the database.

## Technologies Used

- Node.js
- Express
- Sequelize (ORM for database interaction)
- MySQL (or any other supported database)
- CSV Parser
- Multer (for file uploads)

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- MySQL (or any other supported database)
- npm (Node Package Manager)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/stock-data-management-api.git
   cd stock-data-management-api
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Set up your database:
   - Create a new database in MySQL.
   - Update the database configuration in `config/database.js` with your database credentials.

4. Run database migrations (if applicable):

   ```bash
   npx sequelize-cli db:migrate
   ```

5. Start the server:

   ```bash
   npm start
   ```

   The server will run on `http://localhost:3000` by default.

### API Endpoints

#### 1. Upload CSV

- **Endpoint**: `POST /api/stocks/upload`
- **Description**: Upload a CSV file containing stock transaction data.
- **Request**: Form-data with a file field named `file`.
- **Response**: JSON object with the result of the upload.

#### 2. Get Stocks

- **Endpoint**: `GET /api/stocks`
- **Description**: Retrieve stock data with pagination, sorting, and filtering.
- **Query Parameters**:
  - `page`: Page number (default: 1)
  - `limit`: Number of records per page (default: 20)
  - `sortBy`: Field to sort by (e.g., `date`, `symbol`)
  - `sortOrder`: Sort order (`ASC` or `DESC`, default: `DESC`)
  - `symbol`: Filter by stock symbol
  - `clientName`: Filter by client name
  - `buyOrSell`: Filter by buy/sell status
  - `dateFrom`: Filter by start date (YYYY-MM-DD)
  - `dateTo`: Filter by end date (YYYY-MM-DD)
- **Response**: JSON object with paginated stock data.

### Example Requests

1. **Upload CSV**:

   ```bash
   curl -X POST http://localhost:3000/api/stocks/upload -F "file=@path/to/your/file.csv"
   ```

2. **Get Stocks**:

   ```bash
   curl "http://localhost:3000/api/stocks?page=1&limit=20&sortBy=date&sortOrder=ASC&symbol=AAPL&dateFrom=2024-01-01&dateTo=2024-03-15"
   ```

### Error Handling

The API provides appropriate error messages for various scenarios, including:

- Missing required fields
- Invalid date formats
- Duplicate entries
- Database connection issues

### Testing

You can use tools like Postman or cURL to test the API endpoints. Ensure that your server is running before making requests.

### License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### Acknowledgments

- [Express](https://expressjs.com/) - Fast, unopinionated, minimalist web framework for Node.js.
- [Sequelize](https://sequelize.org/) - Promise-based Node.js ORM for various databases.
- [CSV Parser](https://www.npmjs.com/package/csv-parser) - Simple CSV parsing library for Node.js.
- [Multer](https://www.npmjs.com/package/multer) - Middleware for handling `multipart/form-data`, used for uploading files.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.
