const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const {
  updateUserExotelNumbers,
  getUserExotelNumbers,
} = require("../controllers/userController");

// All routes require authentication
router.use(auth);

// Get user's exotel numbers
router.get("/exotel-numbers", getUserExotelNumbers);

// Update user's exotel numbers
router.put("/exotel-numbers", updateUserExotelNumbers);

module.exports = router;
