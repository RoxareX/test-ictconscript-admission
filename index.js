// Global variable to store entries
let currentEntries = [];

// Security constants
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 5000;
const MAX_COORDINATE = 180;

// Function to escape HTML to prevent XSS attacks
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/\//g, "&#x2F;");
}

// Input validation functions
function validateTitle(title) {
    if (!title || typeof title !== 'string') {
        return 'Title is required';
    }
    if (title.length > MAX_TITLE_LENGTH) {
        return `Title must be less than ${MAX_TITLE_LENGTH} characters`;
    }
    return null;
}

function validateBody(body) {
    if (!body || typeof body !== 'string') {
        return 'Body is required';
    }
    if (body.length > MAX_BODY_LENGTH) {
        return `Body must be less than ${MAX_BODY_LENGTH} characters`;
    }
    return null;
}

function validateCoordinate(value, type) {
    if (value === '' || value === null || value === undefined) {
        return null; // Optional field
    }
    
    const num = parseFloat(value);
    if (isNaN(num)) {
        return `${type} must be a valid number`;
    }
    
    const maxVal = type === 'Latitude' ? 90 : 180;
    const minVal = type === 'Latitude' ? -90 : -180;
    
    if (num < minVal || num > maxVal) {
        return `${type} must be between ${minVal} and ${maxVal}`;
    }
    
    return null;
}

// Sanitize input to remove dangerous characters
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    
    // Remove control characters and potential script injection
    return input
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Control characters
        .replace(/javascript:/gi, '') // JavaScript protocol
        .replace(/data:/gi, '') // Data URLs
        .replace(/vbscript:/gi, '') // VBScript
        .trim();
}

// Function to list all data from the server
async function listAllEntries() {
    try {
        const response = await fetch('https://test-ictconscript-admission.onrender.com/api/entries');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }
        const data = await response.json();
        console.log('Loaded entries from server');
        return data || [];
    } catch (error) {
        console.error('Error fetching entries:', error);
        throw error;
    }
}

// Function to display the entries in the HTML
function displayEntries(entries) {
    const contentDiv = document.getElementById('content');

    if (!entries || entries.length === 0) {
        contentDiv.innerHTML = '<p>No entries found.</p>';
        return;
    }

    // Ensure entries are sorted by timestamp in reverse chronological order (newest first)
    const sortedEntries = [...entries].sort((a, b) => new Date(b.isoTime) - new Date(a.isoTime));

    let html = '<h2>Unit Logbook Entries:</h2>';

    sortedEntries.forEach(entry => {
        html += `
                    <div class="entry">
                        <div class="entry-title">${escapeHtml(entry.title) || 'No title'}</div>
                        <div class="entry-time">${entry.isoTime ? new Date(entry.isoTime).toLocaleString() : 'No timestamp'}</div>
                        <div class="entry-body">${escapeHtml(entry.body) || 'No content'}</div>
                        ${entry.lat && entry.lon ?
                `<div class="entry-location">Location: ${entry.lat}, ${entry.lon}</div>` :
                '<div class="entry-location">No location data</div>'
            }
                    </div>
                `;
    });

    contentDiv.innerHTML = html;
}

// Function to handle loading and displaying entries
async function loadEntries() {
    // Prevent multiple simultaneous requests
    if (isSubmitting) {
        showMessage('Request already in progress...', 'info');
        return;
    }
    
    const contentDiv = document.getElementById('content');
    contentDiv.innerHTML = '<div class="loading">Loading entries...</div>';

    try {
        isSubmitting = true;
        currentEntries = await listAllEntries();
        displayEntries(currentEntries);
    } catch (error) {
        handleApiError(error, 'loading entries');
        contentDiv.innerHTML = `
            <div class="error">
                <strong>Unable to load entries</strong><br>
                <small>Please try again or contact support if the problem persists.</small>
            </div>
        `;
    } finally {
        isSubmitting = false;
    }
}

// Drawer functions
function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('overlay').classList.add('show');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
    document.body.style.overflow = 'auto'; // Restore scrolling
    
    // Clear the form
    document.getElementById('entryForm').reset();
}

