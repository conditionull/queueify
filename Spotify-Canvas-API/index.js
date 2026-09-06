import express from 'express';
import axios from 'axios';
import canvasRoutes from './routes/canvasRoutes.js';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
const app = express();
app.use('/api/canvas', canvasRoutes);

function startCanvasApi() {
  const configured = Number(process.env.QUEUEIFY_CANVAS_PORT);
  const PORT = Number.isInteger(configured) && configured >= 0 ? configured : 3000;

  // Resolves once it is actually listening, and reports a taken port as an
  // error the caller can explain rather than crashing here.
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT);

    server.once('listening', () => {
      const address = server.address();
      console.log(`Canvas API running on http://localhost:${address ? address.port : PORT}`);
      resolve(server);
    });

    server.once('error', err => {
      if (err.code === 'EADDRINUSE') err.port = PORT;
      reject(err);
    });
  });
}

export default startCanvasApi;