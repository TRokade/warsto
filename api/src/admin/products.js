const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const passport = require('passport');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Whishlist = require('../models/WhishList');
const multer = require('multer');
const path = require('path');


const collectionDefaults = [
    { collection: 'Opulance', shutterFinish: 'PU', brand: ['Asian Paints'] },
    { collection: 'NexGen', shutterFinish: 'Brand Name', brand: ['Brand Name'] },
    { collection: 'Smart Space', shutterFinish: 'Laminate', brand: ['Greenlam', 'Merino'] },
    { collection: 'StyleShift', shutterFinish: 'Acrylic', brand: ['Senosan'] },
    { collection: 'Sovereign', shutterFinish: 'Acrylic', brand: ['Senosan'] },
    { collection: 'Ornat', shutterFinish: 'RPU', brand: ['Asian Paints'] }
];

function getCollectionDefaults(collection) {
    return collectionDefaults.find(def => def.collection === collection) || {};
}

// Set up multer for handling file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')  // Make sure this directory exists
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname))
    }
});

const upload = multer({ storage: storage, limit: { files: 5 } });

// Middleware to check if the user is an admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
    }
    next();
};

// Get collection defaults
router.get('/collection-defaults', passport.authenticate("jwt", { session: false }), isAdmin, (req, res) => {
    res.json(collectionDefaults);
});

// Get all products
router.get('/', passport.authenticate("jwt", { session: false }), isAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 10, search, type, productCategory, collection, minPrice, maxPrice } = req.query;
        const query = {};

        if (search) query.$text = { $search: search };
        if (type) query.type = type;
        if (productCategory) query.productCategory = productCategory;
        if (collection) query['attributes.collection'] = collection;
        if (minPrice || maxPrice) {
            query['price.amount'] = {};
            if (minPrice) query['price.amount'].$gte = Number(minPrice);
            if (maxPrice) query['price.amount'].$lte = Number(maxPrice);
        }

        const totalProducts = await Product.countDocuments(query);
        const totalPages = Math.ceil(totalProducts / limit);

        const products = await Product.find(query)
            .skip((page - 1) * limit)
            .limit(Number(limit));

        res.json({
            products,
            totalPages,
            totalProducts,
            currentPage: page,
            collectionDefaults
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching products', error: error.message });
    }
});

// Create a new product (admin only)
router.post('/', passport.authenticate('jwt', { session: false }), isAdmin, upload.array('image', 4), async (req, res) => {
    try {
        let productData = JSON.parse(req.body.productData);
        const { type, productCategory } = productData;
        const { collection } = productData.attributes;
        const defaults = getCollectionDefaults(collection);
        if (defaults.shutterFinish) {
            productData.attributes.woodwork.shutterFinish = defaults.shutterFinish;
        }
        if (defaults.brand) {
            productData.attributes.brand = defaults.brand[0];
        }

        if ((type === 'Wardrobe' && !['Sliding Wardrobe', 'Openable Wardrobe'].includes(productCategory)) ||
            (type === 'Storage' && !['Sliding Storage', 'Openable Storage'].includes(productCategory))) {
            return res.status(400).json({ message: 'Invalid productCategory for the given type' });
        }

        if (req.files && req.files.length > 0) {
            productData.images = req.files.map((file, index) => ({
                url: `/uploads/${file.filename}`,
                altText: req.body[`image${index + 1}`] || '',
                isPrimary: index === 0
            }));
        }

        // Parse nested objects
        ['price', 'inventory', 'attributes', 'designer', 'hardware'].forEach(key => {
            if (typeof productData[key] === 'string') {
                productData[key] = JSON.parse(productData[key]);
            }
        });

        const product = new Product(productData);
        await product.save();
        res.status(201).json(product);
    } catch (error) {
        if (error instanceof multer.MulterError) {
            return res.status(400).json({ message: 'File upload error', error: error.message });
        } else {
            return res.status(500).json({ message: 'Error creating product', error: error.message });
        }
    }
});

async function sendPriceChangeEmail(user, product, oldPrice, newPrice) {
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
            subject: "Price Change Alert for Wishlisted Product",
            html: `
            <html>
              <body>
                <h1>Price Change Alert</h1>
                <p>Dear ${user.name},</p>
                <p>The price of "${product.name}" in your wishlist has changed.</p>
                <p>Old Price: ${oldPrice} ${product.price.currency}</p>
                <p>New Price: ${newPrice} ${product.price.currency}</p>
                <p>Visit our website to check out the updated price!</p>
              </body>
            </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Price change email sent: ', info.response);
    } catch (error) {
        console.error('Error sending price change email:', error);
    }
}

// Update a product (admin only)
router.put('/:id', passport.authenticate('jwt', { session: false }), isAdmin, upload.array('image', 4), async (req, res) => {
    try {
        const productData = JSON.parse(req.body.productData);
        const { type, productCategory } = productData;
        const { collection } = productData.attributes;
        const defaults = getCollectionDefaults(collection);
        if (defaults.shutterFinish) {
            productData.attributes.woodwork.shutterFinish = defaults.shutterFinish;
        }
        if (defaults.brand) {
            productData.attributes.brand = defaults.brand[0];
        }

        if (type && productCategory) {
            if ((type === 'Wardrobe' && !['Sliding Wardrobe', 'Openable Wardrobe'].includes(productCategory)) ||
                (type === 'Storage' && !['Sliding Storage', 'Openable Storage'].includes(productCategory))) {
                return res.status(400).json({ message: 'Invalid productCategory for the given type' });
            }
        }

        const oldProduct = await Product.findById(req.params.id);
        if (!oldProduct) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const oldPrice = oldProduct.price.amount;
        const newPrice = productData.price.amount;

        // Handle images
        if (req.files && req.files.length > 0) {
            productData.images = req.files.map((file, index) => ({
                url: `/uploads/${file.filename}`,
                altText: req.body[`image${index + 1}`] || '',
                isPrimary: index === 0
            }));
        }

        // Parse nested objects
        ['price', 'inventory', 'attributes', 'designer', 'hardware'].forEach(key => {
            if (typeof productData[key] === 'string') {
                productData[key] = JSON.parse(productData[key]);
            }
        });

        const product = await Product.findByIdAndUpdate(req.params.id, productData, { new: true });

        // Check if price has changed
        if (oldPrice !== newPrice) {
            // Find all wishlists containing this product
            const wishlists = await Whishlist.find({ products: req.params.id });

            // Send email to each user
            for (let wishlist of wishlists) {
                const user = await User.findById(wishlist.user);
                if (user && user.email) {
                    await sendPriceChangeEmail(user, product, oldPrice, newPrice);
                }
            }
        }

        res.json(product);
    } catch (error) {
        if (error instanceof multer.MulterError) {
            return res.status(400).json({ message: 'File upload error', error: error.message });
        } else {
            return res.status(500).json({ message: 'Error creating product', error: error.message });
        };
    }
});

// Delete a product (admin only)
router.delete('/:id', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting product', error: error.message });
    }
});

module.exports = router;

/*

POST /products
{
  "name": "New Product",
  "description": "This is a new product",
  "price": 19.99,
  "category": "Electronics"
}

PUT /products/123456789
{
  "name": "Updated Product",
  "description": "This is an updated product",
  "price": 24.99,
  "category": "Electronics"
}

DELETE /products/123456789

*/



