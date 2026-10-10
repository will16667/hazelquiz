/**
 * HazelQuiz — shared cloud bank on Will's Drive
 * One JSON file for Hazel (+ anyone with the Web App URL). No Google login for friends.
 *
 * Deploy once (Will's Google that owns the HazelQuiz Drive folder):
 *   script.new → paste this → Deploy → Web app → Execute as Me → Anyone
 * Copy the /exec URL into config.js as HAZEL_SYNC_URL (or #/sync once).
 *
 * File written: hazelquiz-shared-bank.json in FOLDER_ID
 * Client POSTs text/plain JSON: { action: "pull"|"push"|"ping", bank?: "hazel", data? }
 */
var FOLDER_ID = '11NyWbJ-unM4wU1HNoFp_Mj4HMWHBqG1F';
var BANK_FILE = 'hazelquiz-shared-bank.json';
var DEFAULT_BANK = 'hazel';

function doGet(e) {
  return json_({
    ok: true,
    app: 'HazelQuiz',
    version: 2,
    mode: 'shared-bank',
    file: BANK_FILE,
    hint: 'POST text/plain JSON {action:"pull"|"push"|"ping", bank:"hazel", data?}',
  });
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = String(body.action || '').toLowerCase();
    var bank = normalizeBank_(body.bank || body.user || DEFAULT_BANK);

    if (action === 'ping') {
      return json_({ ok: true, bank: bank, file: BANK_FILE });
    }
    if (action === 'pull') {
      var raw = readBank_();
      var data = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch (parseErr) {
          return json_({ ok: false, error: 'corrupt_bank' });
        }
      }
      return json_({
        ok: true,
        bank: bank,
        data: data,
        updatedAt: data && data.updatedAt ? data.updatedAt : null,
      });
    }
    if (action === 'push') {
      if (!body.data || typeof body.data !== 'object') {
        return json_({ ok: false, error: 'missing_data' });
      }
      var payload = body.data;
      payload.updatedAt = Date.now();
      payload.bank = bank;
      payload.v = payload.v || 1;
      writeBank_(JSON.stringify(payload));
      return json_({ ok: true, bank: bank, updatedAt: payload.updatedAt, file: BANK_FILE });
    }
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function normalizeBank_(u) {
  var s = String(u || DEFAULT_BANK)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
  return s || DEFAULT_BANK;
}

function folder_() {
  return DriveApp.getFolderById(FOLDER_ID);
}

function findBankFile_() {
  var it = folder_().getFilesByName(BANK_FILE);
  return it.hasNext() ? it.next() : null;
}

function readBank_() {
  var f = findBankFile_();
  if (!f) return null;
  return f.getBlob().getDataAsString('UTF-8');
}

function writeBank_(text) {
  var f = findBankFile_();
  if (f) {
    f.setContent(text);
  } else {
    var blob = Utilities.newBlob(text, 'application/json', BANK_FILE);
    folder_().createFile(blob);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
