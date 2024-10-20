import express from 'express';
import { checkNotLogin, validateDataTablesRequest, validateUrl, validateIsMongoID, validateJwtHeader } from '../middlewares/validator';
import { jwtAuthMiddleware } from '../middlewares/jwtAuthMiddleware';
import { deleteOne, getMore, addlink } from '../controllers/Download';

const router = express.Router();

router.get('/', validateDataTablesRequest, getMore);
router.delete('/', validateJwtHeader, jwtAuthMiddleware, validateIsMongoID, deleteOne);
router.post('/', validateUrl, checkNotLogin, addlink);

export default router;