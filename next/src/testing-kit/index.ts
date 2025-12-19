/**
 * Testing utilities for effect-next applications.
 *
 * @module testing-kit
 */

export {
  MOCK_COOKIES,
  MOCK_REQUEST_HEADERS,
  MOCK_ROUTE_PARAMS,
  MOCK_SEARCH_PARAMS,
  MOCK_USER_ID,
  TEST_HANDLER_TAG,
  TEST_MIDDLEWARE_ID,
} from "./_fixtures/index.js";
export {
  assertLeft,
  assertRight,
  expectDefect,
  expectTaggedFailure,
  makeMockRuntime,
  runExpectFailure,
  runExpectSuccess,
} from "./helpers.js";
