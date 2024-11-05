const express = require('express');
const router = express.Router();
const User = require('../models/User');
const passport = require('passport');
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
    }
    next();
};

// Get all users (admin only)
router.get('/', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users', error: error.message });
    }
});

// Get user by ID (admin only)
router.get('/:id', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user', error: error.message });
    }
});

// Create new user (admin only)
router.post('/', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            name,
            email,
            password: hashedPassword,
            role: role || 'user'
        });
        await newUser.save();
        res.status(201).json({ message: 'User created successfully', user: newUser });
    } catch (error) {
        res.status(400).json({ message: 'Error creating user', error: error.message });
    }
});

// Update user (admin only)
router.put('/:id', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const { name, email, role, password } = req.body;
        const updateData = { name, email, role };
        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }
        const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        res.status(400).json({ message: 'Error updating user', error: error.message });
    }
});

// Delete user (admin only)
router.delete('/:id', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting user', error: error.message });
    }
});

// Get user statistics (admin only)
router.get('/stats/overview', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const adminUsers = await User.countDocuments({ role: 'admin' });
        const regularUsers = totalUsers - adminUsers;
        const latestUsers = await User.find().sort({ createdAt: -1 }).limit(5).select('-password');

        res.json({
            totalUsers,
            adminUsers,
            regularUsers,
            latestUsers
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user statistics', error: error.message });
    }
});

module.exports = router;

/*
GET /api/admin/users
GET /api/admin/users/:id
POST /api/admin/users
{
  "name": "",
  "email": "",
  "password": "",
  "role": "user" or "admin"
}
PUT /api/admin/users/:id 
{
  "name": "",
  "email": "",
  "role": "",
  "password": "" (optional)
}
DELETE /api/admin/users/:id
GET /api/admin/users/stats/overview
*/