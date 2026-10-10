/**
 * HazelQuiz Cloud Sync API
 * Store bank / progress / SRS JSON in the HazelQuiz Drive folder.
 *
 * Deploy: script.new → paste this file → Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the /exec URL into HazelQuiz → 生字 → 雲端同步.
 *
 * Client sends text/plain JSON (avoids CORS preflight):
 *   { action: "pull"|"push"|"ping", user: "...", pin: "...", data?: object }
 */
var FOLDER_ID = '11NyWbJ-unM4wU1HNoFp_Mj4HMWHBqG1F';
var FILE_PREFIX = 'hazelquiz-sync-';

function doGet(e) {
  return json_({ ok: true, app: 'HazelQuiz', version: 1, hint: 'POST JSON {action,user,pin,data}' });
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = String(body.action || '').toLowerCase();
    var user = normalizeUser_(body.user);
    var pin = String(body.pin || '');
    if (!user) return json_({ ok: false, error: 'missing_user' });
    if (pin.length < 4) return json_({ ok: false, error: 'pin_too_short' });

    var key = storageKey_(user, pin);
    if (action === 'ping') {
      return json_({ ok: true, user: user, key: key.slice(0, 8) });
    }
    if (action === 'pull') {
      var raw = readSyncFile_(key);
      return json_({ ok: true, user: user, data: raw ? JSON.parse(raw) : null, updatedAt: raw ? null : null });
    }
    if (action === 'push') {
      if (!body.data || typeof body.data !== 'object') {
        return json_({ ok: false, error: 'missing_data' });
      }
      var payload = body.data;
      payload.updatedAt = Date.now();
      payload.user = user;
      writeSyncFile_(key, JSON.stringify(payload));
      return json_({ ok: true, user: user, updatedAt: payload.updatedAt });
    }
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function normalizeUser_(u) {
  return String(u || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .slice(0, 64);
}

function storageKey_(user, pin) {
  var raw = user + '|' + pin + '|hazelquiz-v1';
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return FILE_PREFIX + toHex_(digest);
}

function toHex_(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256;
    var h = b.toString(16);
    out.push(h.length === 1 ? '0' + h : h);
  }
  return out.join('');
}

function folder_() {
  return DriveApp.getFolderById(FOLDER_ID);
}

function findFile_(name) {
  var it = folder_().getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function readSyncFile_(key) {
  var name = key + '.json';
  var f = findFile_(name);
  if (!f) return null;
  return f.getBlob().getDataAsString('UTF-8');
}

function writeSyncFile_(key, text) {
  var name = key + '.json';
  var f = findFile_(name);
  var blob = Utilities.newBlob(text, 'application/json', name);
  if (f) {
    f.setContent(text);
  } else {
    folder_().createFile(blob);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
