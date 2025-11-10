const VoiceAssistant = require("../models/VoiceAssistant");
const {
  syncToOmnidimension,
  fetchFromOmnidimension,
} = require("../services/omniApi");

// Create a new voice assistant
exports.createVoiceAssistant = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      name,
      description,
      useCase,
      llm,
      voice,
      knowledgeBaseFiles,
      webSearch,
      postCall,
      integrations,
      tags,
      textBased,
      outgoing,
    } = req.body;

    // Validate required fields
    if (!name || !description || !useCase) {
      return res.status(400).json({
        success: false,
        message: "Name, description, and use case are required",
      });
    }

    // Validate use case
    const validUseCases = [
      "Lead Generation",
      "Appointments",
      "Support",
      "Negotiation",
      "Collections",
    ];
    if (!validUseCases.includes(useCase)) {
      return res.status(400).json({
        success: false,
        message: "Invalid use case",
      });
    }

    // Create voice assistant in OMNIDIMENSION
    let omnidimensionResponse;
    try {
      // Map our fields to OMNIDIMENSION API format
      const omniPayload = {
        name,
        welcome_message:
          description || `Hello! I'm ${name}. How can I help you?`,
        context_breakdown: [
          {
            title: "Purpose",
            body: description || `${name} - AI Voice Assistant for ${useCase}`,
          },
          {
            title: "Use Case",
            body: useCase,
            is_enabled: true,
          },
        ],
      };

      // Add optional fields if provided
      if (outgoing !== undefined) {
        omniPayload.call_type = outgoing ? "Outgoing" : "Incoming";
      }

      omnidimensionResponse = await syncToOmnidimension(
        "agents/create",
        omniPayload,
        "POST"
      );
    } catch (apiError) {
      console.error("OMNIDIMENSION API Error:", apiError.message);
      return res.status(502).json({
        success: false,
        message: "Failed to sync with OMNIDIMENSION. Please try again.",
        error: apiError.message,
      });
    }

    // Save to local database
    const voiceAssistant = new VoiceAssistant({
      userId,
      omnidimensionId: omnidimensionResponse.id || `va_${Date.now()}`,
      name,
      description,
      useCase,
      llm: llm || "azure-gpt-4o-mini",
      voice: voice || "google",
      knowledgeBaseFiles: knowledgeBaseFiles || 0,
      webSearch: webSearch || false,
      postCall: postCall || "None",
      integrations: integrations || [],
      tags: tags || [],
      textBased: textBased || false,
      outgoing: outgoing !== undefined ? outgoing : true,
      syncedAt: new Date(),
      lastSynced: new Date(),
      syncStatus: "synced",
    });

    await voiceAssistant.save();

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("voice_assistant_created", voiceAssistant);
      console.log("📡 Broadcasted: voice_assistant_created");
    }

    res.status(201).json({
      success: true,
      message: "Voice assistant created and synced successfully",
      data: voiceAssistant,
    });
  } catch (error) {
    console.error("Create Voice Assistant Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get all voice assistants with search and pagination
exports.getVoiceAssistants = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, page = 1, limit = 10 } = req.query;

    // Auto-sync from OMNIDIMENSION in the background. Never block response.
    fetchFromOmnidimension("agents")
      .then((response) => {
        const omniAssistants = response?.bots || response || [];

        if (Array.isArray(omniAssistants) && omniAssistants.length > 0) {
          return syncFromOmnidimension(omniAssistants, userId);
        }
      })
      .catch((apiError) => {
        // Continue even if API fails - just use local data
        console.error("Auto-sync skipped:", apiError.message);
      });

    // Build query
    const query = { userId };

    // Add search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get voice assistants
    const voiceAssistants = await VoiceAssistant.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await VoiceAssistant.countDocuments(query);

    res.json({
      success: true,
      data: voiceAssistants,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get Voice Assistants Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get single voice assistant
exports.getVoiceAssistant = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const voiceAssistant = await VoiceAssistant.findOne({
      _id: id,
      userId,
    });

    if (!voiceAssistant) {
      return res.status(404).json({
        success: false,
        message: "Voice assistant not found",
      });
    }

    res.json({
      success: true,
      data: voiceAssistant,
    });
  } catch (error) {
    console.error("Get Voice Assistant Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Update voice assistant
exports.updateVoiceAssistant = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const updateData = req.body;

    // Find voice assistant
    const voiceAssistant = await VoiceAssistant.findOne({
      _id: id,
      userId,
    });

    if (!voiceAssistant) {
      return res.status(404).json({
        success: false,
        message: "Voice assistant not found",
      });
    }

    // Validate use case if provided
    if (updateData.useCase) {
      const validUseCases = [
        "Lead Generation",
        "Appointments",
        "Support",
        "Negotiation",
        "Collections",
      ];
      if (!validUseCases.includes(updateData.useCase)) {
        return res.status(400).json({
          success: false,
          message: "Invalid use case",
        });
      }
    }

    // Update in OMNIDIMENSION
    try {
      // Map our fields to OMNIDIMENSION API format
      const omniPayload = {};

      if (updateData.name) omniPayload.name = updateData.name;
      if (updateData.description) {
        omniPayload.welcome_message = updateData.description;
      }
      if (updateData.outgoing !== undefined) {
        omniPayload.call_type = updateData.outgoing ? "Outgoing" : "Incoming";
      }
      if (updateData.useCase) {
        omniPayload.context_breakdown = [
          {
            title: "Purpose",
            body:
              updateData.description ||
              `${updateData.name || voiceAssistant.name}`,
            is_enabled: true,
          },
          {
            title: "Use Case",
            body: updateData.useCase,
            is_enabled: true,
          },
        ];
      }

      await syncToOmnidimension(
        `agents/${voiceAssistant.omnidimensionId}`,
        omniPayload,
        "PUT"
      );
    } catch (apiError) {
      console.error("OMNIDIMENSION API Error:", apiError.message);
      voiceAssistant.syncStatus = "error";
      await voiceAssistant.save();

      return res.status(502).json({
        success: false,
        message: "Failed to sync with OMNIDIMENSION. Changes saved locally.",
        error: apiError.message,
      });
    }

    // Update local database
    Object.assign(voiceAssistant, updateData);
    voiceAssistant.lastSynced = new Date();
    voiceAssistant.syncStatus = "synced";
    await voiceAssistant.save();

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("voice_assistant_updated", voiceAssistant);
      console.log("📡 Broadcasted: voice_assistant_updated");
    }

    res.json({
      success: true,
      message: "Voice assistant updated and synced successfully",
      data: voiceAssistant,
    });
  } catch (error) {
    console.error("Update Voice Assistant Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete voice assistant
exports.deleteVoiceAssistant = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Find voice assistant
    const voiceAssistant = await VoiceAssistant.findOne({
      _id: id,
      userId,
    });

    if (!voiceAssistant) {
      return res.status(404).json({
        success: false,
        message: "Voice assistant not found",
      });
    }

    // Delete from OMNIDIMENSION
    try {
      await fetchFromOmnidimension(
        `agents/${voiceAssistant.omnidimensionId}`,
        "DELETE"
      );
    } catch (apiError) {
      console.error("OMNIDIMENSION API Error:", apiError.message);
      // Continue with local deletion even if API fails
    }

    // Delete from local database
    await VoiceAssistant.findByIdAndDelete(id);

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("voice_assistant_deleted", { id });
      console.log("📡 Broadcasted: voice_assistant_deleted");
    }

    res.json({
      success: true,
      message: "Voice assistant deleted successfully",
    });
  } catch (error) {
    console.error("Delete Voice Assistant Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Helper function to sync from OMNIDIMENSION to local (currently not used but kept for future use)
async function syncFromOmnidimension(omniAssistants, userId) {
  let syncedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;

  // Step 1: Get all existing agents from OMNIDIMENSION
  const omniIds = omniAssistants
    .map((agent) => agent.id?.toString())
    .filter(Boolean);

  // Step 2: Sync existing/update/create new agents
  for (const omniAssistant of omniAssistants) {
    try {
      // Skip if essential fields are missing
      if (!omniAssistant.id) {
        console.error("Skipping assistant: missing id", omniAssistant);
        continue;
      }

      const existing = await VoiceAssistant.findOne({
        omnidimensionId: omniAssistant.id,
        userId,
      });

      // Map OMNIDIMENSION API fields to our schema
      const mappedData = {
        name: omniAssistant.name || `Agent ${omniAssistant.id}`,
        description:
          omniAssistant.description ||
          omniAssistant.attach_file_access_description ||
          omniAssistant.welcome_message ||
          `Agent: ${omniAssistant.name || omniAssistant.id}`,
        useCase: omniAssistant.useCase || "Support", // Default if not mapped
        llm:
          omniAssistant.llm_service || omniAssistant.llm || "azure-gpt-4o-mini",
        voice: omniAssistant.voice_provider || omniAssistant.voice || "google",
        knowledgeBaseFiles: omniAssistant.attach_file_ids?.length || 0,
        webSearch: omniAssistant.enable_web_search || false,
        postCall:
          omniAssistant.post_call_config_ids?.length > 0 ? "Email" : "None",
        integrations: omniAssistant.integration_ids || [],
        tags: [],
        textBased: false,
        outgoing: omniAssistant.bot_call_type === "Outgoing",
        lastSynced: new Date(),
        syncStatus: "synced",
      };

      if (existing) {
        // Update existing
        Object.assign(existing, mappedData);
        await existing.save();
        updatedCount++;
      } else {
        // Create new
        const voiceAssistant = new VoiceAssistant({
          userId,
          omnidimensionId: omniAssistant.id.toString(),
          ...mappedData,
        });
        await voiceAssistant.save();
        createdCount++;

        // Broadcast creation
        if (global.io) {
          global.io.emit("voice_assistant_created", voiceAssistant);
          console.log("📡 Broadcasted: voice_assistant_created (from sync)");
        }
      }
      syncedCount++;
    } catch (error) {
      console.error("Error syncing individual assistant:", error.message);
    }
  }

  // Step 3: Delete agents that no longer exist in OMNIDIMENSION
  try {
    const agentsToDelete = await VoiceAssistant.find({
      userId,
      omnidimensionId: { $nin: omniIds },
    });

    for (const agent of agentsToDelete) {
      await VoiceAssistant.findByIdAndDelete(agent._id);
      deletedCount++;
      console.log(
        `🗑️  Deleted agent: ${agent.name} (${agent.omnidimensionId}) - not in OMNIDIMENSION`
      );

      // Broadcast deletion
      if (global.io) {
        global.io.emit("voice_assistant_deleted", { id: agent._id.toString() });
        console.log("📡 Broadcasted: voice_assistant_deleted (from sync)");
      }
    }
  } catch (error) {
    console.error("Error deleting orphaned assistants:", error.message);
  }

  console.log(
    `✅ Sync complete: ${syncedCount} synced, ${createdCount} created, ${updatedCount} updated, ${deletedCount} deleted`
  );
  return { syncedCount, createdCount, updatedCount, deletedCount };
}
