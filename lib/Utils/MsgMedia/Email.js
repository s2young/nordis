var util            = require('util'),
    mailer          = require('nodemailer'),
    async           = require('async'),
    events          = require('events'),
    MailParser      = require("mailparser").MailParser,
    Imap            = require('imap'),
    Collection      = require('./../../Core/Collection'),
    App             = require('./../../Core/AppConfig');

var Email = function(){
    var oSelf = this;
    oSelf.oQuickTransport = mailer.createTransport("SMTP", App.hOptions.Email.oQuickMail);
    oSelf.oSendGridTransport = mailer.createTransport("SMTP",App.hOptions.Email.oSendGrid);
    oSelf.oInBox = null;
    oSelf.oIMAP = new Imap({
        username: App.hOptions.Email.oQuickMail.auth.user,
        password: App.hOptions.Email.oQuickMail.auth.pass,
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        connTimeout:100000,
        debug:(App.hConstants.sLogLevel == 'debug')
    });
    oSelf.oIMAP.on('end',function(){
        oSelf.oInBox = null;
    });
};
Email.prototype = new events.EventEmitter;
var p = Email.prototype;

p.aFoundMsgIDs = [];
p.aFoundMsgs = [];

p.connect = function(fnCallback){
    var oSelf = this;
    oSelf.oIMAP.connect(function(){
        oSelf.oIMAP.openBox('INBOX',false,function(err,res){
            oSelf.oInBox = res;
            if (fnCallback)
                fnCallback(err,res);
        });
    });
};

p.send = function(hOpts,fnCallback) {
    var oSelf = this;
    var done = function(err,hResult) {
        if (fnCallback)
            fnCallback(err,hResult);
    };

    oSelf.prepareEmail(hOpts,function(err){
        if (err)
            done(err);
        else if (hOpts.to == 'dummy@sink.sendgrid.net')
            done();
        else {
            if (App.bAllMessagingOff) {

                done();

            } else {
                // For system or prebuilt emails, bypass sendgrid.
                if (!hOpts.oMsgResult || !hOpts.oMsgResult.oMsg.get('sTemplate') ||  hOpts.oMsgResult.oMsg.get('sTemplate').indexOf('system') == 0) {
                    oSelf.sendDirect(hOpts,function(err){
                        done(err);
                    });
                } else {
                    oSelf.sendGrid(hOpts,done);
                }
            }
        }
    });
};
/**
 * This method is used for simple emailing of things like passcode resets, pin codes, and system emails
 * like errors and such.
 *
 * @param hOpts - Hash that needs to include at least:
 *      to - String of email(s)
 *      from - String of sender email
 *      html or text - The message body.
 *
 * @param fnCallback
 */
p.sendDirect = function(hOpts,fnCallback) {

    this.oQuickTransport.sendMail(hOpts,fnCallback);
};
/**
 * This method sends email via SendGrid. This is for all invites, comments, marketing email, etc.
 * @param hOpts
 * @param fnCallback
 */
p.sendGrid = function(hOpts,fnCallback) {
    var oSelf = this;
    var aCategories = [];
    var hArgs = {};

    if (hOpts.oMsgResult) {
        if (hOpts.oMsgResult.oMsg.get('sID'))
            hArgs.sID = hOpts.oMsgResult.oMsg.get('sID');
        if (hOpts.oMsgResult.oEvent)
            aCategories.push('Event');
        if (hOpts.oMsgResult.oGroup)
            aCategories.push('Group');
        if (hOpts.oMsgResult.oNews)
            aCategories.push('News');
    }

    hOpts.headers =  {
        'X-SMTPAPI': {
            category:aCategories,
            unique_args:hArgs
        }
    };
    //console.log(hOpts.headers);

    this.oSendGridTransport.sendMail(hOpts,fnCallback);
};
/**
 * This method locates the best email platform to use for the current recipient.
 * @param hOpts
 * @param fnCallback
 */
