import express from 'express';
import axios from 'axios';
import canvasRoutes from './routes/canvasRoutes.js';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use('/api/canvas', canvasRoutes);

function startCanvasApi() {
  const PORT = 3000;

  app.listen(PORT, () => {
    console.log(`Canvas API running on http://localhost:${PORT}`);
  });
}

export default startCanvasApi;