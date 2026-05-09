// utils/sheets.js — Google Sheets API helper using a service account.
//
// Setup:
//   1. Create a Google Cloud service account and download its JSON key.
//   2. Share your spreadsheet with the service account email (Editor access).
//   3. Set GOOGLE_SERVICE_ACCOUNT_JSON in .env to the full JSON string.
//      (Paste the entire contents of the downloaded .json file as one line.)
//
// All functions return null (reads) or false (writes) on auth/API failure
// rather than throwing, so callers can degrade gracefully.

const { google } = require('googleapis');

let _auth = null;

function _getAuth() {
  if (_auth) return _auth;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn('[sheets] GOOGLE_SERVICE_ACCOUNT_JSON not set');
    return null;
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (err) {
    console.error('[sheets] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', err.message);
    return null;
  }

  _auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return _auth;
}

function _sheets() {
  const auth = _getAuth();
  if (!auth) return null;
  return google.sheets({ version: 'v4', auth });
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read a range from a sheet. Returns a 2D array of strings, or null on error.
 * range examples: "Sheet1!A1:Z100"  "Vertical!A:Z"  "Sheet1"
 */
async function readRange(spreadsheetId, range) {
  const api = _sheets();
  if (!api) return null;
  try {
    const res = await api.spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values || [];
  } catch (err) {
    console.error(`[sheets] readRange(${range}):`, err.message);
    return null;
  }
}

/**
 * Returns an array of { title, sheetId } for all tabs in the spreadsheet.
 */
async function listSheets(spreadsheetId) {
  const api = _sheets();
  if (!api) return null;
  try {
    const res = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
    return (res.data.sheets || []).map(s => ({
      title:   s.properties.title,
      sheetId: s.properties.sheetId,
    }));
  } catch (err) {
    console.error('[sheets] listSheets:', err.message);
    return null;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Write values to a range (overwrites). values = 2D array of strings/numbers.
 * Returns true on success, false on failure.
 */
async function writeRange(spreadsheetId, range, values) {
  const api = _sheets();
  if (!api) return false;
  try {
    await api.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
    return true;
  } catch (err) {
    console.error(`[sheets] writeRange(${range}):`, err.message);
    return false;
  }
}

/**
 * Append rows below existing data in a range.
 * Returns true on success, false on failure.
 */
async function appendRows(spreadsheetId, range, values) {
  const api = _sheets();
  if (!api) return false;
  try {
    await api.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
    return true;
  } catch (err) {
    console.error(`[sheets] appendRows(${range}):`, err.message);
    return false;
  }
}

/**
 * Clear a range. Returns true on success, false on failure.
 */
async function clearRange(spreadsheetId, range) {
  const api = _sheets();
  if (!api) return false;
  try {
    await api.spreadsheets.values.clear({ spreadsheetId, range });
    return true;
  } catch (err) {
    console.error(`[sheets] clearRange(${range}):`, err.message);
    return false;
  }
}

/**
 * Batch update: write multiple ranges in one API call.
 * updates = [ { range: "Sheet1!A1", values: [[...]] }, ... ]
 */
async function batchWrite(spreadsheetId, updates) {
  const api = _sheets();
  if (!api) return false;
  try {
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates.map(u => ({ range: u.range, values: u.values })),
      },
    });
    return true;
  } catch (err) {
    console.error('[sheets] batchWrite:', err.message);
    return false;
  }
}

// ── Auth health check ─────────────────────────────────────────────────────────

/**
 * Returns true if the service account credentials are configured and valid.
 * Useful for a /sheetsstatus command or startup check.
 */
async function checkAuth(spreadsheetId) {
  const tabs = await listSheets(spreadsheetId);
  return tabs !== null;
}

module.exports = {
  readRange,
  writeRange,
  appendRows,
  clearRange,
  batchWrite,
  listSheets,
  checkAuth,
};
