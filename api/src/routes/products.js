const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const cache = require('memory-cache');
const esClient = require('../config/elasticsearch');
const { default: mongoose } = require('mongoose');

const cacheMiddleware = (duration) => {
    return (req, res, next) => {
        const key = '__express__' + req.originalUrl || req.url;
        const cachedBody = cache.get(key);
        if (cachedBody) {
            res.send(cachedBody);
            return;
        } else {
            res.sendResponse = res.send;
            res.send = (body) => {
                cache.put(key, body, duration * 1000);
                res.sendResponse(body);
            };
            next();
        }
    };
};

router.get('/', cacheMiddleware(300), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const sort = req.query.sort || '-createdAt';
        const search = req.query.search;

        let query = {};

        if (search) {
            query.$or = [
                { $text: { $search: search } },
                { sku: { $regex: search, $options: 'i' } },
                { 'attributes.collection': { $regex: search, $options: 'i' } },
                { type: { $regex: search, $options: 'i' } },
                { productCategory: { $regex: search, $options: 'i' } },
                { categories: { $regex: search, $options: 'i' } },
                { tags: { $regex: search, $options: 'i' } }
            ];
        }

        // Handling array filters like types, colors, etc.
        if (req.query.type) query.type = { $in: req.query.type.split(',') };
        if (req.query.collection) query['attributes.collection'] = new RegExp(req.query.collection, 'i');
        if (req.query.minPrice || req.query.maxPrice) {
            query['price.amount'] = {};
            if (req.query.minPrice) query['price.amount'].$gte = parseFloat(req.query.minPrice);
            if (req.query.maxPrice) query['price.amount'].$lte = parseFloat(req.query.maxPrice);
        }

        if (req.query.productCategory) query.productCategory = { $in: req.query.productCategory.split(',') };
        if (req.query.configuration) query['attributes.configuration'] = { $in: req.query.configuration.split(',') };
        if (req.query.color) query['attributes.color.family'] = { $in: req.query.color.split(',') };
        if (req.query.material) query['attributes.material'] = new RegExp(req.query.material, 'i');
        if (req.query.designer) query['designer.name'] = new RegExp(req.query.designer, 'i');
        if (req.query.tag) query.tags = new RegExp(req.query.tag, 'i');
        if (req.query.category) query.categories = new RegExp(req.query.category, 'i');
        if (req.query.length) query['attributes.dimensions.length'] = { $in: req.query.length.split(',') };
        if (req.query.width) query['attributes.dimensions.width'] = { $in: req.query.width.split(',') };
        if (req.query.height) query['attributes.dimensions.height'] = { $in: req.query.height.split(',') };

        const totalProducts = await Product.countDocuments(query); // Count all matching products
        const totalPages = Math.ceil(totalProducts / limit);

        const products = await Product.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit) // Apply pagination
            .lean();

        res.json({
            products,
            currentPage: page,
            totalPages,
            totalProducts,
            limit
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Error fetching products', error: error.message });
    }
});

router.get('/stats', cacheMiddleware(600), async (req, res) => {
    try {
        const stats = await Product.aggregate([
            {
                $group: {
                    _id: null,
                    totalProducts: { $sum: 1 },
                    averagePrice: { $avg: '$price.amount' },
                    minPrice: { $min: '$price.amount' },
                    maxPrice: { $max: '$price.amount' },
                    totalInventory: { $sum: '$inventory.quantity' }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalProducts: 1,
                    averagePrice: { $round: ['$averagePrice', 2] },
                    minPrice: 1,
                    maxPrice: 1,
                    totalInventory: 1
                }
            }
        ]);
        res.json(stats[0]);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product stats', error: error.message });
    }
});



router.get('/:id/related', cacheMiddleware(300), async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const relatedProducts = await Product.find({
            $and: [
                { _id: { $ne: product._id } },
                {
                    $or: [
                        { type: product.type },
                        { type: product.productCategory },
                        { categories: { $in: product.categories } },
                        { 'attributes.collection': product.attributes.collection }
                    ]
                }
            ]
        }).limit(5);

        res.json(relatedProducts);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching related products', error: error.message });
    }
});

