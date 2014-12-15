// Generated by CoffeeScript 1.8.0
var CONCURRENT_DESTROY, CONSTANTS, ImapPool, LIMIT_DESTROY, LIMIT_UPDATE, MSGBYPAGE, Mailbox, Message, NotFound, americano, async, htmlToText, log, mailutils, uuid, _,
  __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

americano = require('americano-cozy');

module.exports = Message = americano.getModel('Message', {
  accountID: String,
  messageID: String,
  normSubject: String,
  conversationID: String,
  mailboxIDs: function(x) {
    return x;
  },
  hasTwin: function(x) {
    return x;
  },
  flags: function(x) {
    return x;
  },
  headers: function(x) {
    return x;
  },
  from: function(x) {
    return x;
  },
  to: function(x) {
    return x;
  },
  cc: function(x) {
    return x;
  },
  bcc: function(x) {
    return x;
  },
  replyTo: function(x) {
    return x;
  },
  subject: String,
  inReplyTo: function(x) {
    return x;
  },
  references: function(x) {
    return x;
  },
  text: String,
  html: String,
  date: Date,
  priority: String,
  binary: function(x) {
    return x;
  },
  attachments: function(x) {
    return x;
  }
});

mailutils = require('../utils/jwz_tools');

CONSTANTS = require('../utils/constants');

MSGBYPAGE = CONSTANTS.MSGBYPAGE, LIMIT_DESTROY = CONSTANTS.LIMIT_DESTROY, LIMIT_UPDATE = CONSTANTS.LIMIT_UPDATE, CONCURRENT_DESTROY = CONSTANTS.CONCURRENT_DESTROY;

NotFound = require('../utils/errors').NotFound;

uuid = require('uuid');

_ = require('lodash');

async = require('async');

log = require('../utils/logging')({
  prefix: 'models:message'
});

Mailbox = require('./mailbox');

ImapPool = require('../imap/pool');

htmlToText = require('html-to-text');

require('../utils/socket_handler').wrapModel(Message, 'message');

Message.getResultsAndCount = function(mailboxID, params, callback) {
  var _ref;
  if (params.flag == null) {
    params.flag = null;
  }
  if (params.descending) {
    _ref = [params.after, params.before], params.before = _ref[0], params.after = _ref[1];
  }
  return async.series([
    function(cb) {
      return Message.getCount(mailboxID, params, cb);
    }, function(cb) {
      return Message.getResults(mailboxID, params, cb);
    }
  ], function(err, results) {
    var conversationIDs, count, messages;
    if (err) {
      return callback(err);
    }
    count = results[0], messages = results[1];
    conversationIDs = _.uniq(_.pluck(messages, 'conversationID'));
    return Message.getConversationLengths(conversationIDs, function(err, lengths) {
      var _ref1;
      if (err) {
        return callback(err);
      }
      return callback(null, {
        messages: messages,
        count: ((_ref1 = count[0]) != null ? _ref1.value : void 0) || 0,
        conversationLengths: lengths
      });
    });
  });
};

Message.getResults = function(mailboxID, params, callback) {
  var after, before, descending, flag, skip, sortField;
  before = params.before, after = params.after, descending = params.descending, sortField = params.sortField, flag = params.flag;
  skip = 0;
  if (params.resultsAfter) {
    before = params.resultsAfter;
    skip = 1;
  }
  return Message.rawRequest('byMailboxRequest', {
    descending: descending,
    startkey: [sortField, mailboxID, flag, before],
    endkey: [sortField, mailboxID, flag, after],
    reduce: false,
    skipe: skip,
    include_docs: true,
    limit: MSGBYPAGE
  }, function(err, rows) {
    if (err) {
      return callback(err);
    }
    return callback(null, rows.map(function(row) {
      return new Message(row.doc);
    }));
  });
};

