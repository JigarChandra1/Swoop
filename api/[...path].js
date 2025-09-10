const serverless = require('serverless-http');
const { app } = require('../server/index.js');

// Export a single handler that serves all /api/* routes.
// Note: In-memory room state is per-serverless-instance and is not guaranteed to be shared across cold starts or scales.
// For production reliability, move to a persistent store (SQLite/Planetscale/Upstash/etc.).

module.exports = serverless(app);

