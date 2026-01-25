const express = require('express');
const routes = express.Router();
const pool = require('../dbcon');
const app = express();

// Helper function to create database connection
const createConnection = async () => {
    return await pool.getConnection();
};

// Helper function to close database connection
const closeConnection = async (connection) => {
    if (connection) connection.release();
};

app.use(express.json());


// GET /admin/properties/accommodations - Fetch all accommodations
routes.get('/accommodations', async (req, res) => {
    const connection = await createConnection();

    try {
        // Validate and parse query parameters
        const {
            type,
            min_capacity,
            max_capacity,
            is_available,
            min_price,
            max_price,
            search,
            amenities,
            page = 1,
            limit = 10,
            sort = 'created_at',
            order = 'DESC'
        } = req.query;

        // Validate numeric parameters
        const pageNum = Math.max(1, parseInt(page)) || 1;
        const limitNum = Math.min(100, Math.max(1, parseInt(limit))) || 10;
        const offset = (pageNum - 1) * limitNum;

        // Base query selecting only from accommodations table
        let query = `
            SELECT 
                id,
                name,
                type,
                description,
                price,
                capacity,
                rooms,
                available,
                features,
                images,
                amenity_ids,
                owner_id,
                city_id,
                address,
                latitude,
                longitude,
                package_name,
                package_description,
                package_images,
                adult_price,
                child_price,
                max_guests,
                created_at,
                updated_at,
                MaxPersonVilla,
                RatePerPerson,
                website
            FROM accommodations
        `;

        const conditions = [];
        const params = [];

        // Add filters (all from accommodations table)
        if (type) {
            conditions.push('type = ?');
            params.push(type);
        }

        if (min_capacity) {
            conditions.push('capacity >= ?');
            params.push(min_capacity);
        }

        if (max_capacity) {
            conditions.push('capacity <= ?');
            params.push(max_capacity);
        }

        if (is_available === 'true') {
            conditions.push('available = TRUE');
        } else if (is_available === 'false') {
            conditions.push('available = FALSE');
        }

        if (min_price) {
            conditions.push('price >= ?');
            params.push(min_price);
        }

        if (max_price) {
            conditions.push('price <= ?');
            params.push(max_price);
        }

        if (search) {
            conditions.push('(name LIKE ? OR description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        if (amenities) {
            const amenityIds = amenities.split(',').map(id => parseInt(id.trim()));
            conditions.push(`JSON_OVERLAPS(amenity_ids, ?)`);
            params.push(JSON.stringify(amenityIds));
        }

        // Add WHERE clause if conditions exist
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        // Validate sort field against actual table columns
        const validSortFields = [
            'id', 'name', 'type', 'price', 'capacity', 'rooms',
            'available', 'created_at', 'updated_at'
        ];
        const sortField = validSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Add sorting
        query += ` ORDER BY ${sortField} ${sortOrder}`;

        // Add pagination
        query += ' LIMIT ? OFFSET ?';
        params.push(limitNum, offset);

        // Execute main query
        const [rows] = await connection.execute(query, params);

        // Get total count (using same conditions)
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM accommodations
            ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}
        `;
        const [countRows] = await connection.execute(countQuery, params.slice(0, -2));
        const total = countRows[0].total;
        const totalPages = Math.ceil(total / limitNum);

        // Process JSON fields
        const processJsonField = (field, defaultValue) => {
            try {
                return field ? JSON.parse(field) : defaultValue;
            } catch (e) {
                console.error('JSON parse error:', e.message);
                return defaultValue;
            }
        };

        // Format response (all fields from accommodations table)
        const formattedRows = rows.map(row => ({
            id: row.id,
            name: row.name,
            type: row.type,
            description: row.description,
            price: row.price,
            capacity: row.capacity,
            rooms: row.rooms,
            available: Boolean(row.available),
            features: processJsonField(row.features, []),
            images: processJsonField(row.images, []),
            amenities: processJsonField(row.amenity_ids, []),
            max_person_villa: row.MaxPersonVilla,
            rate_per_person: row.RatePerPerson,
            website: row.website,
            location: {
                address: row.address,
                coordinates: {
                    latitude: row.latitude,
                    longitude: row.longitude
                }
            },
            ownerId: row.owner_id,
            cityId: row.city_id,
            package: {
                name: row.package_name,
                description: row.package_description,
                images: processJsonField(row.package_images, []),
                pricing: {
                    adult: row.adult_price,
                    child: row.child_price,
                    maxGuests: row.max_guests
                }
            },
            timestamps: {
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }
        }));

        res.json({
            data: formattedRows,
            pagination: {
                total,
                totalPages,
                currentPage: pageNum,
                perPage: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            }
        });

    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({
            error: 'Failed to fetch accommodations',
            ...(process.env.NODE_ENV === 'development' && {
                details: {
                    message: error.message,
                    sqlMessage: error.sqlMessage
                }
            })
        });
    } finally {
        await closeConnection(connection);
    }
});
// GET /admin/properties/accommodations/:id - Fetch single accommodation
routes.get('/accommodations/:id', async (req, res) => {
    const { id } = req.params;
    console.log('Fetching accommodation with ID:', id);

    // Validate ID is a non-negative integer (including 0)
    if (!Number.isInteger(Number(id)) || Number(id) < 0) {
        console.log("Invalid ID format");
        return res.status(400).json({ error: 'Invalid accommodation ID format' });
    }

    const connection = await createConnection();

    try {
        const [rows] = await connection.execute(
            `SELECT 
                a.*,
                u.name as owner_name,
                c.name as city_name,
                c.country as country
            FROM accommodations a
            LEFT JOIN users u ON a.owner_id = u.id
            LEFT JOIN cities c ON a.city_id = c.id
            WHERE a.id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        const accommodation = rows[0];

        // Helper function to safely parse JSON fields
        const parseJSONField = (field, defaultValue) => {
            try {
                if (field === null || field === undefined) return defaultValue;
                if (typeof field === 'object') return field;
                return JSON.parse(field);
            } catch (e) {
                console.warn(`Failed to parse JSON field ${field}:`, e.message);
                return defaultValue;
            }
        };

        // Determine availability - you might need to adjust this logic based on your actual business rules
        const isAvailable = true; // Replace with your actual availability logic

        // Transform database fields to frontend structure
        const response = {
            id: accommodation.id,
            basicInfo: {
                name: accommodation.name || '',
                description: accommodation.description || '',
                type: accommodation.type || '',
                capacity: accommodation.capacity || 2,
                rooms: accommodation.rooms || 1,
                price: accommodation.price || 0,
                available: isAvailable, // Using the availability flag
                features: parseJSONField(accommodation.features, []),
                images: parseJSONField(accommodation.images, []),
                MaxPersonVilla: accommodation.MaxPersonVilla || 0,
                RatePersonVilla: accommodation.RatePerPerson || 0,
                website: accommodation.website || ''
            },
            location: {
                owner: {
                    id: accommodation.owner_id,
                    name: accommodation.owner_name
                },
                city: {
                    id: accommodation.city_id,
                    name: accommodation.city_name,
                    country: accommodation.country
                },
                address: accommodation.address || '',
                coordinates: {
                    latitude: accommodation.latitude,
                    longitude: accommodation.longitude
                }
            },
            amenities: {
                ids: parseJSONField(accommodation.amenity_ids, []),
                // You could add full amenity objects here if needed
            },
            packages: {
                name: accommodation.package_name || '',
                description: accommodation.package_description || '',
                images: parseJSONField(accommodation.package_images, []),
                pricing: {
                    adult: accommodation.adult_price || 0,
                    child: accommodation.child_price || 0,
                    maxGuests: accommodation.max_guests || 2
                }
            },
            metadata: {
                createdAt: accommodation.created_at,
                updatedAt: accommodation.updated_at
            }
        };

        res.json(response);

    } catch (error) {
        console.error('Error fetching accommodation:', error);

        // Handle specific SQL errors
        if (error.code === 'ER_PARSE_ERROR' || error.code === 'ER_BAD_FIELD_ERROR') {
            return res.status(500).json({
                error: 'Database query error',
                details: process.env.NODE_ENV === 'development' ? {
                    message: error.message,
                    sql: error.sql,
                    code: error.code
                } : undefined
            });
        }

        res.status(500).json({
            error: 'Failed to fetch accommodation',
            ...(process.env.NODE_ENV === 'development' && {
                details: {
                    message: error.message,
                    stack: error.stack,
                    code: error.code
                }
            })
        });
    } finally {
        await closeConnection(connection);
    }
});

