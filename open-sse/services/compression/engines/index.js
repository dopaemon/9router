// Register all 12 built-in compression engines
// Matches https://github.com/cheaper-inference/OmniRoute

import { registerCompressionEngine, getCompressionEngine } from "./registry.js";

import { sessionDedupEngine } from "./session-dedup/index.js";
import { ccrEngine } from "./ccr/index.js";
import { liteEngine } from "./lite/index.js";
import { rtkEngine } from "./rtk/index.js";
import { codexResponsesEngine } from "./codexResponses/index.js";
import { headroomEngine } from "./headroom/index.js";
import { relevanceEngine } from "./relevance/index.js";
import { cavemanEngine } from "./caveman/index.js";
import { aggressiveEngine } from "./aggressive/index.js";
import { llmlinguaEngine } from "./llmlingua/index.js";
import { ultraEngine } from "./ultra/index.js";
import { omniglyphEngine } from "./omniglyph/index.js";

let registered = false;

export function registerBuiltinCompressionEngines() {
  if (registered && getCompressionEngine("lite")) return;
  registered = true;

  const engines = [
    sessionDedupEngine,
    ccrEngine,
    liteEngine,
    rtkEngine,
    codexResponsesEngine,
    headroomEngine,
    relevanceEngine,
    cavemanEngine,
    aggressiveEngine,
    llmlinguaEngine,
    ultraEngine,
    omniglyphEngine,
  ];

  for (const engine of engines) {
    if (!getCompressionEngine(engine.id)) {
      registerCompressionEngine(engine);
    }
  }
}

// Auto-register on import
registerBuiltinCompressionEngines();
