
import {
  AppConfigDataClient,
  StartConfigurationSessionCommand,
  GetLatestConfigurationCommand,
} from "@aws-sdk/client-appconfigdata";

const appConfigClient = new AppConfigDataClient({
  region: process.env.AWS_REGION || "ap-south-1",
});

/**
 * Cached globally in Lambda container memory
 * Reused across warm invocations
 */
let configurationToken;
let cachedFeatureFlags = {};
let nextPollTime = 0;

const getFeatureFlags = async () => {
  const totalStart = performance.now();

  try {
    const now = Date.now();

    /**
     * If poll interval not reached,
     * return cached config immediately
     */
    if (now < nextPollTime) {
      console.log(
        `Using local cached feature flags. Next poll after ${new Date(
          nextPollTime
        ).toISOString()}`
      );

      return cachedFeatureFlags;
    }

    /**
     * Create AppConfig session only once
     * per Lambda container lifecycle
     */
    if (!configurationToken) {
      const sessionStart = performance.now();

      console.log("Creating AppConfig session");

      const sessionCommand = new StartConfigurationSessionCommand({
        ApplicationIdentifier: "ecom",
        EnvironmentIdentifier: "dev",
        ConfigurationProfileIdentifier: "ecom-user-service",
      });

      const sessionResponse = await appConfigClient.send(sessionCommand);

      configurationToken =
        sessionResponse.InitialConfigurationToken;

      console.log(
        `StartConfigurationSessionCommand took ${
          performance.now() - sessionStart
        } ms`
      );

      console.log(
        "InitialConfigurationToken received"
      );
    }

    /**
     * Fetch latest config
     */
    const configStart = performance.now();

    const configCommand = new GetLatestConfigurationCommand({
      ConfigurationToken: configurationToken,
    });

    const configResponse = await appConfigClient.send(
      configCommand
    );

    console.log(
      `GetLatestConfigurationCommand took ${
        performance.now() - configStart
      } ms`
    );

    /**
     * Store latest token for next poll
     */
    configurationToken =
      configResponse.NextPollConfigurationToken;

    /**
     * AppConfig tells when next poll should happen
     */
    const pollInterval =
      configResponse.NextPollIntervalInSeconds || 60;

    nextPollTime = now + pollInterval * 1000;

    console.log(
      `Next poll after ${pollInterval} seconds`
    );

    /**
     * Convert Uint8Array → string
     */
    const configString = Buffer.from(
      configResponse.Configuration || new Uint8Array()
    ).toString("utf-8");

    /**
     * IMPORTANT:
     * AppConfig returns EMPTY payload
     * if config did NOT change
     */
    if (configString) {
      cachedFeatureFlags = JSON.parse(configString);

      console.log(
        "Feature flags updated from AppConfig"
      );
    } else {
      console.log(
        "No config changes. Using cached feature flags"
      );
    }

    console.log(
      `Total AppConfig flow took ${
        performance.now() - totalStart
      } ms`
    );

    return cachedFeatureFlags;
  } catch (error) {
    console.error("Error fetching AppConfig:", error);

    /**
     * Fallback to cached config
     * even if AppConfig fails
     */
    console.log(
      "Returning cached feature flags due to AppConfig failure"
    );

    return cachedFeatureFlags;
  }
};

export const handler = async () => {
  const lambdaStart = performance.now();

  const featureFlags = await getFeatureFlags();

  console.log(
    "Current Feature Flags:",
    JSON.stringify(featureFlags, null, 2)
  );

  /**
   * Example flag usage
   */
  if (featureFlags.enable_dynamodb?.enabled) {
    console.log("DynamoDB feature ENABLED");
  } else {
    console.log("DynamoDB feature DISABLED");
  }

  console.log(
    `Total Lambda execution took ${
      performance.now() - lambdaStart
    } ms`
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      featureFlags,
    }),
  };
};