Message.getCount = function(mailboxID, params, callback) {
  var after, before, descending, flag, sortField;
  before = params.before, after = params.after, descending = params.descending, sortField = params.sortField, flag = params.flag;
  return Message.rawRequest('byMailboxRequest', {
    descending: descending,
    startkey: [sortField, mailboxID, flag, before],
    endkey: [sortField, mailboxID, flag, after],
    reduce: true,
    group_level: 2
  }, function(err, rows) {
    var _ref;
    if (err) {
      return callback(err);
    }
    return callback(null, ((_ref = rows[0]) != null ? _ref.value : void 0) || 0);
  });
};

Message.updateOrCreate = function(message, callback) {
  log.debug("create or update");
  if (message.id) {
    return Message.find(message.id, function(err, existing) {
      log.debug("update");
      if (err) {
        return callback(err);
      } else if (!existing) {
        return callback(new NotFound("Message " + message.id));
      } else {
        message.binary = existing.binary;
        return existing.updateAttributes(message, callback);
      }
    });
  } else {
    log.debug("create");
    return Message.create(message, callback);
  }
};

Message.fetchOrUpdate = function(box, mid, uid, callback) {
  log.debug("fetchOrUpdate", box.id, mid, uid);
  return Message.byMessageID(box.accountID, mid, function(err, existing) {
    if (err) {
      return callback(err);
    }
    if (existing && !existing.isInMailbox(box)) {
      log.debug("        add");
      return existing.addToMailbox(box, uid, callback);
    } else if (existing) {
      log.debug("        twin");
      return existing.markTwin(box, uid, callback);
    } else {
      log.debug("        fetch");
      return setTimeout(function() {
        return box.imap_fetchOneMail(uid, callback);
      }, 50);
    }
  });
};

Message.prototype.markTwin = function(box, uid, callback) {
  var hasTwin, _ref;
  hasTwin = this.hasTwin || [];
  if (_ref = box.id, __indexOf.call(hasTwin, _ref) < 0) {
    return callback(null);
  }
  hasTwin.push(box.id);
  return this.updateAttributes({
    changes: {
      hasTwin: hasTwin
    }
  }, callback);
};

Message.UIDsInRange = function(mailboxID, min, max, callback) {
  return Message.rawRequest('byMailboxRequest', {
    startkey: ['uid', mailboxID, min],
    endkey: ['uid', mailboxID, max],
    inclusive_end: true,
    reduce: false
  }, function(err, rows) {
    var result, row, uid, _i, _len;
    if (err) {
      return callback(err);
    }
    result = {};
    for (_i = 0, _len = rows.length; _i < _len; _i++) {
      row = rows[_i];
      uid = row.key[2];
      result[uid] = [row.id, row.value];
    }
    return callback(null, result);
  });
};

Message.byMessageID = function(accountID, messageID, callback) {
  messageID = mailutils.normalizeMessageID(messageID);
  return Message.rawRequest('dedupRequest', {
    key: [accountID, 'mid', messageID],
    include_docs: true
  }, function(err, rows) {
    var message, _ref;
    if (err) {
      return callback(err);
    }
    message = (_ref = rows[0]) != null ? _ref.doc : void 0;
    if (message) {
      message = new Message(message);
    }
    return callback(null, message);
  });
};

Message.getConversationLengths = function(conversationIDs, callback) {
  return Message.rawRequest('byConversationID', {
    keys: conversationIDs,
    group: true,
    reduce: true
  }, function(err, rows) {
    var out, row, _i, _len;
    if (err) {
      return callback(err);
    }
    out = {};
    for (_i = 0, _len = rows.length; _i < _len; _i++) {
      row = rows[_i];
      out[row.key] = row.value;
    }
    return callback(null, out);
  });
};

Message.byConversationID = function(conversationID, callback) {
  return Message.rawRequest('byConversationId', {
    key: conversationID,
    reduce: false,
    include_docs: true
  }, function(err, rows) {
    var messages;
    if (err) {
      return callback(err);
    }
    messages = rows.map(function(row) {
      return new Message(row.doc);
    });
    return callback(null, messages);
  });
};

