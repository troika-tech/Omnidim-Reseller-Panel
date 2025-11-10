const User = require("../models/User");
const bcrypt = require("bcrypt");
const { getAllPlans, getPlanById, isValidPlanId } = require("../config/plans");

// Get all users
// GET /api/v1/users
exports.getUsers = async (req, res) => {
  try {
    const { search, page = 1, limit = 10, role, plan } = req.query;

    // Build query
    const query = {};

    if (search) {
      query.$or = [
        { email: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ];
    }

    if (role) {
      query.role = role;
    }

    if (plan) {
      query.plan = plan;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const users = await User.find(query)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get Users Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get single user
// GET /api/v1/users/:id
exports.getUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Get User Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Create new user
// POST /api/v1/users
exports.createUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role = "user",
      plan = "basic",
      exotelNumbers = [],
    } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Validate plan
    if (!isValidPlanId(plan)) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan. Must be: basic, pro, or enterprise",
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this email already exists",
      });
    }

    // Get plan details
    const planDetails = getPlanById(plan);

    // Hash password if provided
    let hashedPassword = null;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    // Validate exotelNumbers is an array
    let exotelNumbersArray = [];
    if (exotelNumbers) {
      exotelNumbersArray = Array.isArray(exotelNumbers)
        ? exotelNumbers.filter((num) => num && num.trim())
        : [exotelNumbers].filter((num) => num && num.trim());
    }

    // Create user
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      plan,
      minutesPerMonth: planDetails.minutesPerMonth,
      exotelNumbers: exotelNumbersArray,
      isActive: true,
    });

    await user.save();

    // Return user without password
    const userResponse = user.toObject();
    delete userResponse.password;

    // Broadcast to connected clients
    if (global.io) {
      global.io.emit("user_created", userResponse);
    }

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: userResponse,
    });
  } catch (error) {
    console.error("Create User Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Update user
// PUT /api/v1/users/:id
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, plan, isActive, exotelNumbers } =
      req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update name if provided
    if (name && name.trim()) {
      user.name = name.trim();
    }

    // Update email if provided
    if (email && email !== user.email) {
      // Check if new email already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Email already in use",
        });
      }
      user.email = email.toLowerCase();
    }

    // Update role if provided
    if (role) {
      user.role = role;
    }

    // Update plan if provided
    if (plan) {
      if (!isValidPlanId(plan)) {
        return res.status(400).json({
          success: false,
          message: "Invalid plan. Must be: basic, pro, or enterprise",
        });
      }
      user.plan = plan;
      // Update minutes per month based on plan
      const planDetails = getPlanById(plan);
      user.minutesPerMonth = planDetails.minutesPerMonth;
    }

    // Update password if provided
    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    // Update isActive if provided
    if (typeof isActive === "boolean") {
      user.isActive = isActive;
    }

    // Update exotelNumbers if provided
    if (exotelNumbers !== undefined) {
      let exotelNumbersArray = [];
      if (exotelNumbers) {
        exotelNumbersArray = Array.isArray(exotelNumbers)
          ? exotelNumbers.filter((num) => num && num.trim())
          : [exotelNumbers].filter((num) => num && num.trim());
      }
      user.exotelNumbers = exotelNumbersArray;
    }

    await user.save();

    // Return user without password
    const userResponse = user.toObject();
    delete userResponse.password;

    // Broadcast to connected clients
    if (global.io) {
      global.io.emit("user_updated", userResponse);
    }

    res.json({
      success: true,
      message: "User updated successfully",
      data: userResponse,
    });
  } catch (error) {
    console.error("Update User Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete user
// DELETE /api/v1/users/:id
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting self
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Prevent deleting admin users (optional - you can remove this if needed)
    if (user.role === "admin") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete admin users",
      });
    }

    await User.findByIdAndDelete(id);

    // Broadcast to connected clients
    if (global.io) {
      global.io.emit("user_deleted", { id });
    }

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete User Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get all available plans
// GET /api/v1/users/plans
exports.getPlans = async (req, res) => {
  try {
    const plans = getAllPlans();

    res.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    console.error("Get Plans Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
