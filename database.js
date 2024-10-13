const mysql = require('mysql');

const connection = mysql.createConnection({
    host: '',
    database: '',
    user: '',
    password: ''
});

connection.connect(function(error){
    if (error) {
        throw error;
    } else {
        console.log('MYSQL Database is connected Successfully')
    }
});

module.exports = connection;