// POST /admin/properties/accommodations - Create new accommodation
routes.post('/accommodations', async (req, res) => {
    try {
        // Destructure nested structure from frontend
        const {
            basicInfo,
            location,
            amenities,
            ownerId,
            packages
        } = req.body;

        // Validate required fields
        if (!basicInfo || !basicInfo.name || !basicInfo.type ||
            !basicInfo.capacity || !basicInfo.rooms || !basicInfo.price) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const connection = await createConnection();

        // Extract values from nested structure
        const {
            name,
            description,
            type,
            capacity,
            rooms,
            price,
            features = [],
            images = [],
            available = true,
            MaxPersonVilla,
            RatePersonVilla,
            website
        } = basicInfo;

        const address = location?.address || null;
        const cityId = location?.cityId || null;
        const latitude = location?.coordinates?.latitude || null;
        const longitude = location?.coordinates?.longitude || null;
        const amenityIds = amenities?.ids || [];

        const packageName = packages?.name || null;
        const packageDescription = packages?.description || null;
        const packageImages = packages?.images || [];
        const adultPrice = packages?.pricing?.adult || 0;
        const childPrice = packages?.pricing?.child || 0;
        const maxGuests = packages?.pricing?.maxGuests || 2;

        // Insert into database
        const [result] = await connection.execute(
            `INSERT INTO accommodations 
            (name, description, type, capacity, rooms, price, features, images, available, owner_id, city_id, 
             address, latitude, longitude, amenity_ids, package_name, package_description, package_images,
             adult_price, child_price, max_guests, MaxPersonVilla, RatePerPerson, website) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name,
                description || null,
                type,
                capacity,
                rooms,
                price,
                JSON.stringify(features),
                JSON.stringify(images),
                available,
                ownerId || null,
                cityId || null,
                address,
                latitude,
                longitude,
                JSON.stringify(amenityIds),
                packageName,
                packageDescription,
                JSON.stringify(packageImages),
                adultPrice,
                childPrice,
                maxGuests,
                MaxPersonVilla || null,
                RatePersonVilla || null,
                website || null
            ]
        );

        await closeConnection(connection);

        res.status(201).json({
            message: 'Accommodation created successfully',
            id: result.insertId,
            name: name
        });

    } catch (error) {
        console.error('Error creating accommodation:', error);
        res.status(500).json({
            error: 'Failed to create accommodation',
            details: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});


// PUT /admin/properties/accommodations/:id - Update accommodation
routes.put('/accommodations/:id', async (req, res) => {
    const { id } = req.params;

    // --- 1. Validate ID ---
    if (!id || isNaN(Number(id)) || Number(id) <= 0) {
        return res.status(400).json({ error: 'Invalid accommodation ID' });
    }

    let connection;

    try {
        connection = await createConnection();
        await connection.beginTransaction();

        // --- 2. Fetch Existing Record ---
        // Lock the row for update to prevent race conditions
        const [existingRows] = await connection.execute(
            'SELECT * FROM accommodations WHERE id = ? FOR UPDATE',
            [id]
        );

        if (existingRows.length === 0) {
            await connection.rollback();
            await closeConnection(connection);
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        const current = existingRows[0];

        // --- 3. Merge Request Body with Current Data ---

        // Destructure request body, matching the POST route's structure
        const {
            basicInfo = {},
            location = {},
            amenities = {},
            ownerId, // Top-level field from POST route
            packages = {}
        } = req.body;

        // Merge basicInfo, using current data as fallback
        const name = basicInfo.name ?? current.name;
        const description = basicInfo.description ?? current.description;
        const type = basicInfo.type ?? current.type;
        const capacity = basicInfo.capacity ?? current.capacity;
        const rooms = basicInfo.rooms ?? current.rooms;
        const price = basicInfo.price ?? current.price;
        const MaxPersonVilla = basicInfo.MaxPersonVilla ?? current.MaxPersonVilla;
        // Handle the column name mismatch from your POST route
        const RatePerPerson = basicInfo.RatePersonVilla ?? current.RatePerPerson;
        const website = basicInfo.website ?? current.website;

        // Merge location
        const address = location.address ?? current.address;
        const cityId = location.cityId ?? current.city_id;
        const latitude = location.coordinates?.latitude ?? current.latitude;
        const longitude = location.coordinates?.longitude ?? current.longitude;

        // Merge packages
        const packageName = packages.name ?? current.package_name;
        const packageDescription = packages.description ?? current.package_description;
        const adultPrice = packages.pricing?.adult ?? current.adult_price;
        const childPrice = packages.pricing?.child ?? current.child_price;
        const maxGuests = packages.pricing?.maxGuests ?? current.max_guests;

        // Merge top-level ownerId
        const finalOwnerId = ownerId ?? current.owner_id;

        // --- 4. Prepare Final Data for SQL (Handle special types) ---

        // Handle boolean 'available' explicitly to avoid "false" -> true
        let finalAvailable;
        if (basicInfo.available === true || basicInfo.available === 1) {
            finalAvailable = true;
        } else if (basicInfo.available === false || basicInfo.available === 0) {
            finalAvailable = false;
        } else {
            // If not explicitly true/false, use the current value
            finalAvailable = current.available;
        }

        // Handle JSON fields: Only stringify if a *new* value is provided.
        // Otherwise, use the *existing* string from the database.
        const finalFeatures = basicInfo.features ? JSON.stringify(basicInfo.features) : current.features;
        const finalImages = basicInfo.images ? JSON.stringify(basicInfo.images) : current.images;
        const finalAmenityIds = amenities.ids ? JSON.stringify(amenities.ids) : current.amenity_ids;
        const finalPackageImages = packages.images ? JSON.stringify(packages.images) : current.package_images;

        // --- 5. Final Validation on Merged Data ---
        if (!name || !type) {
            throw new Error('Missing required fields: name and type');
        }
        if (Number(capacity) <= 0 || Number(rooms) <= 0 || Number(price) <= 0) {
            throw new Error('Capacity, rooms, and price must be positive numbers');
        }

        // --- 6. Execute Update ---
        const [result] = await connection.execute(
            `UPDATE accommodations SET
                name = ?, description = ?, type = ?, capacity = ?, rooms = ?,
                price = ?, features = ?, images = ?, available = ?, owner_id = ?,
                city_id = ?, address = ?, latitude = ?, longitude = ?, amenity_ids = ?,
                package_name = ?, package_description = ?, package_images = ?,
                adult_price = ?, child_price = ?, max_guests = ?,
                MaxPersonVilla = ?, RatePerPerson = ?, website = ?,
                updated_at = CURRENT_TIMESTAMP()
            WHERE id = ?`,
            [
                name, description, type, Number(capacity), Number(rooms),
                Number(price), finalFeatures, finalImages, finalAvailable, finalOwnerId,
                cityId, address, latitude, longitude, finalAmenityIds,
                packageName, packageDescription, finalPackageImages,
                Number(adultPrice), Number(childPrice), Number(maxGuests),
                MaxPersonVilla, RatePerPerson, website,
                id
            ]
        );

        // Check if any rows were actually changed
        if (result.changedRows === 0) {
            await connection.commit();
            await closeConnection(connection);
            return res.status(200).json({
                id: id,
                message: 'No changes detected. Accommodation not updated.'
            });
        }

        await connection.commit();
        await closeConnection(connection);

        res.status(200).json({
            id: id,
            message: 'Accommodation updated successfully'
        });

    } catch (error) {
        // Rollback and close connection if it exists
        if (connection) {
            try {
                await connection.rollback();
                await closeConnection(connection);
            } catch (dbError) {
                console.error('Error during rollback/close:', dbError);
            }
        }

        console.error('Error updating accommodation:', error);

        // Handle validation errors gracefully
        if (error.message.includes('Missing required') ||
            error.message.includes('must be positive')) {
            return res.status(400).json({ error: error.message });
        }

        // Generic server error
        res.status(500).json({
            error: 'Failed to update accommodation',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});


// DELETE /admin/properties/accommodations/:id - Delete accommodation
routes.delete('/accommodations/:id', async (req, res) => {
    const { id } = req.params;
    console.log('Deleting accommodation with ID:', id);
    // Validate ID is a positive integer
    if (!Number.isInteger(Number(id)) || id <= 0) {
        return res.status(400).json({ error: 'Invalid accommodation ID format' });
    }

    const connection = await createConnection();

    try {
        await connection.beginTransaction();

        // 1. Check if accommodation exists
        const [accommodation] = await connection.execute(
            'SELECT id FROM accommodations WHERE id = ? FOR UPDATE',
            [id]
        );

        if (accommodation.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        // 2. Delete from all child tables
        const childTables = [
            'blocked_dates',
            'accommodation_amenities',
            'bookings',
            'reviews',
            'packages'
        ];

        for (const table of childTables) {
            try {
                await connection.execute(
                    `DELETE FROM ${table} WHERE accommodation_id = ?`,
                    [id]
                );
            } catch (err) {
                // Ignore "table doesn't exist" errors
                if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
            }
        }

        // 3. Finally delete the accommodation
        const [result] = await connection.execute(
            'DELETE FROM accommodations WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No accommodation deleted' });
        }

        await connection.commit();
        res.json({
            message: 'Accommodation and all related data deleted successfully',
            deletedId: id
        });

    } catch (error) {
        await connection.rollback();
        console.error('Database error deleting accommodation:', error);

        // More specific error handling
        let errorMessage = 'Failed to delete accommodation';
        let errorDetails = {};

        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            errorMessage = 'Cannot delete - accommodation is referenced by other records';
            errorDetails = { hint: 'Please delete related bookings or reviews first' };
        } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            errorMessage = 'Referenced record not found';
            errorDetails = { hint: 'Database consistency issue detected' };
        } else if (error.code === 'ER_NO_SUCH_TABLE') {
            errorMessage = 'Database table missing';
            errorDetails = { missingTable: error.sqlMessage.match(/Table '(.+)'/)[1] };
        }

        res.status(500).json({
            error: errorMessage,
            ...errorDetails,
            // Always include debug info in development
            ...(process.env.NODE_ENV !== 'production' && {
                details: {
                    code: error.code,
                    message: error.message,
                    sql: error.sql
                }
            })
        });
    } finally {
        await closeConnection(connection);
    }
});
// PATCH /admin/properties/accommodations/:id/toggle-availability - Toggle availability
routes.patch('/accommodations/:id/toggle-availability', async (req, res) => {
    try {
        const { id } = req.params;
        const { available } = req.body;

        const connection = await createConnection();

        // If setting to available, set available_rooms to 1, if unavailable set to 0
        const available_rooms = available ? 1 : 0;

        const [result] = await connection.execute(
            'UPDATE accommodations SET available_rooms = ? WHERE id = ?',
            [available_rooms, id]
        );

        if (result.affectedRows === 0) {
            await closeConnection(connection);
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        await closeConnection(connection);
        res.json({
            message: 'Availability updated successfully',
            available: available
        });
    } catch (error) {
        console.error('Error updating availability:', error);
        res.status(500).json({ error: 'Failed to update availability' });
    }
});

// GET /admin/properties/accommodations/stats - Get accommodation statistics
routes.get('/accommodations/stats', async (req, res) => {
    try {
        const connection = await createConnection();

        const [stats] = await connection.execute(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN available_rooms > 0 THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN available_rooms = 0 THEN 1 ELSE 0 END) as unavailable,
                AVG(price) as avg_price,
                MIN(price) as min_price,
                MAX(price) as max_price
            FROM accommodations
        `);

        await closeConnection(connection);
        res.json(stats[0]);
    } catch (error) {
        console.error('Error fetching accommodation stats:', error);
        res.status(500).json({ error: 'Failed to fetch accommodation statistics' });
    }
});

// GET /admin/properties/users
routes.get('/users', async (req, res) => {
    try {
        const connection = await createConnection();
        const [rows] = await connection.execute('SELECT id, name, email FROM users');
        await closeConnection(connection);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET /admin/properties/cities
routes.get('/cities', async (req, res) => {
    try {
        const connection = await createConnection();
        const [rows] = await connection.execute('SELECT id, name, country FROM cities WHERE active = 1');
        await closeConnection(connection);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch cities' });
    }
});

module.exports = routes;