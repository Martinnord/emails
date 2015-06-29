// Generated by CoffeeScript 1.9.1
var Account, AccountConfigError, CONSTANTS, Compiler, ImapPool, ImapReporter, Mailbox, Message, NotFound, RefreshError, SMTPConnection, _, async, cozydb, isMailboxDontExist, log, nodemailer, notifications, ref, refreshTimeout,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

cozydb = require('cozydb');

Account = (function(superClass) {
  extend(Account, superClass);

  function Account() {
    return Account.__super__.constructor.apply(this, arguments);
  }

  Account.docType = 'Account';

  Account.schema = {
    label: String,
    name: String,
    login: String,
    password: String,
    accountType: String,
    oauthProvider: String,
    oauthRefreshToken: String,
    initialized: Boolean,
    smtpServer: String,
    smtpPort: Number,
    smtpSSL: Boolean,
    smtpTLS: Boolean,
    smtpLogin: String,
    smtpPassword: String,
    smtpMethod: String,
    imapLogin: String,
    imapServer: String,
    imapPort: Number,
    imapSSL: Boolean,
    imapTLS: Boolean,
    inboxMailbox: String,
    flaggedMailbox: String,
    draftMailbox: String,
    sentMailbox: String,
    trashMailbox: String,
    junkMailbox: String,
    allMailbox: String,
    favorites: [String],
    patchIgnored: Boolean,
    supportRFC4551: Boolean,
    signature: String,
    oauthProvider: String
  };

  Account.findSafe = function(id, callback) {
    return Account.find(id, function(err, account) {
      if (err) {
        return callback(err);
      }
      if (!account) {
        return callback(new NotFound("Account#" + id));
      }
      return callback(null, account);
    });
  };

  Account.refreshAllAccounts = function(limitByBox, onlyFavorites, callback) {
    return Account.request('all', function(err, accounts) {
      var options;
      if (err) {
        return callback(err);
      }
      options = {
        accounts: accounts,
        limitByBox: limitByBox,
        onlyFavorites: onlyFavorites,
        firstImport: false
      };
      return Account.refreshAccounts(options, callback);
    });
  };

  Account.removeOrphansAndRefresh = function(limitByBox, onlyFavorites, callback) {
    var allAccounts, existingAccountIDs, existingMailboxIDs, toIgnore;
    allAccounts = [];
    existingAccountIDs = [];
    existingMailboxIDs = [];
    toIgnore = [];
    return async.series([
      function(cb) {
        return Account.all(function(err, accounts) {
          if (err) {
            return cb(err);
          }
          existingAccountIDs = accounts.map(function(account) {
            return account.id;
          });
          allAccounts = accounts;
          log.debug("removeOrphansAndRefresh@allAccounts", allAccounts);
          return async.eachSeries(allAccounts, function(account, cb) {
            if (!account.initialized) {
              log.debug("removeOrphansAndRefresh@initialized#refreshBoxes");
              return account.imap_refreshBoxes(function(err, boxes) {
                if (err) {
                  return cb(err);
                }
                log.debug("removeOrphansAndRefresh@initialized#imap_scanBoxesForSpecialUse");
                return account.imap_scanBoxesForSpecialUse(boxes, cb);
              });
            } else {
              return cb(null);
            }
          }, cb);
        });
      }, function(cb) {
        return Mailbox.removeOrphans(existingAccountIDs, function(err, existingIDs) {
          if (err) {
            return cb(err);
          }
          existingMailboxIDs = existingIDs;
          return cb(null);
        });
      }, function(cb) {
        return Message.removeOrphans(existingMailboxIDs, cb);
      }, function(cb) {
        return async.eachSeries(allAccounts, function(account, cbLoop) {
          return account.applyPatchIgnored(function(err) {
            if (err) {
              log.error("ignored patch err", err);
            }
            return cbLoop(null);
          });
        }, cb);
      }, function(cb) {
        return async.eachSeries(allAccounts, function(account, cbLoop) {
          return account.applyPatchConversation(function(err) {
            if (err) {
              log.error("conv patch err", err);
            }
            return cbLoop(null);
          });
        }, cb);
      }
    ], function(err) {
      var options;
      if (err) {
        return callback(err);
      }
      options = {
        accounts: allAccounts,
        limitByBox: limitByBox,
        onlyFavorites: onlyFavorites,
        firstImport: false,
        periodic: CONSTANTS.REFRESH_INTERVAL
      };
      return Account.refreshAccounts(options, callback);
    });
  };

  Account.refreshAccounts = function(options, callback) {
    var accounts, errors, firstImport, limitByBox, onlyFavorites, periodic;
    accounts = options.accounts, limitByBox = options.limitByBox, onlyFavorites = options.onlyFavorites, firstImport = options.firstImport, periodic = options.periodic;
    errors = {};
    return async.eachSeries(accounts, function(account, cb) {
      var accountOptions;
      log.debug("refreshing account " + account.label);
      if (account.isTest()) {
        return cb(null);
      }
      if (account.isRefreshing()) {
        return cb(null);
      }
      accountOptions = {
        limitByBox: limitByBox,
        onlyFavorites: onlyFavorites,
        firstImport: firstImport
      };
      return account.imap_fetchMails(accountOptions, function(err) {
        log.debug("done refreshing account " + account.label);
        if (err) {
          log.error("CANT REFRESH ACCOUNT", account.label, err);
          errors[account.id] = err;
        }
        return cb(null);
      });
    }, function() {
      var error, refreshTimeout;
      if (periodic != null) {
        clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(function() {
          log.debug("doing periodic refresh");
          options.onlyFavorites = true;
          options.limitByBox = CONSTANTS.LIMIT_BY_BOX;
          return Account.refreshAccounts(options);
        }, periodic);
      }
      if (callback != null) {
        if (Object.keys(errors).length > 0) {
          error = new RefreshError(errors);
        }
        return callback(error);
      }
    });
  };

  Account.createIfValid = function(data, callback) {
    var account, toFetch;
    data.initialized = true;
    account = new Account(data);
    toFetch = null;
    return async.series([
      function(cb) {
        log.debug("create#testConnections");
        return account.testConnections(cb);
      }, function(cb) {
        log.debug("create#cozy");
        return Account.create(account, function(err, created) {
          if (err) {
            return cb(err);
          }
          account = created;
          return cb(null);
        });
      }, function(cb) {
        log.debug("create#refreshBoxes");
        return account.imap_refreshBoxes(function(err, boxes) {
          if (err) {
            return cb(err);
          }
          toFetch = boxes;
          return cb(null);
        });
      }, function(cb) {
        log.debug("create#scan");
        return account.imap_scanBoxesForSpecialUse(toFetch, cb);
      }
    ], function(err) {
      if (err) {
        return callback(err);
      }
      return callback(null, account);
    });
  };

  Account.clientList = function(callback) {
    return Account.request('all', function(err, accounts) {
      if (err) {
        return callback(err);
      }
      return async.map(accounts, function(account, cb) {
        return account.toClientObject(cb);
      }, callback);
    });
  };

  Account.prototype.doASAP = function(operation, callback) {
    return ImapPool.get(this.id).doASAP(operation, callback);
  };

  Account.prototype.isTest = function() {
    return this.accountType === 'TEST';
  };

  Account.prototype.isRefreshing = function() {
    return ImapPool.get(this.id).isRefreshing;
  };

  Account.prototype.setRefreshing = function(value) {
    return ImapPool.get(this.id).isRefreshing = value;
  };

  Account.prototype.applyPatchIgnored = function(callback) {
    var boxes, hadError;
    log.debug("applyPatchIgnored, already = ", this.patchIgnored);
    if (this.patchIgnored) {
      return callback(null);
    }
    boxes = [];
    hadError = false;
    if (this.trashMailbox) {
      boxes.push(this.trashMailbox);
    }
    if (this.junkMailbox) {
      boxes.push(this.junkMailbox);
    }
    log.debug("applyPatchIgnored", boxes);
    return async.eachSeries(boxes, function(boxID, cb) {
      return Mailbox.markAllMessagesAsIgnored(boxID, function(err) {
        if (err) {
          hadError = true;
          log.error("patch ignored err", err);
        }
        return cb(null);
      });
    }, (function(_this) {
      return function(err) {
        var changes;
        if (hadError) {
          log.debug("applyPatchIgnored:fail", _this.id);
          return callback(null);
        } else {
          log.debug("applyPatchIgnored:success", _this.id);
          changes = {
            patchIgnored: true
          };
          return _this.updateAttributes(changes, callback);
        }
      };
    })(this));
  };

  Account.prototype.applyPatchConversation = function(callback) {
    var status;
    log.debug("applyPatchConversation");
    status = {
      skip: 0
    };
    return async.whilst((function() {
      return !status.complete;
    }), (function(_this) {
      return function(cb) {
        return _this.applyPatchConversationStep(status, cb);
      };
    })(this), callback);
  };

  Account.prototype.applyPatchConversationStep = function(status, next) {
    return Message.rawRequest('conversationPatching', {
      reduce: true,
      group_level: 2,
      startkey: [this.id],
      endkey: [this.id, {}],
      limit: 1000,
      skip: status.skip
    }, (function(_this) {
      return function(err, rows) {
        var problems;
        if (err) {
          return next(err);
        }
        if (rows.length === 0) {
          status.complete = true;
          return next(null);
        }
        problems = rows.filter(function(row) {
          return row.value !== null;
        }).map(function(row) {
          return row.key;
        });
        log.debug("conversationPatchingStep", status.skip, rows.length, problems.length);
        if (problems.length === 0) {
          status.skip += 1000;
          return next(null);
        } else {
          return async.eachSeries(problems, _this.patchConversationOne, function(err) {
            if (err) {
              return next(err);
            }
            status.skip += 1000;
            return next(null);
          });
        }
      };
    })(this));
  };

  Account.prototype.patchConversationOne = function(key, callback) {
    return Message.rawRequest('conversationPatching', {
      reduce: false,
      key: key
    }, function(err, rows) {
      if (err) {
        return callback(err);
      }
      return Message.pickConversationID(rows, callback);
    });
  };

  Account.prototype.testConnections = function(callback) {
    if (this.isTest()) {
      return callback(null);
    }
    return this.testSMTPConnection((function(_this) {
      return function(err) {
        if (err) {
          return callback(err);
        }
        return ImapPool.test(_this, function(err) {
          if (err) {
            return callback(err);
          }
          return callback(null);
        });
      };
    })(this));
  };

  Account.prototype.forgetBox = function(boxid, callback) {
    var attribute, changes, i, len, ref;
    changes = {};
    ref = Object.keys(Mailbox.RFC6154);
    for (i = 0, len = ref.length; i < len; i++) {
      attribute = ref[i];
      if (this[attribute] === boxid) {
        changes[attribute] = null;
      }
    }
    if (indexOf.call(this.favorites, boxid) >= 0) {
      changes.favorites = _.without(this.favorites, boxid);
    }
    if (Object.keys(changes).length) {
      return this.updateAttributes(changes, callback);
    } else {
      return callback(null);
    }
  };

  Account.prototype.destroyEverything = function(callback) {
    return async.series([
      (function(_this) {
        return function(cb) {
          return _this.destroy(cb);
        };
      })(this), (function(_this) {
        return function(cb) {
          return Mailbox.destroyByAccount(_this.id, cb);
        };
      })(this), (function(_this) {
        return function(cb) {
          return Message.safeDestroyByAccountID(_this.id, cb);
        };
      })(this)
    ], callback);
  };

  Account.prototype.totalUnread = function(callback) {
    return Message.rawRequest('totalUnreadByAccount', {
      key: this.id,
      reduce: true
    }, function(err, results) {
      var ref;
      if (err) {
        return callback(err);
      }
      return callback(null, (results != null ? (ref = results[0]) != null ? ref.value : void 0 : void 0) || 0);
    });
  };

  Account.prototype.getMailboxes = function(callback) {
    return Mailbox.rawRequest('treeMap', {
      startkey: [this.id],
      endkey: [this.id, {}],
      include_docs: true
    }, callback);
  };

  Account.prototype.toClientObject = function(callback) {
    var rawObject;
    rawObject = this.toObject();
    if (rawObject.favorites == null) {
      rawObject.favorites = [];
    }
    return async.parallel({
      totalUnread: (function(_this) {
        return function(cb) {
          return _this.totalUnread(cb);
        };
      })(this),
      mailboxes: (function(_this) {
        return function(cb) {
          return _this.getMailboxes(cb);
        };
      })(this),
      counts: function(cb) {
        return Mailbox.getCounts(null, cb);
      }
    }, function(err, arg) {
      var counts, mailboxes, totalUnread;
      mailboxes = arg.mailboxes, counts = arg.counts, totalUnread = arg.totalUnread;
      if (err) {
        return callback(err);
      }
      rawObject.totalUnread = totalUnread;
      rawObject.mailboxes = mailboxes.map(function(row) {
        var box, clientBox, count, id;
        box = row.doc;
        id = (box != null ? box.id : void 0) || row.id;
        count = counts[id];
        return clientBox = {
          id: id,
          label: box.label,
          tree: box.tree,
          attribs: box.attribs,
          nbTotal: (count != null ? count.total : void 0) || 0,
          nbUnread: (count != null ? count.unread : void 0) || 0,
          nbRecent: (count != null ? count.recent : void 0) || 0,
          lastSync: box.lastSync
        };
      });
      return callback(null, rawObject);
    });
  };

  Account.prototype.imap_getBoxes = function(callback) {
    var supportRFC4551;
    log.debug("getBoxes");
    supportRFC4551 = null;
    return this.doASAP(function(imap, cb) {
      supportRFC4551 = imap.serverSupports('CONDSTORE');
      return imap.getBoxesArray(cb);
    }, (function(_this) {
      return function(err, boxes) {
        if (err) {
          return callback(err, []);
        }
        if (supportRFC4551 !== _this.supportRFC4551) {
          log.debug("UPDATING ACCOUNT " + _this.id + " rfc4551=" + _this.supportRFC4551);
          return _this.updateAttributes({
            supportRFC4551: supportRFC4551
          }, function(err) {
            if (err) {
              log.warn("fail to update account " + err.stack);
            }
            return callback(null, boxes || []);
          });
        } else {
          return callback(null, boxes || []);
        }
      };
    })(this));
  };

  Account.prototype.imap_refreshBoxes = function(callback) {
    var account;
    log.debug("imap_refreshBoxes");
    account = this;
    return async.series([
      (function(_this) {
        return function(cb) {
          return Mailbox.getBoxes(_this.id, cb);
        };
      })(this), (function(_this) {
        return function(cb) {
          return _this.imap_getBoxes(cb);
        };
      })(this)
    ], function(err, results) {
      var boxToAdd, cozyBox, cozyBoxes, i, imapBoxes, len, toDestroy, toFetch;
      log.debug("refreshBoxes#results");
      if (err) {
        return callback(err);
      }
      cozyBoxes = results[0], imapBoxes = results[1];
      toFetch = [];
      toDestroy = [];
      boxToAdd = imapBoxes.filter(function(box) {
        return !_.findWhere(cozyBoxes, {
          path: box.path
        });
      });
      for (i = 0, len = cozyBoxes.length; i < len; i++) {
        cozyBox = cozyBoxes[i];
        if (_.findWhere(imapBoxes, {
          path: cozyBox.path
        })) {
          toFetch.push(cozyBox);
        } else {
          toDestroy.push(cozyBox);
        }
      }
      log.debug("refreshBoxes#results2", boxToAdd.length, toFetch.length, toDestroy.length);
      return async.eachSeries(boxToAdd, function(box, cb) {
        log.debug("refreshBoxes#creating", box.label);
        box.accountID = account.id;
        return Mailbox.create(box, function(err, created) {
          if (err) {
            return cb(err);
          }
          toFetch.push(created);
          return cb(null);
        });
      }, function(err) {
        if (err) {
          return callback(err);
        }
        return callback(null, toFetch, toDestroy);
      });
    });
  };

  Account.prototype.imap_fetchMails = function(options, callback) {
    var account, firstImport, limitByBox, onlyFavorites;
    limitByBox = options.limitByBox, onlyFavorites = options.onlyFavorites, firstImport = options.firstImport;
    log.debug("account#imap_fetchMails", limitByBox, onlyFavorites);
    account = this;
    account.setRefreshing(true);
    if (onlyFavorites == null) {
      onlyFavorites = false;
    }
    return this.imap_refreshBoxes(function(err, toFetch, toDestroy) {
      var nb, reporter, shouldNotifAccount, supportRFC4551;
      if (err) {
        account.setRefreshing(false);
      }
      if (err) {
        return callback(err);
      }
      if (onlyFavorites) {
        toFetch = toFetch.filter(function(box) {
          var ref;
          return ref = box.id, indexOf.call(account.favorites, ref) >= 0;
        });
      }
      toFetch = toFetch.filter(function(box) {
        return box.isSelectable();
      });
      log.info("FETCHING ACCOUNT " + account.label + " : " + toFetch.length);
      log.info("  BOXES  " + toDestroy.length + " BOXES TO DESTROY");
      nb = toFetch.length + 1;
      reporter = ImapReporter.accountFetch(account, nb, firstImport);
      shouldNotifAccount = false;
      toFetch.sort(function(a, b) {
        if (a.label === 'INBOX') {
          return -1;
        } else {
          return 1;
        }
      });
      supportRFC4551 = account.supportRFC4551;
      return async.eachSeries(toFetch, function(box, cb) {
        var boxOptions;
        boxOptions = {
          limitByBox: limitByBox,
          firstImport: firstImport,
          supportRFC4551: supportRFC4551
        };
        return box.imap_refresh(boxOptions, function(err, shouldNotif) {
          if (err && !isMailboxDontExist(err)) {
            reporter.onError(err);
          }
          reporter.addProgress(1);
          if (shouldNotif) {
            shouldNotifAccount = true;
          }
          return cb(null);
        });
      }, function(err) {
        if (err) {
          account.setRefreshing(false);
        }
        if (err) {
          return callback(err);
        }
        log.debug("account#imap_fetchMails#DONE");
        return async.eachSeries(toDestroy, function(box, cb) {
          return box.destroyAndRemoveAllMessages(cb);
        }, function(err) {
          if (err) {
            account.setRefreshing(false);
          }
          if (err) {
            return callback(err);
          }
          return account.applyPatchConversation(function(err) {
            if (err) {
              log.error("patch conv fail", err);
            }
            account.setRefreshing(false);
            reporter.onDone();
            if (shouldNotifAccount) {
              notifications.accountRefreshed(account);
            }
            return callback(null);
          });
        });
      });
    });
  };

  Account.prototype.imap_fetchMailsTwoSteps = function(callback) {
    var firstStep, secondStep;
    log.debug("account#imap_fetchMails2Steps");
    firstStep = {
      onlyFavorites: true,
      firstImport: true,
      limitByBox: 100
    };
    secondStep = {
      onlyFavorites: false,
      firstImport: true,
      limitByBox: null
    };
    return this.imap_fetchMails(firstStep, (function(_this) {
      return function(err) {
        if (err) {
          return callback(err);
        }
        return _this.imap_fetchMails(secondStep, function(err) {
          if (err) {
            return callback(err);
          }
          return callback(null);
        });
      };
    })(this));
  };

  Account.prototype.imap_createMail = function(box, message, callback) {
    var mailbuilder;
    mailbuilder = new Compiler(message).compile();
    return mailbuilder.build((function(_this) {
      return function(err, buffer) {
        if (err) {
          return callback(err);
        }
        return _this.doASAP(function(imap, cb) {
          return imap.append(buffer, {
            mailbox: box.path,
            flags: message.flags
          }, cb);
        }, function(err, uid) {
          if (err) {
            return callback(err);
          }
          return callback(null, uid);
        });
      };
    })(this));
  };

  Account.prototype.imap_scanBoxesForSpecialUse = function(boxes, callback) {
    var box, boxAttributes, changes, i, id, inboxMailbox, j, len, len1, priorities, ref, type, useRFC6154;
    useRFC6154 = false;
    inboxMailbox = null;
    boxAttributes = Object.keys(Mailbox.RFC6154);
    changes = {};
    boxes.map(function(box) {
      var attribute, i, len, type;
      type = box.RFC6154use();
      if (box.isInbox()) {
        inboxMailbox = box.id;
      } else if (type) {
        if (!useRFC6154) {
          useRFC6154 = true;
          for (i = 0, len = boxAttributes.length; i < len; i++) {
            attribute = boxAttributes[i];
            changes[attribute] = null;
          }
        }
        log.debug('found', type);
        changes[type] = box.id;
      } else if (!useRFC6154 && (type = box.guessUse())) {
        log.debug('found', type, 'guess');
        changes[type] = box.id;
      }
      return box;
    });
    priorities = ['inboxMailbox', 'allMailbox', 'sentMailbox', 'draftMailbox'];
    changes.inboxMailbox = inboxMailbox;
    changes.favorites = [];
    for (i = 0, len = priorities.length; i < len; i++) {
      type = priorities[i];
      id = changes[type];
      if (id) {
        changes.favorites.push(id);
      }
    }
    for (j = 0, len1 = boxes.length; j < len1; j++) {
      box = boxes[j];
      if (changes.favorites.length < 4) {
        if ((ref = box.id, indexOf.call(changes.favorites, ref) < 0) && box.isSelectable()) {
          changes.favorites.push(box.id);
        }
      }
    }
    return this.updateAttributes(changes, callback);
  };

  Account.prototype.sendMessage = function(message, callback) {
    var generator, inReplyTo, options, transport;
    if (this.isTest()) {
      return callback(null, {
        messageId: 66
      });
    }
    inReplyTo = message.inReplyTo;
    message.inReplyTo = inReplyTo != null ? inReplyTo.shift() : void 0;
    options = {
      port: this.smtpPort,
      host: this.smtpServer,
      secure: this.smtpSSL,
      ignoreTLS: !this.smtpTLS,
      tls: {
        rejectUnauthorized: false
      }
    };
    if ((this.smtpMethod != null) && this.smtpMethod !== 'NONE') {
      options.authMethod = this.smtpMethod;
    }
    if (this.smtpMethod !== 'NONE' && this.oauthProvider !== 'GMAIL') {
      options.auth = {
        user: this.smtpLogin || this.login,
        pass: this.smtpPassword || this.password
      };
    }
    if (this.oauthProvider === 'GMAIL') {
      generator = require('xoauth2').createXOAuth2Generator({
        user: this.login,
        clientSecret: '1gNUceDM59TjFAks58ftsniZ',
        clientId: '260645850650-2oeufakc8ddbrn8p4o58emsl7u0r0c8s.apps.googleusercontent.com',
        refreshToken: this.oauthRefreshToken
      });
      options.service = 'gmail';
      options.auth = {
        xoauth2: generator
      };
    }
    transport = nodemailer.createTransport(options);
    return transport.sendMail(message, function(err, info) {
      message.inReplyTo = inReplyTo;
      return callback(err, info);
    });
  };

  Account.prototype.testSMTPConnection = function(callback) {
    var auth, connection, options, reject, timeout;
    if (this.isTest()) {
      return callback(null);
    }
    reject = _.once(callback);
    options = {
      port: this.smtpPort,
      host: this.smtpServer,
      secure: this.smtpSSL,
      ignoreTLS: !this.smtpTLS,
      tls: {
        rejectUnauthorized: false
      }
    };
    if ((this.smtpMethod != null) && this.smtpMethod !== 'NONE') {
      options.authMethod = this.smtpMethod;
    }
    connection = new SMTPConnection(options);
    if (this.smtpMethod !== 'NONE') {
      auth = {
        user: this.smtpLogin || this.login,
        pass: this.smtpPassword || this.password
      };
    }
    connection.once('error', function(err) {
      log.warn("SMTP CONNECTION ERROR", err);
      return reject(new AccountConfigError('smtpServer', err));
    });
    timeout = setTimeout(function() {
      reject(new AccountConfigError('smtpPort'));
      return connection.close();
    }, 10000);
    return connection.connect((function(_this) {
      return function(err) {
        if (err) {
          return reject(new AccountConfigError('smtpServer', err));
        }
        clearTimeout(timeout);
        if (_this.smtpMethod !== 'NONE') {
          return connection.login(auth, function(err) {
            if (err) {
              reject(new AccountConfigError('auth', err));
            } else {
              callback(null);
            }
            return connection.close();
          });
        } else {
          callback(null);
          return connection.close();
        }
      };
    })(this));
  };

  return Account;

})(cozydb.CozyModel);

module.exports = Account;

Mailbox = require('./mailbox');

Message = require('./message');

Compiler = require('nodemailer/src/compiler');

ImapPool = require('../imap/pool');

ImapReporter = require('../imap/reporter');

AccountConfigError = require('../utils/errors').AccountConfigError;

nodemailer = require('nodemailer');

SMTPConnection = require('nodemailer/node_modules/' + 'nodemailer-smtp-transport/node_modules/smtp-connection');

log = require('../utils/logging')({
  prefix: 'models:account'
});

_ = require('lodash');

async = require('async');

CONSTANTS = require('../utils/constants');

notifications = require('../utils/notifications');

require('../utils/socket_handler').wrapModel(Account, 'account');

ref = require('../utils/errors'), AccountConfigError = ref.AccountConfigError, RefreshError = ref.RefreshError, NotFound = ref.NotFound, isMailboxDontExist = ref.isMailboxDontExist;

refreshTimeout = null;
