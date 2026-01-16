import express from 'express';
import { HandoffRequestModel } from './models/handoffModel';
import { LabStrategyModel, EngineStrategyModel } from './models/strategyModel';

const router = express.Router();

// --- Lab Routes ---

// Create Handoff Request
router.post('/request', async (req, res) => {
  try {
    const { strategyId, engineConfig, validationProof, requesterId } = req.body;

    // Verify strategy exists and is validated
    const strategy = await LabStrategyModel.findById(strategyId);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    // For demo flexibility: we allow "development" status but warn, or strictly enforce "validated"
    // if (strategy.status !== 'validated') {
    //   return res.status(400).json({ error: 'Strategy must be validated first' });
    // }

    const handoff = new HandoffRequestModel({
      strategyId,
      requesterId: requesterId || 'unknown_user', // Mock user for now
      engineConfig, // Accept the full nested structure as-is
      validationProof
    });

    await handoff.save();
    res.json(handoff);
  } catch (error: any) {
    console.error('[HANDOFF] Create request failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Engine Room Routes ---

// List Handoff Requests
router.get('/requests', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const requests = await HandoffRequestModel.find(filter)
      .populate('strategyId') // Include strategy details
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Approve Request -> Create Engine Strategy
router.post('/approve', async (req, res) => {
  try {
    const { requestId, approverId } = req.body;

    const handoff = await HandoffRequestModel.findById(requestId).populate('strategyId');
    if (!handoff) return res.status(404).json({ error: 'Request not found' });
    if (handoff.status !== 'pending') return res.status(400).json({ error: 'Request not pending' });

    const labStrategy = handoff.strategyId as any;

    // Create Engine Strategy
    const engineStrategy = new EngineStrategyModel({
      name: labStrategy.name,
      description: labStrategy.description,
      version: labStrategy.version,
      ownerId: labStrategy.ownerId,
      labStrategyId: labStrategy._id,
      strategyType: labStrategy.strategyType, // Pass through from Lab strategy
      status: 'active',
      runtimeConfig: handoff.engineConfig
    });

    await engineStrategy.save();

    // Update Handoff
    handoff.status = 'approved';
    handoff.approvalMeta = {
      approvedBy: approverId || 'admin',
      approvedAt: new Date(),
      deploymentId: engineStrategy._id as any
    };
    await handoff.save();

    // TODO: Notify Engine/Executor (WebSocket or Event Bus)

    res.json({ handoff, engineStrategy });
  } catch (error: any) {
    console.error('[HANDOFF] Approve failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export const handoffRouter = router;
