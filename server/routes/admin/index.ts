import express from 'express';
import usersRouter from './users.js';
import clientsRouter from './clients.js';
import auditRouter from './audit.js';
import statsRouter from './stats.js';
import tenantsRouter from './tenants.js';
import sessionsRouter from './sessions.js';
import idpsRouter from './idps.js';
import riskRouter from './risk.js';
import aiRouter from './ai.js';

const router = express.Router();

router.use('/', usersRouter);
router.use('/', clientsRouter);
router.use('/', auditRouter);
router.use('/', statsRouter);
router.use('/', tenantsRouter);
router.use('/', sessionsRouter);
router.use('/', idpsRouter);
router.use('/', riskRouter);
router.use('/', aiRouter);

export default router;