router.get('/filter-options', async (req, res) => {
    try {
        const types = await Product.distinct('type');
        const productCategory = await Product.distinct("productCategory")
        const configurations = await Product.distinct('attributes.configuration');
        const colors = await Product.distinct('attributes.color.family');
        const dimensionLength = await Product.distinct("attributes.dimensions.length");
        const dimensionWidth = await Product.distinct("attributes.dimensions.width");
        const dimensionHeight = await Product.distinct("attributes.dimensions.height");
        const dimensionUnit = await Product.distinct("attributes.dimensions.unit");
        const shutterMaterial = await Product.distinct("attributes.woodwork.shutterMaterial");
        const shutterFinish = await Product.distinct("attributes.woodwork.shutterFinish");
        const finishType = await Product.distinct("attributes.woodwork.finishType");
        res.json({
            types,
            productCategory,
            configurations,
            colors,
            dimensionLength,
            dimensionHeight,
            dimensionWidth,
            dimensionUnit,
            shutterMaterial,
            shutterFinish,
            finishType,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching filter options', error: error.message });
    }
});

router.get('/collections', cacheMiddleware(300), async (req, res) => {
    try {
        const collections = await Product.aggregate([
            {
                $group: {
                    _id: "$attributes.collection",
                    image: { $first: "$images.url" },
                }
            },
            {
                $project: {
                    name: "$_id",
                    image: 1,
                    _id: 0
                }
            }
        ]);
        res.json(collections);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching collections', error: error.message });
    }
});

router.get('/collections/:collection', cacheMiddleware(300), async (req, res) => {
    try {
        const collectionName = new RegExp('^' + req.params.collection + '$', 'i');
        const products = await Product.find({ 'attributes.collection': collectionName });

        res.json({ products });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching collection products', error: error.message });
    }
});

router.post('/bulk', async (req, res) => {
    try {
        const products = req.body;
        if (!Array.isArray(products)) {
            return res.status(400).json({ message: 'Invalid input. Expected an array of products.' });
        }

        const result = await Product.insertMany(products);
        res.status(201).json({ message: `${result.length} products inserted successfully` });
    } catch (error) {
        res.status(500).json({ message: 'Error inserting products', error: error.message });
    }
});

router.get('/:id', cacheMiddleware(300), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid product ID' });
        }
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product', error: error.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const product = new Product(req.body);
        await product.save();
        res.status(201).json(product);
    } catch (error) {
        res.status(400).json({ message: 'Error creating product', error: error.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const oldProduct = await Product.findById(req.params.id);
        const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Check if price has changed
        if (oldProduct.price.amount !== product.price.amount) {
            await sendPriceChangeEmail(product);
        }

        res.json(product);
    } catch (error) {
        res.status(400).json({ message: 'Error updating product', error: error.message });
    }
});

const sendPriceChangeEmail = async (product) => {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        // Fetch users who have this product in their wishlist
        const usersWithProductInWishlist = await Wishlist.find({ products: product._id }).populate('user');

        for (let wishlist of usersWithProductInWishlist) {
            const mailOptions = {
                from: process.env.EMAIL_ADDRESS,
                to: wishlist.user.email,
                subject: "Price changed for a product in your wishlist",
                html: `
                <html>
                  <body>
                    <h1>Price Update</h1>
                    <p>Dear ${wishlist.user.name},</p>
                    <p>The price of ${product.name} in your wishlist has changed to ${product.price.amount} ${product.price.currency}.</p>
                    <p>Visit our website to check it out!</p>
                  </body>
                </html>
                `
            };

            const info = await transporter.sendMail(mailOptions);
            console.log('Price change email sent: ', info.response);
        }
    } catch (error) {
        console.error('Error sending price change email:', error);
    }
};


router.delete('/:id', async (req, res) => {
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