Message.safeDestroyByAccountID = function(accountID, callback, retries) {
  if (retries == null) {
    retries = 2;
  }
  log.info("destroying all messages in account " + accountID);
  return Message.rawRequest('dedupRequest', {
    limit: LIMIT_DESTROY,
    startkey: [accountID],
    endkey: [accountID, {}]
  }, function(err, rows) {
    if (err) {
      return callback(err);
    }
    if (rows.length === 0) {
      return callback(null);
    }
    log.info("destroying", rows.length, "messages");
    return async.eachLimit(rows, CONCURRENT_DESTROY, function(row, cb) {
      return new Message({
        id: row.id
      }).destroy(function(err) {
        if ((err != null ? err.message : void 0) === "Document not found") {
          return cb(null);
        } else {
          return cb(err);
        }
      });
    }, function(err) {
      if (err && retries > 0) {
        log.warn("DS has crashed ? waiting 4s before try again", err);
        return setTimeout(function() {
          retries = retries - 1;
          return Message.safeDestroyByAccountID(accountID, callback, retries);
        }, 4000);
      } else if (err) {
        return callback(err);
      } else {
        return Message.safeDestroyByAccountID(accountID, callback, 2);
      }
    });
  });
};

Message.safeRemoveAllFromBox = function(mailboxID, callback, retries) {
  if (retries == null) {
    retries = 2;
  }
  log.info("removing all messages from mailbox " + mailboxID);
  return Message.rawRequest('byMailboxRequest', {
    limit: LIMIT_UPDATE,
    startkey: ['uid', mailboxID, 0],
    endkey: ['uid', mailboxID, {}],
    include_docs: true,
    reduce: false
  }, function(err, rows) {
    if (err) {
      return callback(err);
    }
    if (rows.length === 0) {
      return callback(null);
    }
    return async.eachLimit(rows, CONCURRENT_DESTROY, function(row, cb) {
      return new Message(row.doc).removeFromMailbox({
        id: mailboxID
      }, cb);
    }, function(err) {
      if (err && retries > 0) {
        log.warn("DS has crashed ? waiting 4s before try again", err);
        return setTimeout(function() {
          retries = retries - 1;
          return Message.safeRemoveAllFromBox(mailboxID, callback, retries);
        }, 4000);
      } else if (err) {
        return callback(err);
      } else {
        return Message.safeRemoveAllFromBox(mailboxID, callback, 2);
      }
    });
  });
};

Message.prototype.addToMailbox = function(box, uid, callback) {
  var mailboxIDs;
  log.info("MAIL " + box.path + ":" + uid + " ADDED TO BOX");
  mailboxIDs = this.mailboxIDs || {};
  mailboxIDs[box.id] = uid;
  return this.updateAttributes({
    mailboxIDs: mailboxIDs
  }, callback);
};

Message.prototype.isInMailbox = function(box) {
  return this.mailboxIDs[box.id] != null;
};

Message.prototype.removeFromMailbox = function(box, noDestroy, callback) {
  var isOrphan, mailboxIDs;
  if (noDestroy == null) {
    noDestroy = false;
  }
  log.debug(".removeFromMailbox", this.id, box.label);
  if (!callback) {
    callback = noDestroy;
  }
  mailboxIDs = this.mailboxIDs;
  delete mailboxIDs[box.id];
  isOrphan = Object.keys(mailboxIDs).length === 0;
  log.debug("REMOVING " + this.id + ", NOW ORPHAN = ", isOrphan);
  if (isOrphan && !noDestroy) {
    return this.destroy(callback);
  } else {
    return this.updateAttributes({
      mailboxIDs: mailboxIDs
    }, callback);
  }
};

Message.removeFromMailbox = function(id, box, callback) {
  log.debug("removeFromMailbox", id, box.label);
  return Message.find(id, function(err, message) {
    if (err) {
      return callback(err);
    }
    if (!message) {
      return callback(new NotFound("Message " + id));
    }
    return message.removeFromMailbox(box, false, callback);
  });
};

Message.applyFlagsChanges = function(id, flags, callback) {
  log.debug("applyFlagsChanges", id, flags);
  return Message.find(id, function(err, message) {
    if (err) {
      return callback(err);
    }
    return message.updateAttributes({
      flags: flags
    }, callback);
  });
};

