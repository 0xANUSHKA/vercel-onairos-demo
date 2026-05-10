declare module "onairos" {
  import * as React from "react";

  export type OnairosEnvironment = "production" | "staging" | "development";

  export function initializeApiKey(config: {
    apiKey: string;
    environment?: OnairosEnvironment;
    enableLogging?: boolean;
    platform?: string;
    importBridgeUrl?: string;
    timeout?: number;
    retryAttempts?: number;
  }): Promise<void>;

  export const OnairosButton: React.ComponentType<{
    webpageName: string;
    testMode?: boolean;
    autoFetch?: boolean;
    requestData?: unknown;
    preferencesMbti?: boolean;
    allowedPlatforms?: string[];
    rawMemoriesOnly?: boolean;
    googleClientId?: string;
    inferenceData?: unknown;
    onComplete?: (result: unknown) => void | Promise<void>;
  }>;
}