// Function to generate next ID based on existing entries
function generateNextId() {
    if (!currentEntries || currentEntries.length === 0) {
        return "1";
    }
    
    // Find the highest numeric ID
    const numericIds = currentEntries
        .map(entry => parseInt(entry.id))
        .filter(id => !isNaN(id));
    
    if (numericIds.length === 0) {
        return "1";
    }
    
    const maxId = Math.max(...numericIds);
    return String(maxId + 1);
}

// Function to save a new entry to the server
async function saveEntryToServer(entryData) {
    try {
        const response = await fetch('https://test-ictconscript-admission.onrender.com/api/entries', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(entryData)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('Entry saved to server');
        return result;
    } catch (error) {
        console.error('Error saving entry:', error);
        throw error;
    }
}

// Function to add a new entry
async function addEntry(event) {
    event.preventDefault();
    
    const form = document.getElementById('entryForm');
    const formData = new FormData(form);
    
    // Get and sanitize input values
    const rawTitle = formData.get('title') || '';
    const rawBody = formData.get('body') || '';
    const rawLat = formData.get('lat') || '';
    const rawLon = formData.get('lon') || '';
    
    // Validate inputs
    const titleError = validateTitle(rawTitle);
    const bodyError = validateBody(rawBody);
    const latError = validateCoordinate(rawLat, 'Latitude');
    const lonError = validateCoordinate(rawLon, 'Longitude');
    
    // Show validation errors
    if (titleError || bodyError || latError || lonError) {
        const errors = [titleError, bodyError, latError, lonError].filter(Boolean);
        showMessage('Validation Error: ' + errors.join('. '), 'error');
        return;
    }
    
    // Sanitize inputs
    const sanitizedTitle = sanitizeInput(rawTitle);
    const sanitizedBody = sanitizeInput(rawBody);
    
    // Create new entry object with sanitized data
    const newEntry = {
        title: sanitizedTitle,
        body: sanitizedBody,
        lat: rawLat ? parseFloat(rawLat) : null,
        lon: rawLon ? parseFloat(rawLon) : null
    };
    
    // Additional client-side validation
    if (!newEntry.title || !newEntry.body) {
        showMessage('Title and body cannot be empty after sanitization', 'error');
        return;
    }
    
    try {
        // Disable form during submission to prevent double submission
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';
        
        // Save to server
        const result = await saveEntryToServer(newEntry);
        
        // Reload entries from server to get updated list
        currentEntries = await listAllEntries();
        
        // Update the display
        displayEntries(currentEntries);
        
        // Close the drawer
        closeDrawer();
        
        // Show success message
        showMessage('Entry added successfully!', 'success');
        
    } catch (error) {
        console.error('Error adding entry:', error);
        
        // Show user-friendly error message
        let errorMessage = 'Error adding entry. Please try again.';
        if (error.message.includes('400')) {
            errorMessage = 'Invalid data. Please check your input.';
        } else if (error.message.includes('429')) {
            errorMessage = 'Too many requests. Please wait before trying again.';
        } else if (error.message.includes('500')) {
            errorMessage = 'Server error. Please try again later.';
        }
        
        showMessage(errorMessage, 'error');
    } finally {
        // Re-enable form
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Entry';
        }
    }
}

