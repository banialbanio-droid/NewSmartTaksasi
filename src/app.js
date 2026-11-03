const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const otrRoutes = require('./routes/otr');
const masterRoutes = require('./routes/master');
const clopRoutes = require('./routes/clop');
const bqRoutes = require('./routes/bookingQuality');
const roRoutes = require('./routes/repeatOrder');
const taksasiRoutes = require('./routes/taksasi');
const userRoutes = require('./routes/users');
const legacyRoutes = require('./routes/legacy/komite');
const { initDb } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ==== Rate limiting ====
// Backend bisa diekspos ke internet lewat tunnel, jadi batasi percobaan
// brute force PIN dan beban request berlebih.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 20,                   // 20 percobaan login per IP per 15 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.'
  }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 300,            // 300 request per IP per menit
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Terlalu banyak permintaan. Tunggu sebentar.'
  }
});

app.use('/api/', apiLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'SMART TAKSASI V3.2 Backend', version: '1.0.0' });
});

// Routes
app.use('/api/v1/auth/login', loginLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/otr', otrRoutes);
app.use('/api/v1/clop', clopRoutes);
app.use('/api/v1/booking-quality', bqRoutes);
app.use('/api/v1/repeat-order', roRoutes);
app.use('/api/v1/taksasi', taksasiRoutes);
app.use('/api/v1/master', masterRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api', legacyRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
});

// Initialize database and start server
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`SMART TAKSASI Backend running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  });

module.exports = app;
