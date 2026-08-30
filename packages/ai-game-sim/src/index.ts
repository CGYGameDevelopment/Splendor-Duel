import express from 'express';
import router from './routes';

const PORT = process.env.SIM_PORT ? parseInt(process.env.SIM_PORT, 10) : 3002;

const app = express();
// Batch endpoints carry a full GameState (~12 KB) per item and SimClient sends
// up to 64 per request, so the body can reach ~1 MB.
app.use(express.json({ limit: '16mb' }));
app.use(router);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`game-sim listening on http://127.0.0.1:${PORT}`);
});
