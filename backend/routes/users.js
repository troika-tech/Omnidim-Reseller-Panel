const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getPlans
} = require('../controllers/usersController');

// All routes protected with authentication
router.use(auth);

// Get all available plans
// GET /api/v1/users/plans
router.get('/plans', getPlans);

// Get all users with filters and pagination
// GET /api/v1/users?page=1&limit=10&search=email&role=user&plan=basic
router.get('/', getUsers);

// Get single user
// GET /api/v1/users/:id
router.get('/:id', getUser);

// Create new user
// POST /api/v1/users
router.post('/', createUser);

// Update user
// PUT /api/v1/users/:id
router.put('/:id', updateUser);

// Delete user
// DELETE /api/v1/users/:id
router.delete('/:id', deleteUser);

module.exports = router;

