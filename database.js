const mysql = require('mysql');
require('dotenv').config();

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

connection.connect(function (error) {
    if (error) {
        throw error;
    } else {
        console.log('MYSQL Database is connected Successfully');
    }
});

module.exports = connection;