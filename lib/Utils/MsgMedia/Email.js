var mailer          = require('nodemailer'),
    async           = require('async'),
    events          = require('events'),
    Collection      = require('./../../Collection'),
    App             = require('./../../AppConfig');

var Email = function(){
    var oSelf = this;
    oSelf.oQuickTransport = mailer.createTransport("SMTP", App.hOptions.Email.oQuickMail);
    oSelf.oSendGridTransport = mailer.createTransport("SMTP",App.hOptions.Email.oSendGrid);
    oSelf.oInBox = null;
};
Email.prototype = new events.EventEmitter;
var p = Email.prototype;

p.aFoundMsgIDs = [];
p.aFoundMsgs = [];

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
                Base.lookup({sClass:'Platform',hQuery:{nUserID:hOpts.oMsgResult.oUser.getNumKey(),nMedium:App.nMedium_Email,nStatus:App.nPlatformStatus_Active,nApiConsumerID:hOpts.oMsgResult.oMsg.get('nApiConsumerID')}},function(err,oPlatform){
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


p.debug = function(hOpts,sMsg,hData) {
    if (hOpts.oMsgResult && hOpts.oMsgResult.oMsg)
        hOpts.oMsgResult.oMsg.debug('SMS.js: '+sMsg,hData);
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