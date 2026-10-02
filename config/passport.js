// Đăng nhập Google / Facebook (Tự chọn 1, 2) — chỉ bật khi đã điền key trong .env
const passport = require('passport');
const { User } = require('../models');

async function findOrCreate(provider, profile, done) {
  try {
    const idField = provider === 'google' ? 'googleId' : 'facebookId';
    const email = profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : `${profile.id}@${provider}.keebhub.local`;
    let user = await User.findOne({ [idField]: profile.id });
    if (!user) user = await User.findOne({ email });
    if (!user) {
      user = new User({ name: profile.displayName || 'Người dùng ' + provider, email, emailVerified: true });
    }
    user[idField] = profile.id;
    if (!user.emailVerified) user.emailVerified = true; // email đã được nhà cung cấp xác minh
    if (profile.photos && profile.photos[0] && !user.avatar) user.avatar = profile.photos[0].value;
    await user.save();
    done(null, user);
  } catch (e) { done(e); }
}

const enabled = { google: false, facebook: false };
const base = process.env.BASE_URL || 'http://localhost:3000';

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${base}/auth/google/callback`
  }, (at, rt, profile, done) => findOrCreate('google', profile, done)));
  enabled.google = true;
}

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  const FacebookStrategy = require('passport-facebook').Strategy;
  passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: `${base}/auth/facebook/callback`,
    profileFields: ['id', 'displayName', 'emails', 'photos']
  }, (at, rt, profile, done) => findOrCreate('facebook', profile, done)));
  enabled.facebook = true;
}

module.exports = { passport, enabled };
