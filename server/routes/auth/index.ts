import express from 'express';
import registerRouter from './register.js';
import loginRouter from './login.js';
import mfaRouter from './mfa.js';
import sessionRouter from './session.js';
import passwordRouter from './password.js';
import emailRouter from './email.js';
import federationRouter from './federation.js';
import captchaRouter from './captcha.js';

const router = express.Router();

router.use('/', registerRouter);
router.use('/', loginRouter);
router.use('/', mfaRouter);
router.use('/', sessionRouter);
router.use('/', passwordRouter);
router.use('/', emailRouter);
router.use('/', federationRouter);
router.use('/', captchaRouter);

export default router;
