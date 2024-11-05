const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const passport = require('passport');
const jwt = require("jsonwebtoken");

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
    }
    next();
};

// Update inventory (admin only)
router.put('/:productId/inventory', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const { quantity } = req.body;
        const product = await Product.findByIdAndUpdate(
            req.params.productId,
            { $set: { "inventory.quantity": quantity } },
            { new: true }
        );
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    } catch (error) {
        res.status(400).json({ message: 'Error updating inventory', error: error.message });
    }
});

// Get low stock products (admin only)
router.get('/low-stock', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const threshold = req.query.threshold || 10;
        const lowStockProducts = await Product.find({ "inventory.quantity": { $lte: threshold } });
        res.json(lowStockProducts);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching low stock products', error: error.message });
    }
});

module.exports = router;


/* 

PUT /api/admin/inventory/:productId/inventory

GET /api/admin/inventory/low-stock

*/