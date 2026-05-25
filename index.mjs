let cachedFeatureFlags = {};
let nextPollTime = 0;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));


export const handler = async () => {
  const lambdaStart = performance.now();

  const featureFlags = await getFeatureFlags();

  console.log(
    "Feature Flags:",
    JSON.stringify(featureFlags, null, 2)
  );

  if (featureFlags.enable_dynamodb?.enabled) {
    console.log("DynamoDB ENABLED");
  } else {
    console.log("DynamoDB DISABLED");
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

const fetchFeatureFlags = async () => {
  const response = await fetch(
    "http://localhost:2772/applications/ecom/environments/dev/configurations/ecom-user-service",
    {
      method: "GET",
      headers: {},
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch AppConfig: ${response.status}`
    );
  }

  return response.json();
};

const getFeatureFlags = async () => {
  const totalStart = performance.now();

  try {
    const now = Date.now();

    /**
     * Return local cache
     */
    if (now < nextPollTime) {
      console.log(
        `Using local cached config. Next poll at ${new Date(
          nextPollTime
        ).toISOString()}`
      );

      return cachedFeatureFlags;
    }

    let featureFlags;

    /**
     * Retry 3 times
     */
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const retryStart = performance.now();

        console.log(
          `Fetching AppConfig. Attempt ${attempt}`
        );

        featureFlags = await fetchFeatureFlags();

        console.log(
          `Attempt ${attempt} succeeded in ${
            performance.now() - retryStart
          } ms`
        );

        break;
      } catch (error) {
        console.error(
          `Attempt ${attempt} failed`,
          error
        );

        /**
         * Last retry failed
         */
        if (attempt === 3) {
          throw error;
        }

        /**
         * Small retry delay
         */
        await sleep(500 * attempt);
      }
    }

    /**
     * Update local cache
     */
    cachedFeatureFlags = featureFlags;

    /**
     * Local in-memory cache
     */
    nextPollTime = now + 30 * 1000;

    console.log(
      `Total AppConfig flow took ${
        performance.now() - totalStart
      } ms`
    );

    return cachedFeatureFlags;
  } catch (error) {
    console.error(
      "AppConfig Extension Error:",
      error
    );

    console.log(
      "Returning cached feature flags"
    );

    /**
     * Fallback to cache
     */
    return cachedFeatureFlags;
  }
};
