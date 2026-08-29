/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/adminQueueConfig.controller.js
 *
 * Phase H Step 8 (Step 3) — Support Configuration Management: Queues.
 * Thin controllers, same layering as adminTeamConfig.controller.js/
 * adminCategoryConfig.controller.js.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createQueue,
  listQueuesForAdmin,
  updateQueue,
  updateQueueStatus,
} from "../services/supportQueueConfig.service.js";

export const createQueueHandler = async (req, res, next) => {
  try {
    const queue = await createQueue({
      queueCode: req.body.queueCode,
      name: req.body.name,
      description: req.body.description,
      categoryRefs: req.body.categoryRefs,
      ownerTeamRef: req.body.ownerTeamRef,
      maxConcurrentTickets: req.body.maxConcurrentTickets,
      actorId: req.user._id,
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Queue created successfully",
      data: { queue },
    });
  } catch (err) {
    return next(err);
  }
};

export const listQueuesForAdminHandler = async (req, res, next) => {
  try {
    const queues = await listQueuesForAdmin();

    return successResponse(res, {
      message: "Queues fetched successfully",
      data: { queues },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateQueueHandler = async (req, res, next) => {
  try {
    const queue = await updateQueue(req.params.id, req.body, req.user._id);

    return successResponse(res, {
      message: "Queue updated successfully",
      data: { queue },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateQueueStatusHandler = async (req, res, next) => {
  try {
    const queue = await updateQueueStatus(req.params.id, req.body.isActive, req.user._id);

    return successResponse(res, {
      message: "Queue status updated successfully",
      data: { queue },
    });
  } catch (err) {
    return next(err);
  }
};
