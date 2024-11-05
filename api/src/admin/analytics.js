const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const passport = require('passport');
const jwt = require("jsonwebtoken");

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
    }
    next();
};

// Get sales analytics (admin only)
router.get('/sales', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const sales = await Order.aggregate([
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    totalSales: { $sum: "$total" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        res.json(sales);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching sales analytics', error: error.message });
    }
});

// Get product analytics (admin only)
router.get('/products', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const topProducts = await Order.aggregate([
            { $unwind: "$items" },
            {
                $group: {
                    _id: "$items.product",
                    totalSold: { $sum: "$items.quantity" },
                    revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } }
                }
            },
            { $sort: { totalSold: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'products',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'productDetails'
                }
            },
            { $unwind: "$productDetails" },
            {
                $project: {
                    name: "$productDetails.name",
                    totalSold: 1,
                    revenue: 1
                }
            }
        ]);
        res.json(topProducts);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product analytics', error: error.message });
    }
});

// Get user analytics (admin only)
router.get('/users', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const userGrowth = await User.aggregate([
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
                    newUsers: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        res.json(userGrowth);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user analytics', error: error.message });
    }
});

module.exports = router;

/*

GET /api/admin/analytics/sales

GET /api/admin/analytics/products

GET /api/admin/analytics/users

*/