p.prepareEmail = function(hOpts,fnCallback) {
    // BODY
    if (hOpts.sBody && (hOpts.sBody.match(/(\<html|\<br)/)||hOpts.bHtml))
        hOpts.html = hOpts.sBody;
    else
        hOpts.text = hOpts.sBody;

    // SUBJECT
    hOpts.subject = (hOpts.sSubject) ? hOpts.sSubject : hOpts.subject;

    if (hOpts.oMsgResult) {
        if (!hOpts.subject)
            hOpts.subject = hOpts.oMsgResult.oMsg.get('sSubject');

        if (!hOpts.subject && hOpts.oMsgResult.oMsg.get('nCommentType') === 0)
            hOpts.subject = hOpts.oMsgResult.oMsg.get('sBody').substring(0,50);
    }
    // TO & FROM
    async.series([
        function(callback){
            hOpts.to = (hOpts.sTo) ? hOpts.sTo : hOpts.to;
            if (!hOpts.to && hOpts.oMsgResult) {
                var sEmail = (hOpts.oMsgResult.oPlatform) ? hOpts.oMsgResult.oPlatform.get('sEmail') : '';

                if (!hOpts.oMsgResult.oPlatform && hOpts.oMsgResult.oUser) {
                    hOpts.oMsgResult.oPlatform = hOpts.oMsgResult.oUser.getPlatform({
                        nMedium:App.nMedium_Email,
                        nStatus:App.nPlatformStatus_Active,
                        nApiConsumerID:hOpts.oMsgResult.oMsg.get('nApiConsumerID')
                    });
                    if (hOpts.oMsgResult.oPlatform)
                        sEmail = hOpts.oMsgResult.oPlatform.get('sEmail');
                }

                if (sEmail && sEmail.match(/^(\d*)@goba\.mobi$/))
                    hOpts.to = 'dummy@sink.sendgrid.net';
                else if (hOpts.oMsgResult.oUser && sEmail)
                    hOpts.to = (hOpts.oMsgResult.oUser.get('sName')||'') + ' <'+sEmail+'>';
                else
                    hOpts.to = sEmail;

                hOpts.oMsgResult.to = hOpts.to;
            }

            if (hOpts.to || !hOpts.oMsgResult || !hOpts.oMsgResult.oUser )
                callback();
            else {
                var Platform = require('./../../Model/User/Platform');
                Base.lookup({sClass:'Platform',hQuery:{nUserID:hOpts.oMsgResult.oUser.get('nID'),nMedium:App.nMedium_Email,nStatus:App.nPlatformStatus_Active,nApiConsumerID:hOpts.oMsgResult.oMsg.get('nApiConsumerID')}},function(err,oPlatform){
                    hOpts.to = oPlatform.get('sEmail');
                    App.info(hOpts.to);
                    callback();
                });
            }

        },
        function(callback){
            hOpts.from = (hOpts.sFrom) ? hOpts.sFrom : (hOpts.from) ? hOpts.from : App.hOptions.Email.oQuickMail.from;
            callback();
        }
    ],function(err){
        fnCallback(err);
    });
};
/**
 * This method retrieves the messages found in the search.
 * @param fnCallback
 */
p.fetchMessages = function(aFound,fnCallback) {
    var oSelf = this;

    if (aFound && aFound.length > 0) {
        var fetch = oSelf.oIMAP.fetch(aFound, { request: { headers:null, body:'full' } });
        fetch.on('message', function(msg) {
            var sContent = '';
            msg.on('data', function(chunk) {
                sContent += chunk.toString('utf8');
            });
            msg.on('end', function() {
                var mailparser = new MailParser();
                mailparser.on("end", function(oParsedMsg){
                    oParsedMsg.uid = msg.uid;
                    oSelf.emit('onMsgParsed',oParsedMsg);
                });
                mailparser.write(sContent);
                mailparser.end();
            });
        });
        fetch.on('end', function() {
            fnCallback(null);
        });
    }
};
/**
 * This method closes the mail box and disconnects from the web server.
 * @param fnCallback
 */
p.logout = function(fnCallback){
    var oSelf = this;
    if (oSelf.oInBox)
        oSelf.oIMAP.closeBox(function(err){
            console.warn(err);
            oSelf.oInBox = null;
            oSelf.oIMAP.logout(function(err2,res2){
                if (err2)
                    App.error(err2);
                else
                    fnCallback(err2,res2);
            });
        });
};

p.debug = function(hOpts,sMsg,hData) {
    if (hOpts.oMsgResult && hOpts.oMsgResult.oMsg)
        hOpts.oMsgResult.oMsg.debug('SMS.js: '+sMsg,hData);
};
/**
 * This method is a helper method for testing that allows you to check an email address for an incoming
 * email, passing in the field you want to check, the value in that field you want to check for, the
 * number of milliseconds to wait between tries, and the number of tries to make. Here is what your
 * hOpts should look like:
 *
 * {
 *      nTimeout:<milliseconds to allow for delivery before exiting>
 *      bDebug:<boolean to indicate whether to print progress details>
 *      sValue:<value to check for in the specified field>
 *
 *  }
 * @param hOpts
 * @param fnCallback
 */
