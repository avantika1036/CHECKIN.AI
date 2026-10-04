import { Router, type IRouter } from "express";
import healthRouter from "./health";
import visitorWorkflowRouter from "./visitor-workflow";
import agentToolsRouter from "./agent-tools";

const router: IRouter = Router();

router.use(healthRouter);
router.use(visitorWorkflowRouter);
router.use(agentToolsRouter);

export default router;
