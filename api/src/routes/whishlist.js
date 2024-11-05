const express = require('express');
const router = express.Router();
const Wishlist = require('../models/WhishList');
const Product = require('../models/Product');
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require('uuid');

// Middleware to get or create wishlist
const getWishlist = async (req, res, next) => {
    try {
        let userId;
        let isGuest = false;

        if (req.headers.authorization) {
            const token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            userId = decoded.id;
        } else {
            userId = req.headers['x-guest-id'] || uuidv4();
            isGuest = true;
            res.setHeader('X-Guest-ID', userId);
        }

        let wishlist = await Wishlist.findOne({ user: userId });
        if (!wishlist) {
            wishlist = new Wishlist({ user: userId, products: [], isGuest });
        }

        // Parse the user field if it contains JSON data
        if (typeof wishlist.user === 'string' && wishlist.user.startsWith('{')) {
            try {
                const userData = JSON.parse(wishlist.user);
                if (userData.productId) {
                    wishlist.products.push(userData.productId);
                    wishlist.user = userId; // Reset the user field to just the ID
                    await wishlist.save();
                }
            } catch (e) {
                console.error('Error parsing user data:', e);
            }
        }

        req.wishlist = wishlist;
        req.userId = userId;
        req.isGuest = isGuest;
        next();
    } catch (error) {
        res.status(500).json({ message: 'Error fetching wishlist', error: error.message });
    }
};

// Get user's wishlist
router.get('/', getWishlist, async (req, res) => {
    try {
        const populatedWishlist = await Wishlist.findById(req.wishlist._id).populate('products');
        res.json(populatedWishlist);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching populated wishlist', error: error.message });
    }
});

// Add product to wishlist
router.post('/add', getWishlist, async (req, res) => {
    try {
        const { productId } = req.body;
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        if (!req.wishlist.products.includes(productId)) {
            req.wishlist.products.push(productId);
            await req.wishlist.save();
        }

        const populatedWishlist = await Wishlist.findById(req.wishlist._id).populate('products');
        res.json(populatedWishlist);
    } catch (error) {
        res.status(500).json({ message: 'Error adding product to wishlist', error: error.message });
    }
});

// Remove product from wishlist
router.delete('/remove/:productId', getWishlist, async (req, res) => {
    try {
        const { productId } = req.params;
        req.wishlist.products = req.wishlist.products.filter(id => id.toString() !== productId);
        await req.wishlist.save();

        const populatedWishlist = await Wishlist.findById(req.wishlist._id).populate('products');
        res.json(populatedWishlist);
    } catch (error) {
        res.status(500).json({ message: 'Error removing product from wishlist', error: error.message });
    }
});

// Clear wishlist
router.post('/clear', getWishlist, async (req, res) => {
    try {
        req.wishlist.products = [];
        await req.wishlist.save();
        res.json({ message: 'Wishlist cleared', wishlist: req.wishlist });
    } catch (error) {
        res.status(500).json({ message: 'Error clearing wishlist', error: error.message });
    }
});

router.post('/merge', async (req, res) => {
    try {
        const { guestId, userId } = req.body;

        if (!guestId || !userId) {
            return res.status(400).json({ message: 'Both guestId and userId are required' });
        }

        console.log('Merging wishlists for guestId:', guestId, 'and userId:', userId);

        const guestWishlist = await Wishlist.findOne({ user: guestId, isGuest: true });
        let userWishlist = await Wishlist.findOne({ user: userId, isGuest: false });

        console.log('Guest wishlist:', guestWishlist);
        console.log('User wishlist:', userWishlist);

        if (!userWishlist) {
            userWishlist = new Wishlist({ user: userId, products: [], isGuest: false });
            console.log('Created new user wishlist:', userWishlist);
        }

        if (guestWishlist && guestWishlist.products.length > 0) {
            // Merge products from guest wishlist to user wishlist
            userWishlist.products = [...new Set([...userWishlist.products, ...guestWishlist.products])];
            await userWishlist.save();
            console.log('Merged wishlist:', userWishlist);

            // Delete the guest wishlist
            await Wishlist.deleteOne({ user: guestId, isGuest: true });
            console.log('Deleted guest wishlist');
        } else {
            console.log('No guest wishlist found or guest wishlist is empty');
        }

        const populatedWishlist = await Wishlist.findById(userWishlist._id).populate('products');
        res.json(populatedWishlist);
    } catch (error) {
        console.error('Error merging wishlists:', error);
        res.status(500).json({ message: 'Error merging wishlists', error: error.message });
    }
});

module.exports = router;