const File = require("../models/File");
const VoiceAssistant = require("../models/VoiceAssistant");
const {
  syncToOmnidimension,
  fetchFromOmnidimension,
} = require("../services/omniApi");
const fs = require("fs");
const path = require("path");

// Helper function to extract numeric ID from omnidimensionId
// OMNIDIMENSION API expects string IDs for knowledge base operations
// The API has issues with large integers, so we always return strings
function extractNumericId(id) {
  if (!id) return null;

  let stringId = id.toString();

  // Remove common prefixes if present
  if (stringId.startsWith("file_")) {
    stringId = stringId.replace("file_", "");
  }
  if (stringId.startsWith("agent_")) {
    stringId = stringId.replace("agent_", "");
  }

  // Always return as string to avoid PostgreSQL integer range issues
  return stringId;
}

// Upload file
exports.uploadFile = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const fileData = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype,
      url: `/uploads/${req.file.filename}`,
      storagePath: req.file.path,
    };

    // Upload to OMNIDIMENSION
    let omnidimensionResponse;
    try {
      // Read file for upload
      const fileBuffer = fs.readFileSync(req.file.path);

      // Use the correct endpoint from Omni documentation
      omnidimensionResponse = await syncToOmnidimension(
        "knowledge_base/create",
        {
          file: fileBuffer.toString("base64"),
          filename: req.file.originalname,
        },
        "POST"
      );
    } catch (apiError) {
      // Clean up local file if API fails
      fs.unlinkSync(req.file.path);

      return res.status(502).json({
        success: false,
        message: "Failed to sync with OMNIDIMENSION. File not uploaded.",
        error: apiError.message,
      });
    }

    // Save to local database
    // Check what ID the API returned
    // The API returns the ID nested in file.id
    const omniId =
      omnidimensionResponse?.file?.id ||
      omnidimensionResponse?.id ||
      omnidimensionResponse?.file_id ||
      omnidimensionResponse?.data?.id;

    if (!omniId) {
      // Clean up local file if API doesn't return ID
      fs.unlinkSync(req.file.path);
      return res.status(502).json({
        success: false,
        message:
          "Failed to sync with OMNIDIMENSION. API did not return file ID.",
        error: "No file ID in API response",
      });
    }

    const file = new File({
      userId,
      omnidimensionId: omniId.toString(),
      ...fileData,
      syncedAt: new Date(),
      lastSynced: new Date(),
      syncStatus: "synced",
    });

    await file.save();

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("file_created", file);
    }

    res.status(201).json({
      success: true,
      message: "File uploaded and synced successfully",
      data: file,
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get all files with pagination
exports.getFiles = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, search } = req.query;

    // Auto-sync from OMNIDIMENSION first (background, don't wait)
    try {
      const response = await fetchFromOmnidimension("knowledge_base/list");
      const omniFiles = response?.files || response?.data || response || [];

      if (Array.isArray(omniFiles)) {
        // Sync in background without blocking
        syncFromOmnidimension(omniFiles, userId).catch((err) => {});
      }
    } catch (apiError) {
      // Continue even if API fails - just use local data
    }

    // Build query
    const query = { userId };

    // Add search functionality
    if (search) {
      query.$or = [
        { originalName: { $regex: search, $options: "i" } },
        { filename: { $regex: search, $options: "i" } },
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get files
    const files = await File.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await File.countDocuments(query);

    res.json({
      success: true,
      data: files,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get single file details
exports.getFile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const file = await File.findOne({
      _id: id,
      userId,
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    res.json({
      success: true,
      data: file,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete file
exports.deleteFile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Find file
    const file = await File.findOne({
      _id: id,
      userId,
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    // Delete from OMNIDIMENSION only if we have a valid omnidimensionId
    if (file.omnidimensionId) {
      const finalFileId = extractNumericId(file.omnidimensionId);

      // Validate that the ID is not too large for PostgreSQL integer
      const maxInt = 2147483647;
      const fileIdNum = parseInt(finalFileId, 10);

      if (isNaN(fileIdNum) || fileIdNum > maxInt) {
      } else {
        try {
          // Use the correct endpoint from Omni documentation
          await syncToOmnidimension(
            "knowledge_base/delete",
            {
              file_id: fileIdNum, // Send as number, not string
            },
            "POST"
          );
        } catch (apiError) {
          // Continue with local deletion even if API fails
        }
      }
    } else {
    }

    // Delete from local storage
    if (fs.existsSync(file.storagePath)) {
      fs.unlinkSync(file.storagePath);
    }

    // Delete from local database
    const deletedFileId = id;
    const deletedOmniId = file.omnidimensionId?.toString();
    await File.findByIdAndDelete(id);

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("file_deleted", {
        id: deletedFileId,
        omnidimensionId: deletedOmniId,
      });
    }

    res.json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Helper function to sync from OMNIDIMENSION to local
async function syncFromOmnidimension(omniFiles, userId) {
  let syncedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;

  // Step 1: Get all existing files from OMNIDIMENSION
  const omniIds = omniFiles.map((file) => file.id?.toString()).filter(Boolean);

  // Step 2: Sync existing/update/create new files
  for (const omniFile of omniFiles) {
    try {
      // Skip if essential fields are missing
      if (!omniFile.id) {
        continue;
      }

      const existing = await File.findOne({
        omnidimensionId: omniFile.id.toString(),
        userId,
      });

      if (existing) {
        // Update existing
        existing.filename =
          omniFile.filename || omniFile.name || existing.filename;
        existing.originalName =
          omniFile.originalName ||
          omniFile.original_filename ||
          omniFile.name ||
          existing.originalName;
        existing.size = omniFile.file_size || omniFile.size || existing.size;
        existing.type = omniFile.mime_type || omniFile.type || existing.type;
        existing.url =
          omniFile.download_url ||
          omniFile.url ||
          existing.url ||
          `/uploads/${omniFile.id}`;
        // Files from OMNIDIMENSION don't have local storagePath, keep existing or use placeholder
        existing.storagePath =
          existing.storagePath || `omnidimension://${omniFile.id}`;
        existing.lastSynced = new Date();
        existing.syncStatus = "synced";
        await existing.save();
        updatedCount++;

        // Check if file has attached agents in Omni but not in local DB
        if (
          omniFile.attachedAgents &&
          Array.isArray(omniFile.attachedAgents) &&
          omniFile.attachedAgents.length > 0
        ) {
          // Process agent attachments
          await syncFileAgentAttachments(
            existing,
            omniFile.attachedAgents,
            userId
          );
        }
      } else {
        // Create new
        const file = new File({
          userId,
          omnidimensionId: omniFile.id.toString(),
          filename: omniFile.name || omniFile.filename || `file_${omniFile.id}`,
          originalName:
            omniFile.original_filename ||
            omniFile.originalName ||
            omniFile.name ||
            `File ${omniFile.id}`,
          size: omniFile.file_size || omniFile.size || 0,
          type: omniFile.mime_type || omniFile.type || "application/pdf",
          // Use download_url from OMNIDIMENSION, fallback to placeholder
          url:
            omniFile.download_url || omniFile.url || `/uploads/${omniFile.id}`,
          // Files from OMNIDIMENSION don't have local storagePath, use placeholder
          storagePath: omniFile.storagePath || `omnidimension://${omniFile.id}`,
          lastSynced: new Date(),
          syncStatus: "synced",
          attachedAgents: [], // Initialize with empty array
        });
        await file.save();
        createdCount++;

        // Process agent attachments if any
        if (
          omniFile.attachedAgents &&
          Array.isArray(omniFile.attachedAgents) &&
          omniFile.attachedAgents.length > 0
        ) {
          await syncFileAgentAttachments(file, omniFile.attachedAgents, userId);
        }

        // Broadcast creation
        if (global.io) {
          global.io.emit("file_created", file);
        }
      }
      syncedCount++;
    } catch (error) {}
  }

  // Step 3: Delete files that no longer exist in OMNIDIMENSION
  // Only delete files that have an omnidimensionId (were synced from Omni)
  try {
    const filesToDelete = await File.find({
      userId,
      omnidimensionId: { $nin: omniIds, $exists: true }, // Only delete files that have an omnidimensionId
    });

    for (const fileToDelete of filesToDelete) {
      // Delete from local storage
      if (fs.existsSync(fileToDelete.storagePath)) {
        fs.unlinkSync(fileToDelete.storagePath);
      }

      await File.findByIdAndDelete(fileToDelete._id);
      deletedCount++;

      // Broadcast deletion
      if (global.io) {
        global.io.emit("file_deleted", { id: fileToDelete._id.toString() });
      }
    }
  } catch (error) {}

  return { syncedCount, createdCount, updatedCount, deletedCount };
}

// Helper function to sync file-agent attachments
async function syncFileAgentAttachments(file, omniAgentIds, userId) {
  if (
    !omniAgentIds ||
    !Array.isArray(omniAgentIds) ||
    omniAgentIds.length === 0
  ) {
    return;
  }

  try {
    // Find all agents that match the Omni agent IDs
    const agents = await VoiceAssistant.find({
      userId,
      omnidimensionId: { $in: omniAgentIds.map((id) => id.toString()) },
    });

    if (agents.length === 0) {
      return;
    }

    // Get agent ObjectIds
    const agentObjectIds = agents.map((agent) => agent._id);

    // Update file's attachedAgents
    for (const agentId of agentObjectIds) {
      const isAlreadyAttached = file.attachedAgents.some((existingAgentId) =>
        existingAgentId.equals(agentId)
      );

      if (!isAlreadyAttached) {
        file.attachedAgents.push(agentId);
      }
    }

    // Save the updated file
    await file.save();

    // Update agents' knowledgeBaseFiles count
    for (const agent of agents) {
      agent.knowledgeBaseFiles = await File.countDocuments({
        userId,
        attachedAgents: agent._id,
      });
      await agent.save();
    }
  } catch (error) {}
}

// Unified knowledge base webhook (POST /api/v1/knowledge_base/webhook)
// This endpoint handles create, delete, attach, and detach events from OMNIDIMENSION
// Detects event type from request body and calls appropriate handler
exports.unifiedKnowledgeBaseWebhook = async (req, res) => {
  try {
    const body = req.body;

    // Check for attach/detach events first (they have both file_ids and agent_id)
    if (body.file_ids && Array.isArray(body.file_ids) && body.agent_id) {
      // Check event type or detect from context
      const eventType = body.event || body.action;

      if (eventType === "detach" || body.event === "files_detached") {
        // Detach event
        return await exports.detachFilesFromAgent(req, res);
      } else {
        // Attach event (default when both file_ids and agent_id are present)
        return await exports.attachFilesToAgent(req, res);
      }
    }

    // Check if this is a delete event
    // Delete events typically have: { file_id: ... } (no file object)
    if (body.file_id && (!body.file || !body.file.id)) {
      return await exports.deleteKnowledgeBaseFile(req, res);
    }

    // Otherwise, treat as create/update event

    return await exports.createKnowledgeBaseFile(req, res);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Create knowledge base file webhook (POST /api/v1/knowledge_base/create)
// This endpoint receives webhooks from OMNIDIMENSION when a file is created there
exports.createKnowledgeBaseFile = async (req, res) => {
  try {
    const userId = req.user.id;
    // OMNIDIMENSION sends the file data in the request body
    // Could be in format: { file: {...} } or directly { id, name, ... }
    const omniFile = req.body.file || req.body;

    if (!omniFile.id) {
      return res.status(400).json({
        success: false,
        message: "file.id is required",
      });
    }

    // Check if file already exists in local database
    const existing = await File.findOne({
      omnidimensionId: omniFile.id.toString(),
      userId,
    });

    if (existing) {
      // Update existing file
      existing.originalName =
        omniFile.original_filename || omniFile.name || existing.originalName;
      existing.filename = omniFile.name || existing.filename;
      existing.size = omniFile.file_size || omniFile.size || existing.size;
      existing.type = omniFile.mime_type || omniFile.type || existing.type;
      existing.url =
        omniFile.download_url ||
        omniFile.url ||
        existing.url ||
        `/uploads/${omniFile.id}`;
      // Files from OMNIDIMENSION don't have local storagePath, keep existing or use placeholder
      existing.storagePath =
        existing.storagePath || `omnidimension://${omniFile.id}`;
      existing.lastSynced = new Date();
      existing.syncStatus = "synced";
      await existing.save();

      // Broadcast update to connected clients
      if (global.io) {
        global.io.emit("file_updated", existing);
      }
    } else {
      // Create new file from OMNIDIMENSION webhook
      const file = new File({
        userId,
        omnidimensionId: omniFile.id.toString(),
        filename: omniFile.name || `file_${omniFile.id}`,
        originalName:
          omniFile.original_filename || omniFile.name || `File ${omniFile.id}`,
        size: omniFile.file_size || omniFile.size || 0,
        type: omniFile.mime_type || omniFile.type || "application/pdf",
        // Use download_url from OMNIDIMENSION, fallback to placeholder
        url: omniFile.download_url || omniFile.url || `/uploads/${omniFile.id}`,
        // Files from OMNIDIMENSION don't have local storagePath, use placeholder
        storagePath: `omnidimension://${omniFile.id}`,
        syncedAt: new Date(),
        lastSynced: new Date(),
        syncStatus: "synced",
        attachedAgents: [], // Initialize with empty array
      });
      await file.save();

      // Broadcast creation to connected clients
      if (global.io) {
        global.io.emit("file_created", file);
      }
    }

    // Return success - don't call back to OMNIDIMENSION (prevents infinite loop)
    res.json({
      success: true,
      message: "File creation webhook processed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete knowledge base file (POST /api/v1/knowledge_base/delete)
exports.deleteKnowledgeBaseFile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { file_id } = req.body;

    if (!file_id) {
      return res.status(400).json({
        success: false,
        message: "file_id is required",
      });
    }

    // Find file by omnidimensionId or _id
    const file = await File.findOne({
      $or: [{ omnidimensionId: file_id.toString() }, { _id: file_id }],
      userId,
    });

    if (!file) {
      // If file not found in local DB but request came from Omni API
      // We should still return success to avoid sync issues
      if (req.headers["x-source"] === "omnidimension") {
        return res.json({
          success: true,
          message: "File deletion acknowledged (file not in local DB)",
        });
      }

      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    // Delete from OMNIDIMENSION only if request didn't come from Omni
    // This prevents infinite sync loops
    if (req.headers["x-source"] !== "omnidimension") {
      if (file.omnidimensionId) {
        const finalFileId = extractNumericId(file.omnidimensionId);

        // Validate that the ID is not too large for PostgreSQL integer
        const maxInt = 2147483647;
        const fileIdNum = parseInt(finalFileId, 10);

        if (isNaN(fileIdNum) || fileIdNum > maxInt) {
        } else {
          try {
            await syncToOmnidimension(
              "knowledge_base/delete",
              {
                file_id: fileIdNum, // Send as number, not string
              },
              "POST"
            );
          } catch (apiError) {
            // Continue with local deletion even if API fails
          }
        }
      } else {
      }
    } else {
    }

    // Delete from local storage
    if (fs.existsSync(file.storagePath)) {
      fs.unlinkSync(file.storagePath);
    }

    // Delete from local database
    const deletedFileId = file._id.toString();
    const deletedOmniId = file.omnidimensionId?.toString();
    await File.findByIdAndDelete(file._id);

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("file_deleted", {
        id: deletedFileId,
        omnidimensionId: deletedOmniId,
      });
    }

    res.json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Detach files from agent (POST /api/v1/knowledge_base/detach)
exports.detachFilesFromAgent = async (req, res) => {
  try {
    const userId = req.user.id;
    const { file_ids, agent_id } = req.body;

    if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "file_ids array is required",
      });
    }

    if (!agent_id) {
      return res.status(400).json({
        success: false,
        message: "agent_id is required",
      });
    }

    // Verify agent exists and belongs to user
    const agent = await VoiceAssistant.findOne({
      $or: [{ omnidimensionId: agent_id.toString() }, { _id: agent_id }],
      userId,
    });

    if (!agent) {
      // If agent not found in local DB but request came from Omni API
      // We should still return success to avoid sync issues
      if (req.headers["x-source"] === "omnidimension") {
        return res.json({
          success: true,
          message: "Detachment acknowledged (agent not in local DB)",
        });
      }

      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    // Find all files
    const files = await File.find({
      userId,
      $or: [
        { omnidimensionId: { $in: file_ids.map((id) => id.toString()) } },
        { _id: { $in: file_ids } },
      ],
    });

    if (files.length === 0) {
      // If files not found in local DB but request came from Omni API
      // We should still return success to avoid sync issues
      if (req.headers["x-source"] === "omnidimension") {
        return res.json({
          success: true,
          message: "Detachment acknowledged (files not in local DB)",
        });
      }

      return res.status(404).json({
        success: false,
        message: "No files found",
      });
    }

    // Detach from OMNIDIMENSION only if request didn't come from Omni
    // This prevents infinite sync loops
    if (req.headers["x-source"] !== "omnidimension") {
      // Get omnidimension IDs for API call (extract numeric IDs and convert to numbers)
      const maxInt = 2147483647;
      const fileOmniIds = files
        .map((f) => {
          const id = extractNumericId(f.omnidimensionId || f._id);
          const numId = parseInt(id, 10);
          if (isNaN(numId) || numId > maxInt) {
            console.error(`⚠️  File ID too large or invalid: ${id}`);
            return null;
          }
          return numId;
        })
        .filter((id) => id !== null);

      const agentOmniIdStr = extractNumericId(
        agent.omnidimensionId || agent._id
      );
      const agentOmniId = parseInt(agentOmniIdStr, 10);

      if (isNaN(agentOmniId) || agentOmniId > maxInt) {
      } else if (fileOmniIds.length === 0) {
      } else {
        try {
          await syncToOmnidimension(
            "knowledge_base/detach",
            {
              file_ids: fileOmniIds, // Send as array of numbers
              agent_id: agentOmniId, // Send as number
            },
            "POST"
          );
        } catch (apiError) {
          // Continue with local detachment even if API fails
        }
      }
    } else {
    }

    // Update local database - remove agent from attachedAgents
    const agentObjectId = agent._id;
    for (const file of files) {
      file.attachedAgents = file.attachedAgents.filter(
        (agentId) => !agentId.equals(agentObjectId)
      );
      file.lastSynced = new Date();
      file.syncStatus = "synced";
      await file.save();
    }

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("files_detached", {
        file_ids: files.map((f) => f._id.toString()),
        agent_id: agent._id.toString(),
      });
    }

    res.json({
      success: true,
      message: `Successfully detached ${files.length} file(s) from agent`,
      data: {
        files: files.map((f) => ({
          id: f._id,
          omnidimensionId: f.omnidimensionId,
          originalName: f.originalName,
        })),
        agent: {
          id: agent._id,
          name: agent.name,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Attach files to agent (POST /api/v1/knowledge_base/attach)
exports.attachFilesToAgent = async (req, res) => {
  try {
    const userId = req.user.id;
    const { file_ids, agent_id } = req.body;

    if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "file_ids array is required",
      });
    }

    if (!agent_id) {
      return res.status(400).json({
        success: false,
        message: "agent_id is required",
      });
    }

    // Verify agent exists and belongs to user
    const agent = await VoiceAssistant.findOne({
      $or: [{ omnidimensionId: agent_id.toString() }, { _id: agent_id }],
      userId,
    });

    if (!agent) {
      // If agent not found in local DB but request came from Omni API
      // We should still return success to avoid sync issues
      if (req.headers["x-source"] === "omnidimension") {
        return res.json({
          success: true,
          message: "Attachment acknowledged (agent not in local DB)",
        });
      }

      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    // Find all files
    const files = await File.find({
      userId,
      $or: [
        { omnidimensionId: { $in: file_ids.map((id) => id.toString()) } },
        { _id: { $in: file_ids } },
      ],
    });

    if (files.length === 0) {
      // If files not found in local DB but request came from Omni API
      // We should still return success to avoid sync issues
      if (req.headers["x-source"] === "omnidimension") {
        return res.json({
          success: true,
          message: "Attachment acknowledged (files not in local DB)",
        });
      }

      return res.status(404).json({
        success: false,
        message: "No files found",
      });
    }

    // Attach to OMNIDIMENSION only if request didn't come from Omni
    // This prevents infinite sync loops
    if (req.headers["x-source"] !== "omnidimension") {
      // Get omnidimension IDs for API call (extract numeric IDs and convert to numbers)
      const maxInt = 2147483647;
      const fileOmniIds = files
        .map((f) => {
          const id = extractNumericId(f.omnidimensionId || f._id);
          const numId = parseInt(id, 10);
          if (isNaN(numId) || numId > maxInt) {
            return null;
          }
          return numId;
        })
        .filter((id) => id !== null);

      const agentOmniIdStr = extractNumericId(
        agent.omnidimensionId || agent._id
      );
      const agentOmniId = parseInt(agentOmniIdStr, 10);

      if (isNaN(agentOmniId) || agentOmniId > maxInt) {
      } else if (fileOmniIds.length === 0) {
      } else {
        try {
          console.log(
            `📎 Attempting to attach files to agent in OMNIDIMENSION: agent_id=${agentOmniId}, file_ids=[${fileOmniIds.join(
              ", "
            )}]`
          );
          // Use the correct endpoint from Omni documentation
          await syncToOmnidimension(
            "knowledge_base/attach",
            {
              file_ids: fileOmniIds, // Send as array of numbers
              agent_id: agentOmniId, // Send as number
            },
            "POST"
          );
        } catch (apiError) {
          // Continue with local update even if API fails
        }
      }
    } else {
    }

    // Update local database - add agent to attachedAgents
    const agentObjectId = agent._id;
    for (const file of files) {
      const isAlreadyAttached = file.attachedAgents.some((agentId) =>
        agentId.equals(agentObjectId)
      );
      if (!isAlreadyAttached) {
        file.attachedAgents.push(agentObjectId);
      }
      file.lastSynced = new Date();
      file.syncStatus = "synced";
      await file.save();
    }

    // Update agent's knowledgeBaseFiles count
    agent.knowledgeBaseFiles = await File.countDocuments({
      userId,
      attachedAgents: agentObjectId,
    });
    await agent.save();

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("files_attached", {
        file_ids: files.map((f) => f._id.toString()),
        agent_id: agent._id.toString(),
      });
    }

    res.json({
      success: true,
      message: `Successfully attached ${files.length} file(s) to agent`,
      data: {
        files: files.map((f) => ({
          id: f._id,
          omnidimensionId: f.omnidimensionId,
          originalName: f.originalName,
        })),
        agent: {
          id: agent._id,
          name: agent.name,
          knowledgeBaseFiles: agent.knowledgeBaseFiles,
        },
      },
    });
  } catch (error) {
    console.error("Attach Files To Agent Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.syncFiles = async (req, res) => {
  try {
    const userId = req.user.id;
    let omniFiles = [];
    let apiError = null;

    // Fetch from OMNIDIMENSION using the correct endpoint
    try {
      const response = await fetchFromOmnidimension("knowledge_base/list");
      // Handle different response formats
      omniFiles = response?.files || response?.data || response || [];

      if (!Array.isArray(omniFiles)) {
        console.error(
          "Invalid response format from OMNIDIMENSION API:",
          response
        );
        apiError = "Invalid response format from OMNIDIMENSION API";
        omniFiles = []; // Reset to empty array
      }
    } catch (error) {
      console.error("Failed to fetch from OMNIDIMENSION:", error.message);
      apiError = error.message;
      // Continue with local files only
    }

    console.log(`📥 Received ${omniFiles.length} files from OMNIDIMENSION API`);

    // Sync local database
    const syncResult = await syncFromOmnidimension(omniFiles, userId);

    // Now sync local files to OMNIDIMENSION if they don't exist there
    // This ensures bidirectional sync
    const omniIds = omniFiles
      .map((file) => file.id?.toString())
      .filter(Boolean);

    // Find local files that don't have an omnidimensionId
    const localOnlyFiles = await File.find({
      userId,
      $or: [{ omnidimensionId: { $exists: false } }, { omnidimensionId: null }],
    });

    console.log(
      `📤 Found ${localOnlyFiles.length} local-only files to sync to OMNIDIMENSION`
    );

    let uploadedToOmni = 0;

    // Upload each local file to OMNIDIMENSION
    for (const localFile of localOnlyFiles) {
      try {
        if (fs.existsSync(localFile.storagePath)) {
          // Read file for upload
          const fileBuffer = fs.readFileSync(localFile.storagePath);

          // Upload to OMNIDIMENSION using the correct endpoint
          const omnidimensionResponse = await syncToOmnidimension(
            "knowledge_base/create",
            {
              file: fileBuffer.toString("base64"),
              filename: localFile.originalName,
            },
            "POST"
          );

          // Update local file with omnidimensionId
          if (omnidimensionResponse && omnidimensionResponse.id) {
            localFile.omnidimensionId = omnidimensionResponse.id.toString();
            localFile.syncedAt = new Date();
            localFile.lastSynced = new Date();
            localFile.syncStatus = "synced";
            await localFile.save();
            uploadedToOmni++;

            console.log(
              `✅ Successfully uploaded local file to OMNIDIMENSION: ${localFile.originalName}`
            );
          }
        }
      } catch (error) {
        console.error(
          `❌ Failed to upload local file to OMNIDIMENSION: ${localFile.originalName}`,
          error.message
        );
      }
    }

    res.json({
      success: true,
      message: apiError
        ? `Partial sync completed with API errors: ${apiError}. Synced ${syncResult.syncedCount} files from Omni and uploaded ${uploadedToOmni} local files to Omni.`
        : `Successfully synced ${syncResult.syncedCount} files from Omni and uploaded ${uploadedToOmni} local files to Omni`,
      syncResult: {
        ...syncResult,
        uploadedToOmni,
        apiError: apiError || null,
        partialSync: !!apiError,
      },
    });
  } catch (error) {
    console.error("Sync Files Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to sync with OMNIDIMENSION",
      error: error.message,
    });
  }
};
