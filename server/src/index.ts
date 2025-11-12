import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import analyzeRouter from './routes/analyze';
import chatRouter from './routes/chat';
import conversationsRouter from './routes/conversations';
import { initMongo } from './services/mongo';

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[SERVER] ${req.method} ${req.originalUrl} received`, req.body ?? {});
  next();
});

app.get('/health', (_req, res) => {
  console.log('[SERVER] GET /health responded with ok');
  res.json({ ok: true });
});

app.use('/api/analyze', analyzeRouter);
app.use('/api/chat', chatRouter);
app.use('/api/conversations', conversationsRouter);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' }
});

io.on('connection', socket => {
  console.log('[SERVER] WebSocket client connected:', socket.id);
  socket.emit('connected', { msg: 'WebSocket connected' });

  socket.on('disconnect', reason => {
    console.log('[SERVER] WebSocket client disconnected:', socket.id, reason);
  });
});

async function start() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/market-copilot';
  try {
    await initMongo(mongoUri);
  } catch (error) {
    console.error('[SERVER] Failed to connect to MongoDB', error);
    process.exit(1);
  }

  httpServer.listen(PORT, () => {
    console.log(`[SERVER] API listening on :${PORT}`);
  });
}

start().catch(error => {
  console.error('[SERVER] Uncaught bootstrap error', error);
  process.exit(1);
});

export { io };
