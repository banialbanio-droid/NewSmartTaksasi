const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '6h';
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 3;

// Tanpa fallback: kalau JWT_SECRET kosong, server menolak jalan. Fallback
// secret tetap berarti siapa pun yang tahu kodenya bisa menerbitkan token
// sendiri (termasuk role SUPERVISOR) dan melewati seluruh login.
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET belum diset atau terlalu pendek (min 32 karakter). ' +
    'Isi JWT_SECRET di .env sebelum menjalankan server.'
  );
}

// Hash PIN
async function hashPin(pin) {
  const saltRounds = 10;
  return bcrypt.hash(pin, saltRounds);
}

// Verify PIN
async function verifyPin(pin, hash) {
  return bcrypt.compare(pin, hash);
}

// Generate JWT token
function generateToken(user) {
  const payload = {
    sub: user.cs_id,
    csId: user.cs_id,
    nama: user.nama,
    role: user.role,
    status: user.status,
    email: user.email || '',
    mustChangePin: !!user.must_change_pin
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Check if PIN is weak
function isWeakPin(pin) {
  const weakPins = [
    '123456', '654321', '000000', '111111', '222222', '333333',
    '444444', '555555', '666666', '777777', '888888', '999999',
    '121212', '112233'
  ];
  return weakPins.includes(pin);
}

// Generate temporary PIN (6 digits)
function generateTempPin() {
  const digits = '0123456789';
  let pin = '';
  for (let i = 0; i < 6; i++) {
    pin += digits[Math.floor(Math.random() * digits.length)];
  }
  return pin;
}

module.exports = {
  hashPin,
  verifyPin,
  generateToken,
  verifyToken,
  isWeakPin,
  generateTempPin,
  MAX_LOGIN_ATTEMPTS,
  JWT_EXPIRES_IN
};
