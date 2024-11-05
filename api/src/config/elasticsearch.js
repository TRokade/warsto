// config/elasticsearch.js

const { Client } = require('@elastic/elasticsearch');
const client = new Client({ node: 'http://localhost:5000' });

module.exports = client;