const NodeCache = require('node-cache'); // npm install node-cache
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

const cacheMiddleware = (duration) => (req, res, next) => {
    if (req.method !== 'GET') {
        return next();
    }

    const key = req.originalUrl;
    const cachedResponse = cache.get(key);

    if (cachedResponse) {
        res.send(cachedResponse);
    } else {
        res.originalJson = res.json;
        res.json = (body) => {
            res.originalJson(body);
            cache.set(key, body, duration);
        };
        next();
    }
};

module.exports = cacheMiddleware;