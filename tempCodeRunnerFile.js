if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}

const express = require("express");
const path = require("path");
const ejsMate = require("ejs-mate");
const { v4: uuidv4 } = require("uuid");
const mbxGeocoding = require("@mapbox/mapbox-sdk/services/geocoding");
const mysql = require("mysql2");
const ExpressError = require("./ExpressError");

const app = express();
const port = 8080;

const geocodingClient = mbxGeocoding({
    accessToken: "pk.eyJ1Ijoic2FtYml0MTAiLCJhIjoiY202dWx0eXVyMGc5ZzJrc2J3b3ZuczkweCJ9.k-g_HulCIfYle0HgiOVWHw"
});

// Middleware
app.use(express.urlencoded({ extended: true }));

// View engine
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

console.log("MAP_TOKEN:", process.env.MAP_TOKEN);  // Check what value it prints


// MySQL connection
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
});

// Routes
app.get("/", (req, res) => {
    res.render("new");
});

app.post("/school/addSchool", async (req, res, next) => {
    const { name, street, city, state, country } = req.body;

    if (!name || !street || !city || !state || !country) {
        return next(new ExpressError(400, "All fields are required."));
    }

    const fullAddress = `${street}, ${city}, ${state}, ${country}`;
    const id = uuidv4();

    try {
        const geoData = await geocodingClient.forwardGeocode({
            query: fullAddress,
            limit: 1
        }).send();

        const match = geoData.body.features[0];
        if (!match) {
            return next(new ExpressError(400, "Invalid address: unable to geocode."));
        }

        const latitude = match.center[1];
        const longitude = match.center[0];
        const query = "INSERT INTO school (id, name, address, latitude, longitude) VALUES (?, ?, ?, ?, ?)";

        connection.query(query, [id, name, fullAddress, latitude, longitude], (err) => {
            if (err) {
                console.error("Insert error:", err);
                return next(new ExpressError(500, "Database insertion error."));
            }
            res.redirect("/school");
        });
    } catch (err) {
        console.error("Geocoding error:", err);
        next(new ExpressError(500, "Geocoding failed."));
    }
});

app.get("/school", (req, res, next) => {
    const refLat = 22.5726; // Example: Kolkata
    const refLng = 88.3639;

    const query = `
        SELECT 
            id,
            name,
            address,
            latitude,
            longitude,
            (6371 * acos(
                cos(radians(?)) * cos(radians(latitude)) *
                cos(radians(longitude) - radians(?)) +
                sin(radians(?)) * sin(radians(latitude))
            )) AS distance
        FROM school
        ORDER BY distance ASC
    `;

    connection.query(query, [refLat, refLng, refLat], (err, results) => {
        if (err) return next(new ExpressError(500, "Database query error."));
        res.render("index", { schools: results });
    });
});

// Error handling
app.all("*", (req, res, next) => {
    next(new ExpressError(404, "Page Not Found"));
});

app.use((err, req, res, next) => {
    const { statusCode = 500, message = "Something went wrong" } = err;
    res.status(statusCode).send(message);
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
