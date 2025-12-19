/**
 * Test fixtures and constants for effect-next testing.
 *
 * @module testing-kit/_fixtures
 */

/**
 * Standard tag for test handlers.
 */
export const TEST_HANDLER_TAG = "TestHandler";

/**
 * Standard identifier for test middleware.
 */
export const TEST_MIDDLEWARE_ID = "TestMiddleware";

/**
 * Mock user ID for testing.
 */
export const MOCK_USER_ID = "test-user-123";

/**
 * Mock request headers for testing.
 */
export const MOCK_REQUEST_HEADERS = {
  authorization: "Bearer test-token",
  "content-type": "application/json",
  "user-agent": "test-agent",
} as const;

/**
 * Mock cookies for testing.
 */
export const MOCK_COOKIES = {
  sessionId: "test-session-123",
  theme: "dark",
} as const;

/**
 * Mock search params for testing.
 */
export const MOCK_SEARCH_PARAMS = {
  limit: "10",
  page: "1",
  sort: "desc",
} as const;

/**
 * Mock route params for testing.
 */
export const MOCK_ROUTE_PARAMS = {
  id: "test-id-123",
  slug: "test-slug",
} as const;

export const TEST_ROUTE_PARAMS = { id: "123", slug: "test-post" };
export const TEST_SEARCH_PARAMS = { limit: "10", page: "1" };
export const TEST_HEADER_VALUE = "test-header-value";
export const TEST_COOKIE_VALUE = "test-cookie-value";
