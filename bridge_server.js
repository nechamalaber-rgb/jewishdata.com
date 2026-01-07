/**
 * JEWISHDATA BRIDGE SERVER (v1.2)
 * Connects the AI Widget to your MySQL records securely.
 */
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'YOUR_SECURE_PASSWORD',
  database: 'jewish_data_archives'
};

app.post('/api/search', async (req, res) => {
  const { surname, givenName, location } = req.body;

  if (!surname) return res.status(400).json({ error: "Surname required." });

  try {
    const conn = await mysql.createConnection(dbConfig);
    
    // SAFE Parameterized SQL
    let sql = `SELECT id, surname, given_name as givenName, location, record_year as year, details FROM records WHERE surname LIKE ?`;
    const params = [`%${surname}%`];

    if (givenName) { sql += " AND given_name LIKE ?"; params.push(`%${givenName}%`); }
    if (location) { sql += " AND location LIKE ?"; params.push(`%${location}%`); }
    
    sql += " LIMIT 15";

    const [rows] = await conn.execute(sql, params);
    await conn.end();

    res.json({ results: rows });
  } catch (error) {
    console.error("Database error:", error.message);
    res.status(500).json({ results: [], error: "Bridge Connection Issue" });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`JewishData Bridge listening on port ${PORT}`));