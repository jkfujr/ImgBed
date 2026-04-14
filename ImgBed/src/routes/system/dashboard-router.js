import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';
import { success } from '../../utils/response.js';

function createSystemDashboardRouter({
  dashboardOverviewCache,
  dashboardUploadTrendCache,
  dashboardAccessStatsCache,
  dashboardService,
} = {}) {
  const router = express.Router();

  router.get('/dashboard/overview', dashboardOverviewCache(), asyncHandler(async (_req, res) => {
    return res.json(success(dashboardService.getOverview()));
  }));

  router.get('/dashboard/upload-trend', dashboardUploadTrendCache(), asyncHandler(async (req, res) => {
    return res.json(success(dashboardService.getUploadTrend(req.query.days)));
  }));

  router.get('/dashboard/access-stats', dashboardAccessStatsCache(), asyncHandler(async (_req, res) => {
    return res.json(success(dashboardService.getAccessStats()));
  }));

  return router;
}

export { createSystemDashboardRouter };