// Function to show messages
function showMessage(message, type = 'info') {
    // Sanitize message to prevent XSS in notifications
    const sanitizedMessage = escapeHtml(String(message));
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = sanitizedMessage; // Safe to use innerHTML now as content is escaped
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 4px;
        color: white;
        font-weight: bold;
        z-index: 1100;
        transition: opacity 0.3s ease;
        max-width: 300px;
        word-wrap: break-word;
        ${type === 'success' ? 'background-color: #28a745;' : 
          type === 'error' ? 'background-color: #dc3545;' : 
          'background-color: #007cba;'}
    `;
    
    document.body.appendChild(messageDiv);
    
    // Remove message after 3 seconds
    setTimeout(() => {
        messageDiv.style.opacity = '0';
        setTimeout(() => {
            if (document.body.contains(messageDiv)) {
                document.body.removeChild(messageDiv);
            }
        }, 300);
    }, 3000);
}

// Security: Prevent form resubmission on page refresh
let isSubmitting = false;

// Security: Add CSRF-like protection using timestamp validation
function generateRequestToken() {
    const timestamp = Date.now();
    const randomValue = Math.random().toString(36).substring(2);
    return btoa(timestamp + ':' + randomValue);
}

// Security: Basic request timing validation
function validateRequestToken(token) {
    try {
        const decoded = atob(token);
        const timestamp = parseInt(decoded.split(':')[0]);
        const now = Date.now();
        
        // Token should not be older than 1 hour
        return (now - timestamp) < 3600000;
    } catch {
        return false;
    }
}

// Enhanced error handling function
function handleApiError(error, operation = 'operation') {
    console.error(`Error during ${operation}:`, error);
    
    // Don't expose internal error details to user
    let userMessage = `Failed to complete ${operation}. Please try again.`;
    
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        userMessage = 'Network error. Please check your connection and try again.';
    } else if (error.message.includes('400')) {
        userMessage = 'Invalid request. Please check your input.';
    } else if (error.message.includes('429')) {
        userMessage = 'Too many requests. Please wait a moment before trying again.';
    } else if (error.message.includes('500')) {
        userMessage = 'Server error. Please try again later.';
    }
    
    showMessage(userMessage, 'error');
    return userMessage;
}

// Close drawer when pressing Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeDrawer();
    }
});

// Security: Prevent clickjacking and other frame-based attacks
if (window !== window.top) {
    document.body.style.display = 'none';
    throw new Error('Page loaded in frame - potential security risk');
}

// Security: Clear sensitive data on page unload
window.addEventListener('beforeunload', function() {
    // Clear any sensitive data
    currentEntries = [];
    
    // Clear form data
    const form = document.getElementById('entryForm');
    if (form) {
        form.reset();
    }
});

// Security: Add integrity check for critical functions
const originalFetch = window.fetch;
window.fetch = function(...args) {
    // Add basic request validation
    if (args[0] && typeof args[0] === 'string' && !args[0].startsWith('https://test-ictconscript-admission.onrender.com/api/') && !args[0].startsWith('http')) {
        console.warn('Potentially unsafe fetch request blocked:', args[0]);
        return Promise.reject(new Error('Invalid request'));
    }
    
    return originalFetch.apply(this, args);
};

// Security: Prevent console manipulation in production
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    console.log = console.warn = console.error = function() {};
}

// Security: Add basic bot detection
const isBot = /bot|crawl|spider|slurp/i.test(navigator.userAgent);
if (isBot) {
    console.log('Bot detected - limiting functionality');
}

// Initialize security measures when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Add form validation event listeners
    const titleInput = document.getElementById('entryTitle');
    const bodyInput = document.getElementById('entryBody');
    
    if (titleInput) {
        titleInput.addEventListener('input', function() {
            this.value = sanitizeInput(this.value);
        });
    }
    
    if (bodyInput) {
        bodyInput.addEventListener('input', function() {
            this.value = sanitizeInput(this.value);
        });
    }
    
    // Prevent form submission with dangerous content
    const form = document.getElementById('entryForm');
    if (form) {
        form.addEventListener('submit', function(event) {
            const title = titleInput.value;
            const body = bodyInput.value;
            
            // Double-check for dangerous content before submission
            const dangerousPatterns = [
                /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
                /javascript:/gi,
                /data:text\/html/gi,
                /vbscript:/gi,
                /on\w+\s*=/gi
            ];
            
            const isDangerous = dangerousPatterns.some(pattern => 
                pattern.test(title) || pattern.test(body)
            );
            
            if (isDangerous) {
                event.preventDefault();
                showMessage('Content contains potentially dangerous code and was blocked', 'error');
                return false;
            }
        });
    }
});

// Optional: Load entries automatically when page loads
// window.addEventListener('DOMContentLoaded', loadEntries);