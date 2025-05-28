require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2");
const ejsMate = require("ejs-mate");
const { v4: uuidv4 } = require("uuid");
const ExpressError = require("./ExpressError");
const mbxGeocoding = require("@mapbox/mapbox-sdk/services/geocoding");

const app = express();
const geocodingClient = mbxGeocoding({ accessToken: process.env.MAP_TOKEN });

// Read SSL certificate
const sslCert = fs.readFileSync(process.env.DB_SSL_CA).toString();

// MySQL connection connection config
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: {
        ca: sslCert,
        rejectUnauthorized: true,
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
}).promise();

// View engine setup
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware
app.use(express.urlencoded({ extended: true }));

// Haversine distance function
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const toRad = angle => (angle * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Routes

// Home page: Show all schools
app.get("/", async (req, res, next) => {
    try {
        const [schools] = await connection.query("SELECT id, name, address, latitude, longitude FROM school");
        res.render("index.ejs", { schools });
    } catch (err) {
        console.error("MySQL Error:", err); // log actual error
        next(new ExpressError(500, "Database error while fetching schools."));
    }

});

// GET: Add school form
app.get("/addSchool", (req, res) => {
    res.render("new.ejs");
});

// POST: Add school using geocoding
app.post("/addSchool", async (req, res, next) => {
    const { name, street, city, state, country } = req.body;
    const fullAddress = `${street}, ${city}, ${state}, ${country}`;
    const id = uuidv4();

    try {
        const response = await geocodingClient.forwardGeocode({
            query: fullAddress,
            limit: 1
        }).send();

        const feature = response.body.features[0];
        if (!feature) {
            return next(new ExpressError(400, "Invalid address: unable to geocode."));
        }

        const [longitude, latitude] = feature.geometry.coordinates;

        const query = "INSERT INTO school (id, name, address, latitude, longitude) VALUES (?, ?, ?, ?, ?)";
        await connection.query(query, [id, name, fullAddress, latitude, longitude]);

        res.redirect("/");
    } catch (err) {
        console.error("Add school error:", err);
        next(new ExpressError(500, "Failed to add school."));
    }
});

// GET: Search schools nearest to a location
app.get("/school/search", async (req, res, next) => {
    const { location } = req.query;
    if (!location) return next(new ExpressError(400, "Location is required."));

    try {
        const response = await geocodingClient.forwardGeocode({
            query: location,
            limit: 1
        }).send();

        if (!response.body.features || response.body.features.length === 0) {
            return next(new ExpressError(400, "No geocoding results found."));
        }

        const lng = response.body.features[0].geometry.coordinates[0];
        const lat = response.body.features[0].geometry.coordinates[1];

        const [schools] = await connection.query("SELECT id, name, address, latitude, longitude FROM school");

        const enriched = schools.map(school => {
            const distance = haversine(lat, lng, school.latitude, school.longitude);
            return { ...school, distance };
        });

        enriched.sort((a, b) => a.distance - b.distance);

        res.render("searchResults", { schools: enriched, location });
    } catch (err) {
        console.error("Search error:", err);
        next(new ExpressError(500, "Geocoding failed during search."));
    }
});

// Error handler
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || "Something went wrong";
    res.status(status).send(message);
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
