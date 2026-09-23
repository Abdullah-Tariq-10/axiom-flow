import { EventSchemas, Inngest } from "inngest";
import type { WorkflowRunEvent } from "../types";

type Events = {
  "workflow/run": WorkflowRunEvent;
};

export const inngest = new Inngest({
  id: "ai-workflow-builder",
  schemas: new EventSchemas().fromRecord<Events>(),
});