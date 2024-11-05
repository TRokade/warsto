// routes/reviews.js
const express = require('express');
const router = express.Router();
const Review = require('../models/Reviews');
const Product = require('../models/Product');
const User = require('../models/User');
const passport = require('passport');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const jwt = require("jsonwebtoken")



const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
    }
    next();
};
// Add a review
router.post('/', passport.authenticate('jwt', { session: false }), upload.array('images', 5), async (req, res) => {
    try {
        console.log("Received review submission:", req.body);
        console.log("Received files:", req.files);

        const { productId, rating, comment } = req.body;

        // Validate productId
        if (!productId) {
            return res.status(400).json({ message: 'Product ID is required' });
        }

        // Parse and validate rating
        const parsedRating = parseInt(rating, 10);
        if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
            return res.status(400).json({ message: 'Rating must be a number between 1 and 5' });
        }

        // Create review
        const review = new Review({
            user: req.user._id,
            product: productId,
            rating: parsedRating,
            comment: comment || "",
            images: req.files ? req.files.map(file => ({ url: file.path, caption: file.originalname })) : []
        });

        await review.save();

        // Update product review stats
        const product = await Product.findById(productId);
        if (product) {
            await product.updateReviewStats(parsedRating);
        }

        res.status(201).json(review);
    } catch (error) {
        console.error("Error in review submission:", error);
        res.status(500).json({ message: 'Error adding review', error: error.message });
    }
});
// Get reviews for a product
router.get('/product/:productId', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const sort = req.query.sort || '-createdAt';
        const status = req.query.status || ['approved', 'pending']; // Allow fetching pending reviews

        const reviews = await Review.find({
            product: req.params.productId,
            status: { $in: status },
            rating: { $gte: 3 }  // Only show reviews with rating 3 or higher
        })
            .populate('user', 'name')
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit);

        const totalReviews = await Review.countDocuments({
            product: req.params.productId,
            status: { $in: status },
            rating: { $gte: 3 }
        });

        const product = await Product.findById(req.params.productId);

        res.json({
            reviews,
            currentPage: page,
            totalPages: Math.ceil(totalReviews / limit),
            totalReviews,
            productReviewStats: product ? product.reviews : null
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching reviews', error: error.message });
    }
});

router.put('/:id/status', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const review = await Review.findByIdAndUpdate(
            req.params.id,
            { status: req.body.status },
            { new: true }
        );

        if (!review) {
            return res.status(404).json({ message: 'Review not found' });
        }

        if (req.body.status === 'approved' && review.status !== 'approved') {
            const product = await Product.findById(review.product);
            await product.updateReviewStats(review.rating);
        } else if (req.body.status !== 'approved' && review.status === 'approved') {
            const product = await Product.findById(review.product);
            await product.updateReviewStats(review.rating, review.rating);
        }

        res.json(review);
    } catch (error) {
        res.status(500).json({ message: 'Error updating review status', error: error.message });
    }
});

router.post('/:id/helpful', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const review = await Review.findByIdAndUpdate(
            req.params.id,
            { $inc: { helpful: 1 } },
            { new: true }
        );

        if (!review) {
            return res.status(404).json({ message: 'Review not found' });
        }

        res.json(review);
    } catch (error) {
        res.status(500).json({ message: 'Error marking review as helpful', error: error.message });
    }
});

// async function updateExistingProducts() {
//     try {
//         await Product.updateMany(
//             { reviews: { $exists: false } },
//             {
//                 $set: {
//                     reviews: {
//                         averageRating: 0,
//                         totalReviews: 0,
//                         ratingDistribution: {
//                             1: 0, 2: 0, 3: 0, 4: 0, 5: 0
//                         }
//                     }
//                 }
//             }
//         );
//         console.log('Existing products updated successfully');
//     } catch (error) {
//         console.error('Error updating existing products:', error);
//     }
// }

// updateExistingProducts();

module.exports = router;