Message.removeOrphans = function(existings, callback) {
  log.debug("removeOrphans");
  return Message.rawRequest('byMailboxRequest', {
    reduce: true,
    group_level: 2,
    startkey: ['uid', ''],
    endkey: ['uid', "\uFFFF"]
  }, function(err, rows) {
    if (err) {
      return callback(err);
    }
    return async.eachSeries(rows, function(row, cb) {
      var mailboxID;
      mailboxID = row.key[1];
      if (__indexOf.call(existings, mailboxID) >= 0) {
        return cb(null);
      } else {
        log.debug("removeOrphans - found orphan", row.id);
        return Message.safeRemoveAllFromBox(mailboxID, function(err) {
          if (err) {
            log.error('failed to remove message', row.id, err);
          }
          return cb(null);
        });
      }
    }, callback);
  });
};

Message.prototype.applyPatchOperations = function(patch, callback) {
  var boxOps, boxid, flagsOps, index, newflags, newmailboxIDs, operation, uid, _i, _j, _len, _len1, _ref;
  log.debug(".applyPatchOperations", patch);
  newmailboxIDs = {};
  _ref = this.mailboxIDs;
  for (boxid in _ref) {
    uid = _ref[boxid];
    newmailboxIDs[boxid] = uid;
  }
  boxOps = {
    addTo: [],
    removeFrom: []
  };
  for (_i = 0, _len = patch.length; _i < _len; _i++) {
    operation = patch[_i];
    if (!(operation.path.indexOf('/mailboxIDs/') === 0)) {
      continue;
    }
    boxid = operation.path.substring(12);
    if (operation.op === 'add') {
      boxOps.addTo.push(boxid);
      newmailboxIDs[boxid] = -1;
    } else if (operation.op === 'remove') {
      boxOps.removeFrom.push(boxid);
      delete newmailboxIDs[boxid];
    } else {
      throw new Error('modifying UID is not possible');
    }
  }
  flagsOps = {
    add: [],
    remove: []
  };
  for (_j = 0, _len1 = patch.length; _j < _len1; _j++) {
    operation = patch[_j];
    if (!(operation.path.indexOf('/flags/') === 0)) {
      continue;
    }
    index = parseInt(operation.path.substring(7));
    if (operation.op === 'add') {
      flagsOps.add.push(operation.value);
    } else if (operation.op === 'remove') {
      flagsOps.remove.push(this.flags[index]);
    } else if (operation.op === 'replace') {
      if (this.flags[index] !== operation.value) {
        flagsOps.remove.push(this.flags[index]);
        flagsOps.add.push(operation.value);
      }
    }
  }
  newflags = this.flags;
  newflags = _.difference(newflags, flagsOps.remove);
  newflags = _.union(newflags, flagsOps.add);
  return this.imap_applyChanges(newflags, flagsOps, newmailboxIDs, boxOps, (function(_this) {
    return function(err, changes) {
      if (err) {
        return callback(err);
      }
      return _this.updateAttributes(changes, callback);
    };
  })(this));
};

