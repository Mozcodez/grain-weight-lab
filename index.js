import express from 'express';
import app from './server/app.js';

const vercelApp = express();
vercelApp.use(app);

export default vercelApp;
