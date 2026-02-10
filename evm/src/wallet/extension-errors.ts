const METAMASK_EXTENSION_ID = "nkbihfbeogaeaoehlefnkodbefgpgknn";
const CHROME_EXTENSION_STACK_PATTERN = /chrome-extension:\/\//i;
const METAMASK_CONNECTION_MESSAGE_PATTERN = /failed to connect to metamask/i;
const DEFAULT_METAMASK_CONNECTION_MESSAGE = "Failed to connect to MetaMask";

/** Typed detail payload describing a wallet extension bridge failure. */
export type WalletExtensionErrorDetail = {
  readonly kind: "metamask-connection";
  readonly message: string;
};

type ErrorLike = {
  message?: unknown;
  stack?: unknown;
};

function getReasonMessage(reason: unknown): string | null {
  if (typeof reason === "string") {
    return reason;
  }
  if (!reason || typeof reason !== "object") {
    return null;
  }
  const { message } = reason as ErrorLike;
  return typeof message === "string" ? message : null;
}

function getReasonStack(reason: unknown): string | null {
  if (!reason || typeof reason !== "object") {
    return null;
  }
  const { stack } = reason as ErrorLike;
  return typeof stack === "string" ? stack : null;
}

/**
 * Detect whether an error originates from a broken MetaMask extension bridge.
 *
 * Matches errors whose message contains "failed to connect to metamask" **and**
 * whose stack trace references the MetaMask Chrome extension ID or a
 * `chrome-extension://` URL.
 */
export function isMetaMaskExtensionConnectionError(reason: unknown): boolean {
  const message = getReasonMessage(reason);
  if (!message || !METAMASK_CONNECTION_MESSAGE_PATTERN.test(message)) {
    return false;
  }
  const stack = getReasonStack(reason);
  if (!stack) {
    return false;
  }
  const lowerStack = stack.toLowerCase();
  return lowerStack.includes(METAMASK_EXTENSION_ID) || CHROME_EXTENSION_STACK_PATTERN.test(stack);
}

/**
 * Build a {@link WalletExtensionErrorDetail} if the given reason is a
 * recognised wallet extension error, or return `null` otherwise.
 */
export function getWalletExtensionErrorDetail(reason: unknown): WalletExtensionErrorDetail | null {
  if (!isMetaMaskExtensionConnectionError(reason)) {
    return null;
  }
  return {
    kind: "metamask-connection",
    message: getReasonMessage(reason) ?? DEFAULT_METAMASK_CONNECTION_MESSAGE,
  };
}

/** Type guard for {@link WalletExtensionErrorDetail}. */
export function isWalletExtensionErrorDetail(
  detail: unknown
): detail is WalletExtensionErrorDetail {
  if (!detail || typeof detail !== "object") {
    return false;
  }
  const { kind, message } = detail as Partial<WalletExtensionErrorDetail>;
  return kind === "metamask-connection" && typeof message === "string";
}