p.waitForEmail = function(hOpts,fnCallback){
    var oSelf = self;
    // Keep a hash of emails found so we don't 'find' them again.
    var aDeleteList = [];
    var aFoundEmails = [];
    var aExpectedEmails = [];
    for (var i = 0; i < App.aEmailsToCheck.length; i++) {
        aExpectedEmails.push(App.aEmailsToCheck[i]);
    }

    var bDone = false;
    var nTimeout = (hOpts.nTimeout) ? hOpts.nTimeout : (App.aEmailsToCheck.length * 30000);

    var bDebug = (hOpts.bDebug) ? hOpts.bDebug : false;

    var signOut = function(err) {
        if (err)
            App.error(err);

        oSelf.removeAllListeners('onMsgParsed');
        oSelf.oIMAP.removeAllListeners('error');
        oSelf.oIMAP.removeAllListeners('mail');
        oSelf.oIMAP.logout();
        fnCallback(null,aFoundEmails,aExpectedEmails);
    };

    var wrapUp = function(){
        bDone = true;
        App.aEmailsToCheck = [];
        if (aDeleteList && aDeleteList.length > 0) {
            oSelf.oIMAP.addFlags(aDeleteList,'Deleted',function(){
               signOut();
            });
        } else
            signOut();
    };

    var parseForMatches = function(hMsg) {
        for (var i=0; i < aExpectedEmails.length; i++) {
            if (!bDone) {
                var sField = aExpectedEmails[i].sField;
                var sValue = aExpectedEmails[i].sValue;
                var sEmail = aExpectedEmails[i].sEmail;

                if (bDebug)
                    App.info(sField+': '+hMsg[sField]);

                if (hMsg[sField] && hMsg[sField].indexOf(sValue) > -1 && (!sEmail || hMsg.to[0].address == sEmail)) {
                    hMsg.bFound = true;
                    aFoundEmails.push(hMsg);
                    aDeleteList.push(hMsg.uid);
                    if (bDebug)
                        App.info('FOUND ' +sValue+' IN '+ hMsg[sField]+' ('+sEmail+'='+hMsg.to[0].address+')');
                    if (aDeleteList.length >= aExpectedEmails.length)
                        wrapUp();
                }
            }
        }
    };

    // Ignore emails to find that contain sink email (eg 12@goba.mobi);
    for (var n = (aExpectedEmails.length-1); n > -1; n--) {
        var oItem = aExpectedEmails[n];
        if (oItem.sEmail.match(/^(\d+)@goba\.mobi$/)) {
//            aFoundEmails.push(oItem);
            aExpectedEmails.splice(n,1);
        }
    }

    if (aExpectedEmails.length == 0) {
        wrapUp();
    } else {
        if (bDebug)
            App.info('Checking for '+aExpectedEmails.length+' result(s).',aExpectedEmails);

        oSelf.aSearch = [ 'UNSEEN', ['SINCE', 'May 20, 2010']];

        oSelf.oIMAP.removeAllListeners('error');
        oSelf.oIMAP.on('error',function(err){
            signOut(err);
        });

        var timeItOut = function() {
            if (!bDone) {
                wrapUp();
            }
        };
        setTimeout(timeItOut,nTimeout);

        oSelf.removeAllListeners('onMsgParsed');
        oSelf.on('onMsgParsed',function(hMsg){
            if (bDebug)
                App.info('onMsgParsed');
            parseForMatches(hMsg);
        });

        var checkEmail = function() {
            if (bDebug)
                App.info('checkEmail...');

            oSelf.oIMAP.search(oSelf.aSearch, function(err,aFound){
                if (err)
                    signOut(err);
                else {
                    if (bDebug)
                        App.info(aFound);

                    if (aFound.length > 0)
                        oSelf.fetchMessages(aFound,function(err){
                            if (err)
                                signOut();
                        });
                }
            });
        };

        oSelf.oIMAP.removeAllListeners('mail');
        oSelf.oIMAP.on('mail',function(){
            if (bDebug)
                App.info('New mail!');
            checkEmail();
        });

        if (!oSelf.oInBox) {
            if (bDebug)
                App.info('Connecting...');

            oSelf.oIMAP.connect(function(err){
                if (bDebug)
                    App.info('Connected.');

                if (err)
                    signOut(err);
                else {
                    if (bDebug)
                        App.info('Opening inbox...');
                    oSelf.oIMAP.openBox('INBOX',false,function(err,res){
                        if (bDebug)
                            App.info('Inbox open.');

                        if (err)
                            signOut(err);
                        else {
                            oSelf.oInBox = res;
                            checkEmail();
                        }
                    });
                }
            });
        }
    }
};

var self = new Email();
module.exports = self;

module.exports.parseForLinkUrl = function(oEmail,sLinkText) {
    // The first regex gets all anchor tags.
    var sRegEx = "<a([^>]*)>("+sLinkText+")<\\/a>";
    var reTags = new RegExp(sRegEx,'g');
    var aMatches = reTags.exec(oEmail.html);
    if (aMatches && aMatches.length) {
        // Item index 1 should include the href;
        var reHref = new RegExp(/href="([^"]*)"/);
        var aHref = reHref.exec(aMatches[1]);
        if (aHref.length == 2)
            return aHref[1];
    }
    return '';
};