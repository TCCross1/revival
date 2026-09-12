/**
 * @typedef {Object} JobDeposit
 * @property {string} id
 * @property {string} job_id
 * @property {number} amount
 * @property {number} net_amount
 * @property {string} square_payment_id
 * @property {string} payment_method
 * @property {"pending"|"received"|"failed"|"refunded"} status
 * @property {string} created_at
 * @property {string} received_at
 * @property {string} folder_transfer_id
 * @property {string} notes
 * @property {string} receipt_url
 * @property {string} checkout_url
 * @property {string} error_message
 */

/**
 * @typedef {Object} JobFunds
 * @property {string} job_id
 * @property {string} folder_id
 * @property {string} folder_name
 * @property {string} folder_link_status
 * @property {number} folder_balance
 * @property {number} total_deposits
 * @property {number} total_spent
 * @property {number} remaining_available
 * @property {number} remaining_on_contract
 * @property {number} suggested_deposit
 * @property {JobDeposit[]} deposits
 */

export function hasNativeSquareReader() {
  try {
    return Boolean(window.webkit?.messageHandlers?.squareReader);
  } catch {
    return false;
  }
}

export function requestNativeSquareReader(payload) {
  window.webkit.messageHandlers.squareReader.postMessage(payload);
}

export function depositStatusLabel(status) {
  return ({ pending: "Pending", received: "Received", failed: "Failed", refunded: "Refunded" }[status] || status);
}

export function folderStatusLabel(status) {
  return ({
    linked: "Linked",
    pending_create: "Waiting on Square",
    unlinked: "Not linked",
  }[status] || status || "Not linked");
}