Message.prototype.imap_applyChanges = function(newflags, flagsOps, newmailboxIDs, boxOps, callback) {
  var oldflags;
  log.debug(".applyChanges", newflags, newmailboxIDs);
  oldflags = this.flags;
  return Mailbox.getBoxes(this.accountID, (function(_this) {
    return function(err, boxes) {
      var box, boxIndex, boxid, firstboxid, firstuid, uid, _i, _j, _len, _len1, _ref;
      if (err) {
        return callback(err);
      }
      boxIndex = {};
      for (_i = 0, _len = boxes.length; _i < _len; _i++) {
        box = boxes[_i];
        uid = _this.mailboxIDs[box.id];
        boxIndex[box.id] = {
          path: box.path,
          uid: uid
        };
      }
      _ref = boxOps.addTo;
      for (_j = 0, _len1 = _ref.length; _j < _len1; _j++) {
        boxid = _ref[_j];
        if (!boxIndex[boxid]) {
          return callback(new Error("the box ID=" + boxid + " doesn't exists"));
        }
      }
      firstboxid = Object.keys(_this.mailboxIDs)[0];
      firstuid = _this.mailboxIDs[firstboxid];
      log.debug("CHANGING FLAGS OF ", firstboxid, firstuid, _this.mailboxIDs);
      return _this.doASAP(function(imap, releaseImap) {
        return async.series([
          function(cb) {
            return imap.openBox(boxIndex[firstboxid].path, cb);
          }, function(cb) {
            if (flagsOps.remove.length) {
              log.debug("REMOVING FLAGS", flagsOps.remove);
              return imap.delFlags(firstuid, flagsOps.remove, cb);
            } else {
              return cb(null);
            }
          }, function(cb) {
            if (flagsOps.add.length) {
              log.debug("ADDING FLAGS", flagsOps.add);
              return imap.addFlags(firstuid, flagsOps.add, cb);
            } else {
              return cb(null);
            }
          }, function(cb) {
            var paths;
            paths = boxOps.addTo.map(function(destID) {
              return boxIndex[destID].path;
            });
            return imap.multicopy(firstuid, paths, function(err, uids) {
              var destID, i, _k, _ref1;
              if (err) {
                return callback(err);
              }
              for (i = _k = 0, _ref1 = uids.length - 1; _k <= _ref1; i = _k += 1) {
                destID = boxOps.addTo[i];
                newmailboxIDs[destID] = uids[i];
              }
              return cb(null);
            });
          }, function(cb) {
            return async.eachSeries(boxOps.removeFrom, function(boxid, cb2) {
              var path, _ref1;
              _ref1 = boxIndex[boxid], path = _ref1.path, uid = _ref1.uid;
              return imap.deleteMessageInBox(path, uid, cb2);
            }, cb);
          }
        ], releaseImap);
      }, function(err) {
        if (err) {
          return callback(err);
        }
        return callback(null, {
          mailboxIDs: newmailboxIDs,
          flags: newflags
        });
      });
    };
  })(this));
};

Message.createFromImapMessage = function(mail, box, uid, callback) {
  var attachments, messageID;
  log.info("createFromImapMessage", box.label, uid);
  mail.accountID = box.accountID;
  mail.mailboxIDs = {};
  mail.mailboxIDs[box._id] = uid;
  messageID = mail.headers['message-id'];
  if (messageID) {
    mail.messageID = mailutils.normalizeMessageID(messageID);
  }
  if (mail.subject) {
    mail.normSubject = mailutils.normalizeSubject(mail.subject);
  }
  mail.replyTo = [];
  if (mail.cc == null) {
    mail.cc = [];
  }
  if (mail.bcc == null) {
    mail.bcc = [];
  }
  if (mail.to == null) {
    mail.to = [];
  }
  if (mail.from == null) {
    mail.from = [];
  }
  if (mail.date == null) {
    mail.date = new Date().toISOString();
  }
  attachments = [];
  if (mail.attachments) {
    attachments = mail.attachments.map(function(att) {
      var buffer, out;
      buffer = att.content;
      delete att.content;
      return out = {
        name: att.generatedFileName,
        buffer: buffer
      };
    });
  }
  return Message.findConversationID(mail, function(err, conversationID) {
    if (err) {
      return callback(err);
    }
    mail.conversationID = conversationID;
    return Message.create(mail, function(err, jdbMessage) {
      if (err) {
        return callback(err);
      }
      return jdbMessage.storeAttachments(attachments, callback);
    });
  });
};

Message.prototype.storeAttachments = function(attachments, callback) {
  log.debug("storeAttachments");
  return async.eachSeries(attachments, (function(_this) {
    return function(att, cb) {
      if (att.buffer == null) {
        att.buffer = new Buffer(0);
      }
      att.buffer.path = encodeURI(att.name);
      return _this.attachBinary(att.buffer, {
        name: att.name
      }, cb);
    };
  })(this), callback);
};

