const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE_PATH = path.join(__dirname, 'sample-data', 'data.json');

// Security constants
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 5000;
const MAX_ENTRIES = 1000;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 100; // requests per window

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map();

// Rate limiting middleware
function rateLimit(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    // Clean old entries
    if (rateLimitStore.has(clientIP)) {
        const requests = rateLimitStore.get(clientIP).filter(time => time > windowStart);
        rateLimitStore.set(clientIP, requests);
    }
    
    const requests = rateLimitStore.get(clientIP) || [];
    
    if (requests.length >= RATE_LIMIT_MAX) {
        return res.status(429).json({ 
            error: 'Too many requests. Please try again later.',
            retryAfter: Math.ceil((requests[0] + RATE_LIMIT_WINDOW - now) / 1000)
        });
    }
    
    requests.push(now);
    rateLimitStore.set(clientIP, requests);
    next();
}

// Input validation functions
function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove control characters
}

function validateEntry(entry) {
    const errors = [];
    
    // Validate title
    if (!entry.title || typeof entry.title !== 'string') {
        errors.push('Title is required and must be a string');
    } else if (entry.title.length > MAX_TITLE_LENGTH) {
        errors.push(`Title must be less than ${MAX_TITLE_LENGTH} characters`);
    }
    
    // Validate body
    if (!entry.body || typeof entry.body !== 'string') {
        errors.push('Body is required and must be a string');
    } else if (entry.body.length > MAX_BODY_LENGTH) {
        errors.push(`Body must be less than ${MAX_BODY_LENGTH} characters`);
    }
    
    // Validate coordinates
    if (entry.lat !== null && entry.lat !== undefined) {
        const lat = parseFloat(entry.lat);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            errors.push('Latitude must be a valid number between -90 and 90');
        }
    }
    
    if (entry.lon !== null && entry.lon !== undefined) {
        const lon = parseFloat(entry.lon);
        if (isNaN(lon) || lon < -180 || lon > 180) {
            errors.push('Longitude must be a valid number between -180 and 180');
        }
    }
    
    return errors;
}

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? ['your-domain.com'] : true,
    credentials: false
}));

// Limit request size
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply rate limiting
app.use('/api/', rateLimit);

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(express.static('.', {
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
})); // Serve static files from current directory

// Helper function to read data from JSON file
async function readDataFromFile() {
    try {
        const data = await fs.readFile(DATA_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading data file:', error);
        return [];
    }
}

// Helper function to write data to JSON file
async function writeDataToFile(data) {
    try {
        await fs.writeFile(DATA_FILE_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing data file:', error);
        return false;
    }
}

// GET /api/entries - Get all entries
app.get('/api/entries', async (req, res) => {
    try {
        const entries = await readDataFromFile();
        // Sort entries by timestamp in reverse chronological order (newest first)
        const sortedEntries = entries.sort((a, b) => new Date(b.isoTime) - new Date(a.isoTime));
        res.json(sortedEntries);
    } catch (error) {
        console.error('Error fetching entries:', error);
        res.status(500).json({ error: 'Failed to fetch entries' });
    }
});

// POST /api/entries - Add a new entry
app.post('/api/entries', async (req, res) => {
    try {
        const entries = await readDataFromFile();
        
        // Check if we've reached max entries limit
        if (entries.length >= MAX_ENTRIES) {
            return res.status(400).json({ error: 'Maximum number of entries reached' });
        }
        
        const newEntry = req.body;
        
        // Validate input
        const validationErrors = validateEntry(newEntry);
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: validationErrors 
            });
        }
        
        // Sanitize input
        const sanitizedEntry = {
            title: sanitizeString(newEntry.title),
            body: sanitizeString(newEntry.body),
            lat: newEntry.lat ? parseFloat(newEntry.lat) : null,
            lon: newEntry.lon ? parseFloat(newEntry.lon) : null
        };
        
        // Generate new ID if not provided
        if (!sanitizedEntry.id) {
            const numericIds = entries
                .map(entry => parseInt(entry.id))
                .filter(id => !isNaN(id));
            const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 0;
            sanitizedEntry.id = String(maxId + 1);
        }
        
        // Add timestamp
        sanitizedEntry.isoTime = new Date().toISOString();
        
        entries.push(sanitizedEntry);
        
        const success = await writeDataToFile(entries);
        if (success) {
            res.status(201).json({ 
                message: 'Entry added successfully', 
                entry: {
                    id: sanitizedEntry.id,
                    title: sanitizedEntry.title,
                    isoTime: sanitizedEntry.isoTime
                }
            });
        } else {
            res.status(500).json({ error: 'Failed to save entry' });
        }
    } catch (error) {
        console.error('Error adding entry:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/entries/:id - Update an existing entry
app.put('/api/entries/:id', async (req, res) => {
    try {
        const entryId = req.params.id;
        const updatedEntry = req.body;
        const entries = await readDataFromFile();
        
        const entryIndex = entries.findIndex(entry => entry.id === entryId);
        if (entryIndex === -1) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        entries[entryIndex] = { ...entries[entryIndex], ...updatedEntry, id: entryId };
        
        const success = await writeDataToFile(entries);
        if (success) {
            res.json({ message: 'Entry updated successfully', entry: entries[entryIndex] });
        } else {
            res.status(500).json({ error: 'Failed to update entry' });
        }
    } catch (error) {
        console.error('Error updating entry:', error);
        res.status(500).json({ error: 'Failed to update entry' });
    }
});

// DELETE /api/entries/:id - Delete an entry
app.delete('/api/entries/:id', async (req, res) => {
    try {
        const entryId = req.params.id;
        const entries = await readDataFromFile();
        
        const entryIndex = entries.findIndex(entry => entry.id === entryId);
        if (entryIndex === -1) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        entries.splice(entryIndex, 1);
        
        const success = await writeDataToFile(entries);
        if (success) {
            res.json({ message: 'Entry deleted successfully' });
        } else {
            res.status(500).json({ error: 'Failed to delete entry' });
        }
    } catch (error) {
        console.error('Error deleting entry:', error);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Data file location: ${DATA_FILE_PATH}`);
});
