const express = require('express');
const router = express.Router();
const Review = require('../models/Reviews');
const Product = require('../models/Product');
const User = require('../models/User');
const passport = require('passport');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const jwt = require("jsonwebtoken");
const nodemailer = require('nodemailer');
// Middleware to check if the user is an admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
    }
    next();
};



router.get('/', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status || ['pending', 'approved', 'rejected'];
        const sort = req.query.sort || '-createdAt';

        const reviews = await Review.find({ status: { $in: status } })
            .populate('user', 'name')
            .populate('product', 'name')
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit);

        const totalReviews = await Review.countDocuments({ status: { $in: status } });

        res.json({
            reviews,
            currentPage: page,
            totalPages: Math.ceil(totalReviews / limit),
            totalReviews
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching reviews', error: error.message });
    }
});

// Add a review
router.post('/', passport.authenticate('jwt', { session: false }), upload.array('images', 5), async (req, res) => {
    try {
        const { productId, rating, comment } = req.body;
        const images = req.files ? req.files.map(file => ({ url: file.path, caption: file.originalname })) : [];

        const existingReview = await Review.findOne({ user: req.user._id, product: productId });
        if (existingReview) {
            return res.status(400).json({ message: 'You have already reviewed this product' });
        }

        const review = new Review({
            user: req.user._id,
            product: productId,
            rating: Number(rating),
            comment,
            images
        });
        await review.save();

        const product = await Product.findById(productId);
        await product.updateReviewStats(rating);

        res.status(201).json(review);
    } catch (error) {
        res.status(500).json({ message: 'Error adding review', error: error.message });
    }
});

// Get reviews for a product
router.get('/product/:productId', async (req, res) => {
    try {
        const reviews = await Review.find({ product: req.params.productId, status: 'approved' })
            .populate('user', 'name')
            .sort('-createdAt');

        res.json(reviews);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching reviews', error: error.message });
    }
});

async function sendReviewApprovedEmail(user, product) {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_ADDRESS,
            to: user.email,
            subject: "Your Review Has Been Approved",
            html: `
            <html>
              <body>
                <h1>Review Approval Notification</h1>
                <p>Dear ${user.name},</p>
                <p>Your review for "${product.name}" has been approved.</p>
                <p>Thank you for taking the time to share your thoughts about our product.</p>
                <p>Your feedback is valuable to us and helps other customers make informed decisions.</p>
                <p>Visit our website to see your published review!</p>
              </body>
            </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Review approval email sent: ', info.response);
    } catch (error) {
        console.error('Error sending review approval email:', error);
    }
}
// Update review status (admin only)
router.put('/:id/status', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const review = await Review.findById(id)
            .populate('product')
            .populate('user');

        if (!review) {
            return res.status(404).json({ message: 'Review not found' });
        }

        const oldStatus = review.status;
        review.status = status;
        await review.save();

        // Update product review stats if necessary
        if (status === 'approved' && oldStatus !== 'approved') {
            await review.product.updateReviewStats(review.rating);
            // Send email to user
            if (review.user && review.user.email) {
                await sendReviewApprovedEmail(review.user, review.product);
            }
        } else if (status !== 'approved' && oldStatus === 'approved') {
            await review.product.updateReviewStats(-review.rating);
        }

        res.json(review);
    } catch (error) {
        res.status(500).json({ message: 'Error updating review status', error: error.message });
    }
});

// Mark a review as helpful
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
// Get pending reviews (admin only)
router.get('/pending', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const pendingReviews = await Review.find({ status: 'pending' })
            .populate('user', 'name')
            .populate('product', 'name')
            .sort('-createdAt');

        res.json(pendingReviews);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching pending reviews', error: error.message });
    }
});

router.get('/stats', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const [totalReviews, pendingReviews, approvedReviews, rejectedReviews] = await Promise.all([
            Review.countDocuments(),
            Review.countDocuments({ status: 'pending' }),
            Review.countDocuments({ status: 'approved' }),
            Review.countDocuments({ status: 'rejected' })
        ]);

        res.json({
            totalReviews,
            pendingReviews,
            approvedReviews,
            rejectedReviews
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching review stats', error: error.message });
    }
});

module.exports = router;

/*
    PUT /reviews/123456789/status
{
  "status": "approved"
}


*/