Message.findConversationID = function(mail, callback) {
  var isReplyOrForward, key, keys, references, _ref;
  log.debug("findConversationID");
  isReplyOrForward = mail.subject && mailutils.isReplyOrForward(mail.subject);
  references = mail.references || [];
  references.concat(mail.inReplyTo || []);
  references = references.map(mailutils.normalizeMessageID).filter(function(mid) {
    return mid;
  });
  if (references.length) {
    keys = references.map(function(mid) {
      return [mail.accountID, 'mid', mid];
    });
    return Message.rawRequest('dedupRequest', {
      keys: keys
    }, function(err, rows) {
      if (err) {
        return callback(err);
      }
      log.debug('   found = ', rows != null ? rows.length : void 0);
      return Message.pickConversationID(rows, callback);
    });
  } else if (((_ref = mail.normSubject) != null ? _ref.length : void 0) > 3 && isReplyOrForward) {
    key = [mail.accountID, 'subject', mail.normSubject];
    return Message.rawRequest('dedupRequest', {
      key: key
    }, function(err, rows) {
      if (err) {
        return callback(err);
      }
      return Message.pickConversationID(rows, callback);
    });
  } else {
    return callback(null, uuid.v4());
  }
};

Message.pickConversationID = function(rows, callback) {
  var change, conversationID, conversationIDCounts, count, pickedConversationID, pickedConversationIDCount, row, _i, _len, _name;
  log.debug("pickConversationID");
  conversationIDCounts = {};
  for (_i = 0, _len = rows.length; _i < _len; _i++) {
    row = rows[_i];
    if (conversationIDCounts[_name = row.value] == null) {
      conversationIDCounts[_name] = 1;
    }
    conversationIDCounts[row.value]++;
  }
  pickedConversationID = null;
  pickedConversationIDCount = 0;
  for (conversationID in conversationIDCounts) {
    count = conversationIDCounts[conversationID];
    if (count > pickedConversationIDCount) {
      pickedConversationID = conversationID;
      pickedConversationIDCount = count;
    }
  }
  if (!((pickedConversationID != null) && pickedConversationID !== 'undefined')) {
    pickedConversationID = uuid.v4();
  }
  change = {
    conversationID: pickedConversationID
  };
  return async.eachSeries(rows, function(row, cb) {
    if (row.value === pickedConversationID) {
      return cb(null);
    }
    return Message.find(row.id, function(err, message) {
      if (err) {
        log.warn("Cant get message " + row.id + ", ignoring");
      }
      if (err || message.conversationID === pickedConversationID) {
        return cb(null);
      } else {
        return message.updateAttributes(change, cb);
      }
    });
  }, function(err) {
    if (err) {
      return callback(err);
    }
    return callback(null, pickedConversationID);
  });
};

Message.prototype.toClientObject = function() {
  var raw, _ref;
  raw = this.toObject();
  if ((_ref = raw.attachments) != null) {
    _ref.forEach(function(file) {
      return file.url = "message/" + raw.id + "/attachments/" + file.generatedFileName;
    });
  }
  if (raw.html != null) {
    raw.html = mailutils.sanitizeHTML(raw.html, raw.id, raw.attachments || []);
  }
  if (raw.text == null) {
    raw.text = htmlToText.fromString(raw.html, {
      tables: true,
      wordwrap: 80
    });
  }
  return raw;
};

Message.prototype.doASAP = function(operation, callback) {
  return ImapPool.get(this.accountID).doASAP(operation, callback);
};

Message.recoverChangedUID = function(box, messageID, newUID, callback) {
  log.debug("recoverChangedUID");
  return Message.byMessageID(box.accountID, messageID, function(err, message) {
    var mailboxIDs;
    if (err) {
      return callback(err);
    }
    if (!message) {
      return callback(null);
    }
    if (!message.mailboxIDs[box.id]) {
      return callback(null);
    }
    mailboxIDs = message.mailboxIDs;
    mailboxIDs[box.id] = newUID;
    return message.updateAttributes({
      mailboxIDs: mailboxIDs
    }, callback);
  });
};

Message.removeAccountOrphans = function() {
  return Message.rawRequest;
};
