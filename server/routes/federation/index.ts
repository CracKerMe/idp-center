import express from 'express';
import samlRouter from './saml.js';
import oidcRpRouter from './oidc-rp.js';
import ldapRouter from './ldap.js';

const router = express.Router();

router.use(samlRouter);
router.use(oidcRpRouter);
router.use(ldapRouter);

export default router;
