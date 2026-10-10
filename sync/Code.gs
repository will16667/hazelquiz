/**
 * HazelQuiz — shared cloud bank on Will's Drive
 * Friends: no Google login. File: hazelquiz-shared-bank.json in FOLDER_ID
 * POST text/plain JSON: { action, bankId?, data? }
 * data shape: { vocab, cleared, progress, readPos, updatedAt, v }
 */
var FOLDER_ID = '11NyWbJ-unM4wU1HNoFp_Mj4HMWHBqG1F';
var BANK_FILE = 'hazelquiz-shared-bank.json';
var DEFAULT_BANK = 'hazel';

function doGet(e) {
  return json_({
    ok: true,
    app: 'HazelQuiz',
    version: 3,
    mode: 'shared-bank',
    file: BANK_FILE,
    hint: 'POST text/plain JSON {action:"pull"|"push"|"ping", bankId:"hazel", data?}',
  });
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = String(body.action || '').toLowerCase();
    var bankId = normalizeBank_(body.bankId || body.bank || body.user || DEFAULT_BANK);

    if (action === 'ping') {
      return json_({ ok: true, bankId: bankId, file: BANK_FILE });
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
      // Normalize legacy shape where bank was overwritten with string
      if (data && typeof data.bank === 'string') {
        data = {
          vocab: data.vocab || {},
          cleared: data.cleared || {},
          progress: data.progress || {},
          readPos: data.readPos || {},
          updatedAt: data.updatedAt || null,
          v: data.v || 1,
          bankId: data.bank,
        };
      } else if (data && data.bank && typeof data.bank === 'object' && !data.vocab) {
        // Legacy client: bank map was vocab
        data = {
          vocab: data.bank,
          cleared: data.cleared || {},
          progress: data.progress || {},
          readPos: data.readPos || {},
          updatedAt: data.updatedAt || null,
          v: data.v || 1,
          bankId: bankId,
        };
      }
      return json_({
        ok: true,
        bankId: bankId,
        data: data,
        updatedAt: data && data.updatedAt ? data.updatedAt : null,
      });
    }
    if (action === 'push') {
      if (!body.data || typeof body.data !== 'object') {
        return json_({ ok: false, error: 'missing_data' });
      }
      var incoming = body.data;
      var vocab = incoming.vocab;
      if (!vocab && incoming.bank && typeof incoming.bank === 'object') {
        vocab = incoming.bank;
      }
      if (!vocab || typeof vocab !== 'object') vocab = {};
      var payload = {
        vocab: vocab,
        cleared: incoming.cleared || {},
        progress: incoming.progress || {},
        readPos: incoming.readPos || {},
        updatedAt: Date.now(),
        v: incoming.v || 1,
        bankId: bankId,
      };
      writeBank_(JSON.stringify(payload));
      return json_({ ok: true, bankId: bankId, updatedAt: payload.updatedAt, file: BANK_FILE });
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
