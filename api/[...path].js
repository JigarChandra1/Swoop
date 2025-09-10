const { app } = require('../server/index.js');

function ensureApiPrefix(req) {
  try {
    const url = req.url || '/';
    if (!url.startsWith('/api/')) {
      // Normalize double slashes
      req.url = '/api' + (url.startsWith('/') ? url : ('/' + url));
    }
  } catch (_) { /* ignore */ }
}

// Vercel Node function — forward to Express app. This captures all /api/* routes.
module.exports = (req, res) => {
  try {
    ensureApiPrefix(req);
    return app(req, res);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'server_error', message: e && e.message }));
  }
};
