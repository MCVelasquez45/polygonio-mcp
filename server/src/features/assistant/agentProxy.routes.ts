import axios from 'axios';
import { Router, type RequestHandler } from 'express';

const router = Router();
const AGENT_URL = (process.env.AGENT_API_URL || process.env.FASTAPI_URL || process.env.PYTHON_URL || 'http://localhost:5001').replace(
  /\/+$/,
  ''
);
const AGENT_PROXY_TIMEOUT_MS = Number(process.env.AGENT_PROXY_TIMEOUT_MS ?? 120_000);

function agentEndpoint(path: string): string {
  return `${AGENT_URL}${path}`;
}

function forwardPost(path: string): RequestHandler {
  return async (req, res, next) => {
    try {
      const response = await axios.post(agentEndpoint(path), req.body, {
        timeout: AGENT_PROXY_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });
      res.status(response.status).json(response.data);
    } catch (error) {
      next(error);
    }
  };
}

function forwardGet(path: string): RequestHandler {
  return async (_req, res, next) => {
    try {
      const response = await axios.get(agentEndpoint(path), {
        timeout: AGENT_PROXY_TIMEOUT_MS,
        validateStatus: () => true,
      });
      res.status(response.status).json(response.data);
    } catch (error) {
      next(error);
    }
  };
}

router.post('/extract-strategy-async', forwardPost('/extract-strategy-async'));
router.post('/extract-strategy', forwardPost('/extract-strategy'));
router.post('/transcribe-audio', forwardPost('/transcribe-audio'));
router.post('/sift/extract', forwardPost('/sift/extract'));
router.post('/sift/extract-template', forwardPost('/sift/extract-template'));
router.get('/sift/templates', forwardGet('/sift/templates'));
router.get('/sift/providers', forwardGet('/sift/providers'));

export default router;
