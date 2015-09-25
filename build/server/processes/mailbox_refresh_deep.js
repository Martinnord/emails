// Generated by CoffeeScript 1.8.0
var FETCH_AT_ONCE, MailboxRefreshDeep, Message, Process, RefreshError, async, log, ramStore, safeLoop, _,
  __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

Process = require('./_base');

safeLoop = require('../utils/safeloop');

async = require('async');

log = require('../utils/logging')({
  prefix: 'process:box_refresh_deep'
});

FETCH_AT_ONCE = require('../utils/constants').FETCH_AT_ONCE;

RefreshError = require('../utils/errors').RefreshError;

_ = require('lodash');

Message = require('../models/message');

ramStore = require('../models/store_account_and_boxes');

module.exports = MailboxRefreshDeep = (function(_super) {
  __extends(MailboxRefreshDeep, _super);

  function MailboxRefreshDeep() {
    this.saveLastSync = __bind(this.saveLastSync, this);
    this.applyToFetch = __bind(this.applyToFetch, this);
    this.applyFlagsChanges = __bind(this.applyFlagsChanges, this);
    this.applyToRemove = __bind(this.applyToRemove, this);
    this.computeDiff = __bind(this.computeDiff, this);
    this.getDiff = __bind(this.getDiff, this);
    this.setNextStep = __bind(this.setNextStep, this);
    this.status = __bind(this.status, this);
    this.getProgress = __bind(this.getProgress, this);
    this.refreshStep = __bind(this.refreshStep, this);
    return MailboxRefreshDeep.__super__.constructor.apply(this, arguments);
  }

  MailboxRefreshDeep.prototype.code = 'mailbox-refresh-deep';

  MailboxRefreshDeep.prototype.initialize = function(options, done) {
    this.limitByBox = options.limitByBox;
    this.firstImport = options.firstImport;
    this.storeHighestModSeq = options.storeHighestModSeq;
    this.mailbox = options.mailbox;
    this.initialStep = true;
    this.shouldNotif = false;
    this.nbStep = 1;
    this.nbStepDone = 0;
    this.nbOperationDone = 0;
    this.nbOperationCurrentStep = 1;
    if (ramStore.getAccount(this.mailbox.accountID).isTest()) {
      this.finished = true;
    }
    return async.whilst(((function(_this) {
      return function() {
        return !_this.finished;
      };
    })(this)), this.refreshStep, (function(_this) {
      return function(err) {
        if (err) {
          return done(err);
        }
        return _this.saveLastSync(done);
      };
    })(this));
  };

  MailboxRefreshDeep.prototype.refreshStep = function(callback) {
    log.debug("imap_refreshStep", this.status());
    return async.series([this.getDiff, this.computeDiff, this.applyToRemove, this.applyFlagsChanges, this.applyToFetch], callback);
  };

  MailboxRefreshDeep.prototype.getProgress = function() {
    var currentPart;
    currentPart = this.nbOperationDone / this.nbOperationCurrentStep;
    return (this.nbStepDone + currentPart) / this.nbStep;
  };

  MailboxRefreshDeep.prototype.status = function() {
    var msg;
    msg = this.initialStep ? 'initial' : '';
    if (this.limitByBox) {
      msg += " limit: " + this.limitByBox;
    }
    msg += " range: " + this.min + ":" + this.max;
    if (this.finished) {
      msg += " finished";
    }
    return msg;
  };

  MailboxRefreshDeep.prototype.setNextStep = function(uidnext) {
    log.debug("computeNextStep", this.status(), "next", uidnext);
    if (this.limitByBox && !this.initialStep) {
      this.finished = true;
    } else if (this.limitByBox) {
      this.initialStep = false;
      this.nbStep = 1;
      this.min = Math.max(1, uidnext - this.limitByBox);
      this.max = Math.max(1, uidnext - 1);
    } else if (this.initialStep) {
      this.initialStep = false;
      this.nbStep = Math.ceil(uidnext / FETCH_AT_ONCE);
      this.min = 1;
      this.max = Math.min(uidnext, FETCH_AT_ONCE);
    } else {
      this.min = Math.min(uidnext, this.max + 1);
      this.max = Math.min(uidnext, this.min + FETCH_AT_ONCE);
    }
    if (this.min === this.max) {
      this.finished = true;
    }
    return log.debug("nextStepEnd", this.status());
  };

  MailboxRefreshDeep.prototype.UIDsInRange = function(callback) {
    return Message.rawRequest('byMailboxRequest', {
      startkey: ['uid', this.mailbox.id, this.min],
      endkey: ['uid', this.mailbox.id, this.max],
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

  MailboxRefreshDeep.prototype.getDiff = function(callback) {
    log.debug("diff", this.status());
    return this.mailbox.doLaterWithBox((function(_this) {
      return function(imap, imapbox, cbRelease) {
        _this.setNextStep(imapbox.uidnext);
        _this.imapHighestmodseq = imapbox.highestmodseq;
        _this.imapTotal = imapbox.messages.total;
        if (_this.finished) {
          return cbRelease(null);
        }
        log.info("IMAP REFRESH " + _this.mailbox.label + " UID " + _this.min + ":" + _this.max);
        return async.series([
          function(cb) {
            return _this.UIDsInRange(cb);
          }, function(cb) {
            return imap.fetchMetadata(_this.min, _this.max, cb);
          }
        ], cbRelease);
      };
    })(this), (function(_this) {
      return function(err, results) {
        log.debug("diff#results");
        if (err) {
          return callback(err);
        } else if (_this.finished) {
          return callback(null);
        } else {
          _this.cozyIDs = results[0], _this.imapUIDs = results[1];
          return callback(null);
        }
      };
    })(this));
  };

  MailboxRefreshDeep.prototype.computeDiff = function(callback) {
    var cozyFlags, cozyMessage, diff, id, imapFlags, imapMessage, needApply, uid, _ref, _ref1;
    if (this.finished) {
      return callback(null);
    }
    this.toFetch = [];
    this.toRemove = [];
    this.flagsChange = [];
    _ref = this.imapUIDs;
    for (uid in _ref) {
      imapMessage = _ref[uid];
      cozyMessage = this.cozyIDs[uid];
      if (cozyMessage) {
        imapFlags = imapMessage[1];
        cozyFlags = cozyMessage[1];
        diff = _.xor(imapFlags, cozyFlags);
        needApply = diff.length > 2 || diff.length === 1 && diff[0] !== '\\Draft';
        if (needApply) {
          id = cozyMessage[0];
          this.flagsChange.push({
            id: id,
            flags: imapFlags
          });
        }
      } else {
        this.toFetch.push({
          uid: parseInt(uid),
          mid: imapMessage[0]
        });
      }
    }
    _ref1 = this.cozyIDs;
    for (uid in _ref1) {
      cozyMessage = _ref1[uid];
      if (!this.imapUIDs[uid]) {
        this.toRemove.push(id = cozyMessage[0]);
      }
    }
    this.nbOperationDone = 0;
    this.nbOperationCurrentStep = this.toFetch.length + this.toRemove.length + this.flagsChange.length;
    return callback(null);
  };

  MailboxRefreshDeep.prototype.applyToRemove = function(callback) {
    if (this.finished) {
      return callback(null);
    }
    log.debug("applyRemove", this.toRemove.length);
    return safeLoop(this.toRemove, (function(_this) {
      return function(id, cb) {
        _this.nbOperationDone += 1;
        return Message.removeFromMailbox(id, _this.mailbox, cb);
      };
    })(this), function(errors) {
      if (errors != null ? errors.length : void 0) {
        return callback(new RefreshError(errors));
      } else {
        return callback(null);
      }
    });
  };

  MailboxRefreshDeep.prototype.applyFlagsChanges = function(callback) {
    if (this.finished) {
      return callback(null);
    }
    log.debug("applyFlagsChanges", this.flagsChange.length);
    return safeLoop(this.flagsChange, function(change, cb) {
      this.nbOperationDone += 1;
      log.debug("applyFlagsChanges", change);
      return Message.updateAttributes(change.id, {
        flags: change.flags
      }, cb);
    }, function(errors) {
      if (errors != null ? errors.length : void 0) {
        return callback(new RefreshError(errors));
      } else {
        return callback(null);
      }
    });
  };

  MailboxRefreshDeep.prototype.applyToFetch = function(callback) {
    if (this.finished) {
      return callback(null);
    }
    log.debug("applyFetch", this.toFetch.length);
    return safeLoop(this.toFetch, (function(_this) {
      return function(msg, cb) {
        return Message.fetchOrUpdate(_this.mailbox, msg, function(err, result) {
          this.nbOperationDone += 1;
          if ((result != null ? result.shouldNotif : void 0) === true) {
            this.shouldNotif = true;
          }
          return setTimeout((function() {
            return cb(null);
          }), 50);
        });
      };
    })(this), function(errors) {
      if (errors != null ? errors.length : void 0) {
        return callback(new RefreshError(errors));
      } else {
        return callback(null);
      }
    });
  };

  MailboxRefreshDeep.prototype.saveLastSync = function(callback) {
    var changes;
    changes = {
      lastSync: new Date().toISOString()
    };
    if (this.storeHighestModSeq) {
      changes.lastHighestModSeq = this.imapHighestmodseq;
      changes.lastTotal = this.imapTotal;
      log.debug("saveLastSync", this.mailbox.label, changes);
    }
    return this.mailbox.updateAttributes(changes, callback);
  };

  return MailboxRefreshDeep;

})(Process);