import createOpenAIEmbeddingAdapter from "./openai.js";
import { GITHUB_COPILOT } from "../../config/appConstants.js";

const baseAdapter = createOpenAIEmbeddingAdapter("github");

export default {
  ...baseAdapter,
  buildHeaders: (credentials) => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${credentials.copilotToken || credentials.providerSpecificData?.copilotToken || credentials.accessToken}`,
    "copilot-integration-id": "vscode-chat",
    "editor-version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
    "editor-plugin-version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
    "user-agent": GITHUB_COPILOT.USER_AGENT,
    "x-github-api-version": GITHUB_COPILOT.API_VERSION,
  }),
};
