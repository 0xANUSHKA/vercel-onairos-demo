import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  DEFAULT_MODEL,
  InyoOnboardingAgent,
  type OnairosData,
} from "../lib/inyo-onboarding-agent";

type CliArgs = {
  gender: "female" | "male";
  model: string;
  onairosPath: string | null;
  withOnairos: boolean | null;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    gender: "female",
    model: DEFAULT_MODEL,
    onairosPath: null,
    withOnairos: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--gender" && argv[i + 1]) {
      const value = argv[i + 1];
      if (value === "female" || value === "male") args.gender = value;
      else throw new Error("--gender must be 'female' or 'male'");
      i += 1;
      continue;
    }
    if (arg === "--model" && argv[i + 1]) {
      args.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--onairos" && argv[i + 1]) {
      args.onairosPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--with-onairos") {
      args.withOnairos = true;
      continue;
    }
    if (arg === "--no-onairos") {
      args.withOnairos = false;
      continue;
    }
  }

  return args;
}

async function loadOnairosPayload(path: string | null): Promise<OnairosData | null> {
  if (!path) return null;
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as OnairosData;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const onairosData = await loadOnairosPayload(args.onairosPath);

  const agent = new InyoOnboardingAgent({
    gender: args.gender,
    onairosData,
    withOnairos: args.withOnairos,
    model: args.model,
  });

  const modeLabel = agent.withOnairos ? "ONAIROS-PERSONALIZED" : "NO-ONAIROS";
  console.log(`[mode=${modeLabel}  model=${agent.model}  gender=${args.gender}]`);
  console.log("Type your replies in terminal. Press Ctrl+C to stop.\n");

  const rl = createInterface({ input, output });
  try {
    const opener = await agent.start();
    console.log(`Andy: ${opener}\n`);

    while (!agent.isComplete) {
      const userInput = (await rl.question("You: ")).trim();
      if (!userInput) continue;
      const reply = await agent.chat(userInput);
      console.log(`\nAndy: ${reply}\n`);
    }

    console.log("[onboarding complete]");
  } finally {
    rl.close();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
