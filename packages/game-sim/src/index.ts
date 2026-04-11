import express from 'express';
import router from './routes';

const PORT = process.env.SIM_PORT ? parseInt(process.env.SIM_PORT, 10) : 3002;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(router);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`game-sim listening on http://127.0.0.1:${PORT}`);
});
