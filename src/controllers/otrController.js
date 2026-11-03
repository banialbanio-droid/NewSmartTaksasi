const { getDb } = require('../db/database');

/**
 * Search OTR prices by brand, model, tahun
 * Query params: brand, model, tahun (optional)
 */
exports.searchOTR = (req, res) => {
  try {
    const { brand, model, tahun, limit = 50, offset = 0 } = req.query;

    if (!brand && !model && !tahun) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PARAMS',
        message: 'At least one search parameter required: brand, model, or tahun'
      });
    }

    const db = getDb();
    let query = 'SELECT * FROM otr_prices WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM otr_prices WHERE 1=1';
    let params = [];

    if (brand) {
      query += ' AND brand LIKE ?';
      countQuery += ' AND brand LIKE ?';
      params.push(`%${brand.trim()}%`);
    }

    if (model) {
      query += ' AND model LIKE ?';
      countQuery += ' AND model LIKE ?';
      params.push(`%${model.trim()}%`);
    }

    if (tahun) {
      query += ' AND tahun = ?';
      countQuery += ' AND tahun = ?';
      params.push(parseInt(tahun));
    }

    // Get total count
    db.get(countQuery, params, (err, countResult) => {
      if (err) {
        console.error('Count query error:', err.message);
        return res.status(500).json({
          success: false,
          code: 'DB_ERROR',
          message: 'Failed to query database'
        });
      }

      const total = countResult.total || 0;

      // Get paginated results
      query += ` ORDER BY brand, model, tahun LIMIT ? OFFSET ?`;
      const queryParams = [...params, parseInt(limit), parseInt(offset)];

      db.all(query, queryParams, (err, rows) => {
        if (err) {
          console.error('Query error:', err.message);
          return res.status(500).json({
            success: false,
            code: 'DB_ERROR',
            message: 'Failed to query database'
          });
        }

        res.json({
          success: true,
          data: rows || [],
          pagination: {
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            returned: (rows || []).length
          }
        });
      });
    });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: err.message
    });
  }
};

/**
 * Get OTR detail by ID
 */
exports.getOTRDetail = (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'OTR ID is required'
      });
    }

    const db = getDb();
    db.get(
      'SELECT * FROM otr_prices WHERE id = ?',
      [parseInt(id)],
      (err, row) => {
        if (err) {
          console.error('Query error:', err.message);
          return res.status(500).json({
            success: false,
            code: 'DB_ERROR',
            message: 'Failed to query database'
          });
        }

        if (!row) {
          return res.status(404).json({
            success: false,
            code: 'NOT_FOUND',
            message: 'OTR data not found'
          });
        }

        res.json({
          success: true,
          data: row
        });
      }
    );
  } catch (err) {
    console.error('Get detail error:', err.message);
    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: err.message
    });
  }
};

/**
 * Get distinct brands
 */
exports.getBrands = (req, res) => {
  try {
    const db = getDb();
    db.all(
      'SELECT DISTINCT brand FROM otr_prices WHERE brand IS NOT NULL AND brand != "" ORDER BY brand',
      [],
      (err, rows) => {
        if (err) {
          console.error('Query error:', err.message);
          return res.status(500).json({
            success: false,
            code: 'DB_ERROR',
            message: 'Failed to query database'
          });
        }

        res.json({
          success: true,
          data: (rows || []).map(r => r.brand)
        });
      }
    );
  } catch (err) {
    console.error('Get brands error:', err.message);
    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: err.message
    });
  }
};

/**
 * Get models by brand
 */
exports.getModelsByBrand = (req, res) => {
  try {
    const { brand } = req.params;

    if (!brand) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_BRAND',
        message: 'Brand is required'
      });
    }

    const db = getDb();
    db.all(
      'SELECT DISTINCT model FROM otr_prices WHERE brand = ? ORDER BY model',
      [brand.trim()],
      (err, rows) => {
        if (err) {
          console.error('Query error:', err.message);
          return res.status(500).json({
            success: false,
            code: 'DB_ERROR',
            message: 'Failed to query database'
          });
        }

        res.json({
          success: true,
          data: (rows || []).map(r => r.model)
        });
      }
    );
  } catch (err) {
    console.error('Get models error:', err.message);
    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: err.message
    });
  }
};
