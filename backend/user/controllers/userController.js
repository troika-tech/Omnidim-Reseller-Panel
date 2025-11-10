const User = require("../../models/User");

// Update user's exotel numbers
exports.updateUserExotelNumbers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { exotelNumbers } = req.body;

    if (!Array.isArray(exotelNumbers)) {
      return res.status(400).json({
        success: false,
        message: "exotelNumbers must be an array",
      });
    }

    // Validate and clean phone numbers
    const cleanedNumbers = exotelNumbers
      .map((num) => String(num).trim())
      .filter(Boolean);

    const user = await User.findByIdAndUpdate(
      userId,
      { exotelNumbers: cleanedNumbers },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log(`✅ Updated user ${userId} exotel numbers:`, cleanedNumbers);

    res.json({
      success: true,
      data: {
        userId: user._id,
        exotelNumbers: user.exotelNumbers,
      },
      message: "Exotel numbers updated successfully",
    });
  } catch (error) {
    console.error("Update User Exotel Numbers Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get user's exotel numbers
exports.getUserExotelNumbers = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select("exotelNumbers");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: {
        userId: user._id,
        exotelNumbers: user.exotelNumbers || [],
      },
    });
  } catch (error) {
    console.error("Get User Exotel Numbers Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
