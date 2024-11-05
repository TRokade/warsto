const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { mergeWishlistsAfterLogin } = require('../utils/wishList');
const { mergeCartsAfterLogin } = require('../utils/mergeCart');
const router = express.Router();

const generateTokens = (user) => {
    const accessToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ id: user._id }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken };
};

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:5000/api/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await User.findOne({ googleId: profile.id });
        if (!user) {
            user = await new User({
                googleId: profile.id,
                email: profile.emails[0].value,
                name: profile.displayName
            }).save();
        }
        done(null, user);
    } catch (err) {
        done(err, null);
    }
}));



passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
        try {
            const user = await User.findOne({ email });
            if (!user) {
                return done(null, false, { message: 'Incorrect email or password.' });
            }
            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                return done(null, false, { message: 'Incorrect email or password.' });
            }
            return done(null, user);
        } catch (err) {
            return done(err);
        }
    }
));
router.post('/signup', async (req, res) => {
    try {
        const { name, email, password, mobileNumber } = req.body;

        // Check if email already exists
        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({ message: 'Email is already in use' });
        }

        // Check if mobile number already exists
        const existingMobile = await User.findOne({ mobileNumber });
        if (existingMobile) {
            return res.status(400).json({ message: 'Mobile number is already in use' });
        }

        const user = new User({ name, email, password, mobileNumber });
        await user.save();
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({ user, token });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ message: 'Error signing up', error: error.message });
    }
});

router.post('/signin', (req, res, next) => {
    passport.authenticate('local', { session: false }, async (err, user, info) => {
        if (err || !user) {
            return res.status(400).json({ message: info ? info.message : 'Invalid credentials' });
        }

        try {
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
            const guestId = req.body.guestId;

            if (guestId) {
                await mergeCartsAfterLogin(user._id.toString(), guestId);
            }

            res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
            return res.json({ user, token });
        } catch (error) {
            console.error('Error during signin:', error);
            return res.status(500).json({ message: 'An error occurred during sign in' });
        }
    })(req, res, next);
});

router.post('/refresh-token', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ message: 'Refresh Token Required' });

    try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) return res.status(401).json({ message: 'User not found' });

        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
        res.json({ accessToken, refreshToken: newRefreshToken });
    } catch (error) {
        res.status(401).json({ message: 'Invalid Refresh Token' });
    }
});



router.put('/profile', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const updates = {
            name: req.body.name,
            mobileNumber: req.body.mobileNumber
        };

        const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error updating profile', error: error.message });
    }
});

router.post('/admin/signin', (req, res, next) => {
    passport.authenticate('local', { session: false }, (err, user, info) => {
        if (err) {
            return res.status(500).json({ message: 'An error occurred during sign in' });
        }
        if (!user || user.role !== 'admin') {
            return res.status(400).json({ message: info ? info.message : 'Invalid credentials' });
        }
        req.login(user, { session: false }, (err) => {
            if (err) {
                return res.status(500).json({ message: 'An error occurred during login' });
            }
            const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
            res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 }); // Set token as HTTP-only cookie
            return res.json({ user, token });
        });
    })(req, res);
});

// Add address
router.post('/address', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        user.addresses.push(req.body);
        await user.save();
        res.json(user.addresses);
    } catch (error) {
        res.status(500).json({ message: 'Error adding address', error: error.message });
    }
});

// Update address
router.put('/address/:id', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const address = user.addresses.id(req.params.id);
        if (!address) {
            return res.status(404).json({ message: 'Address not found' });
        }
        Object.assign(address, req.body);
        await user.save();
        res.json(user.addresses);
    } catch (error) {
        res.status(500).json({ message: 'Error updating address', error: error.message });
    }
});



router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'No account with that email address exists.' });
        }

        // Generate token
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "10m" });

        // Store the token and expiration in the user document
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 600000; // 10 minutes
        await user.save();

        // Create nodemailer transport
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_ADDRESS, // abhishekrai1574@gmail.com
                pass: process.env.EMAIL_PASSWORD // Your app password
            }
        });

        // Setup email data
        const mailOptions = {
            from: process.env.EMAIL_ADDRESS,
            to: email,
            subject: "Reset Password",
            html: `<h1>Reset Your Password</h1>
          <p>Click on the following link to reset your password:</p>
          <a href="http://localhost:3000/reset-password/${token}">Reset Password</a>
          <p>The link will expire in 10 minutes.</p>
          <p>If you didn't request a password reset, please ignore this email.</p>`
        };

        // Send email
        console.log('Attempting to send email...');
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ', info.response);
        res.status(200).json({ message: 'An e-mail has been sent to ' + email + ' with further instructions.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ message: 'Error sending password reset email', error: error.toString() });
    }
});
console.log(process.env.EMAIL_PASSWORD)

router.post('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { newPassword } = req.body;

        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Password reset token is invalid or has expired' });
        }

        // Set the new password
        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.status(200).json({ message: 'Password has been reset successfully' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ message: 'Error resetting password', error: error.message });
    }
});

// In your authentication middleware
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};


router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', passport.authenticate('google', { session: false }),
    (req, res) => {
        try {
            const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
            res.redirect(`http://localhost:3000/auth-success?token=${token}`);
        } catch (err) {
            console.error('Google OAuth callback error:', err);
            res.status(500).json({ message: 'Error handling Google OAuth callback' });
        }
    });

router.get('/user', passport.authenticate('jwt', { session: false }), (req, res) => {
    res.json(req.user);
});

router.get('/logout', (req, res) => {
    req.logout();
    res.json({ message: 'Logged out successfully' });
});

module.exports = router;