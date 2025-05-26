require("dotenv").config();
const express = require("express");
const path = require("path");
const mysql = require("mysql2");
const ejsMate = require("ejs-mate");
const { v4: uuidv4 } = require("uuid");
const ExpressError = require("./ExpressError");
const mbxGeocoding = require("@mapbox/mapbox-sdk/services/geocoding");

const app = express();
const geocodingClient = mbxGeocoding({ accessToken: process.env.MAP_TOKEN });

// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.engine("ejs", ejsMate);

// Middleware
app.use(express.urlencoded({ extended: true }));

// MySQL connection
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
});
connection.connect(err => {
    if (err) console.error("Database connection failed:", err);
});

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

// Home page: Show all schools
app.get("/", (req, res) => {
    const query = "SELECT id, name, address,latitude,longitude FROM school";
    connection.query(query, (err, results) => {
        if (err) return res.send("Database error.");
        res.render("index.ejs", { schools: results });
    });
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

        const match = response.body.features[0].geometry;
        console.log(match)
        if (!match) {
            return next(new ExpressError(400, "Invalid address: unable to geocode."));
        }

        const latitude = match.coordinates[1];
        const longitude = match.coordinates[0];

        const query = "INSERT INTO school (id, name, address, latitude, longitude) VALUES (?, ?, ?, ?, ?)";
        connection.query(query, [id, name, fullAddress, latitude, longitude], (err) => {
            if (err) {
                console.error("Insert error:", err);
                return next(new ExpressError(500, "Database insertion error."));
            }
            res.redirect("/");
        });
    } catch (err) {
        console.error("Geocoding error:", err);
        next(new ExpressError(500, "Geocoding failed."));
    }
});

// GET: Search schools nearest to a location
app.get("/school/search", async (req, res, next) => {
    console.log("Search route called with query:", req.query);

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

        const coords = response.body.features[0].geometry;
        console.log("Geocoded coordinates:", coords.coordinates);

        const lat = coords.coordinates[1];
        const lng = coords.coordinates[0];

        const sql = "SELECT id, name, address, latitude, longitude FROM school";
        connection.query(sql, (err, schools) => {
            if (err) {
                console.error("DB query failed:", err);
                return next(new ExpressError(500, "Database query failed."));
            }

            console.log("Number of schools found:", schools.length);

            const enriched = schools.map(school => {
                const distance = haversine(lat, lng, school.latitude, school.longitude);
                return { ...school, distance };
            });

            enriched.sort((a, b) => a.distance - b.distance);

            res.render("searchResults", {
                schools: enriched,
                location
            });
        });

    } catch (err) {
        console.error("Search error:", err);
        next(new ExpressError(500, "Geocoding failed during search."));
    }
});


// Error handler
app.use((err, req, res, next) => {
    const { status = 500, message = "Something went wrong" } = err;
    res.status(status).send(message);
});

// Server start
app.listen(8080, () => {
    console.log("Server running on http://localhost:8080");
});
