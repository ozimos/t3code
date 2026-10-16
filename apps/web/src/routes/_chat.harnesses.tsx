import { createFileRoute } from "@tanstack/react-router";

import { HarnessesPage } from "../components/harnesses/HarnessesPage";

export const Route = createFileRoute("/_chat/harnesses")({
  component: HarnessesPage,
});
