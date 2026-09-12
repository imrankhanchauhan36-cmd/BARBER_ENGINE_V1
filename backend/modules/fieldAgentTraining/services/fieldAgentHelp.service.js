/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/services/fieldAgentHelp.service.js
 *
 * FA-3.3 — Field Agent Help: fast operational reference, NOT a second
 * copy of the training curriculum. Reuses the same TrainingContent
 * store (approved plan requirement) but is deliberately narrow:
 *
 *   - Only content where helpEligible:true.
 *   - Only from modules in HELP_ELIGIBLE_MODULE_KEYS (approved launch
 *     scope: onboarding, booking ops, KYC/finance, troubleshooting,
 *     compliance).
 *   - Only LESSON/REFERENCE contentType — KNOWLEDGE_CHECK and
 *     PRACTICAL_SCENARIO are structurally excluded here, independent
 *     of the helpEligible flag, so an authoring mistake (flagging a
 *     graded item helpEligible) can never leak a rubric/answer key
 *     through Help. `grading` is select:false by default and is never
 *     requested by this query either way — defense in depth.
 *   - Only from the currently PUBLISHED version — Help always
 *     reflects the live curriculum, never a draft or retired one.
 */

import TrainingVersion from "../models/TrainingVersion.js";
import TrainingModule from "../models/TrainingModule.js";
import TrainingContent from "../models/TrainingContent.js";
import { Errors } from "../../../utils/response.js";
import {
  TRAINING_VERSION_STATUS,
  HELP_ELIGIBLE_MODULE_KEYS,
  CONTENT_TYPE,
} from "../constants/fieldAgentTraining.constants.js";
import { resolveTranslation } from "./fieldAgentTraining.service.js";

export const getHelpContent = async (languageCode) => {
  const version = await TrainingVersion.findOne({ status: TRAINING_VERSION_STATUS.PUBLISHED }).lean();
  if (!version) throw Errors.notFound("No published training content is currently available");

  const modules = await TrainingModule.find({
    trainingVersion: version._id,
    moduleKey: { $in: HELP_ELIGIBLE_MODULE_KEYS },
  })
    .sort({ order: 1 })
    .lean();

  const moduleIds = modules.map((m) => m._id);

  const items = await TrainingContent.find({
    trainingModule: { $in: moduleIds },
    helpEligible: true,
    contentType: { $in: [CONTENT_TYPE.LESSON, CONTENT_TYPE.REFERENCE] },
  })
    .sort({ order: 1 })
    .lean();

  const itemsByModule = new Map();
  for (const item of items) {
    const key = String(item.trainingModule);
    if (!itemsByModule.has(key)) itemsByModule.set(key, []);
    itemsByModule.get(key).push(item);
  }

  return modules
    .map((m) => {
      const moduleTranslation = resolveTranslation(m.translations, languageCode);
      const shapedItems = (itemsByModule.get(String(m._id)) ?? []).map((item) => {
        const translation = resolveTranslation(item.translations, languageCode);
        return { title: translation?.title ?? null, body: translation?.body ?? null };
      });
      return {
        moduleKey: m.moduleKey,
        title: moduleTranslation?.title ?? m.moduleKey,
        items: shapedItems,
      };
    })
    .filter((m) => m.items.length > 0);
};
